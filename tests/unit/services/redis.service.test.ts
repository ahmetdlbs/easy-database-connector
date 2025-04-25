import { MockRedisClient, createClient } from '../../mocks/redis.mock';

// Redis modülünü mockla
jest.mock('redis', () => {
  return require('../../mocks/redis.mock');
});

// Config modülünü mockla
jest.mock('../../../src/config/config', () => ({
  config: {
    redis: {
      enabled: true,
      host: 'localhost',
      port: 6379,
      password: 'test-password',
      ttl: 3600,
    }
  }
}));

// Loggerları mockla
jest.mock('../../../src/utils/logger', () => ({
  redisLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// İçe aktarma, mocklar hazır olduktan sonra yapılmalı
import { redisService } from '../../../src/services/redis.service';

describe('Redis Service', () => {
  let mockClient: MockRedisClient;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // RedisService instance'ını sıfırla
    (redisService as any).client = null;
    (redisService as any).connectionPromise = null;
    (redisService as any).isShuttingDown = false;
    
    // Yeni mock client oluştur
    mockClient = new MockRedisClient();
    (createClient as jest.Mock).mockReturnValue(mockClient);
  });
  
  describe('getConnection', () => {
    it('should create and connect redis client', async () => {
      // getConnection çağrıldığında client'i ayarla
      const client = await redisService.getConnection();
      
      // Client'in createClient ile oluşturulduğunu kontrol et
      expect(createClient).toHaveBeenCalled();
      
      // Connect metodunun çağrıldığını kontrol et
      expect(mockClient.connect).toHaveBeenCalled();
      
      // RedisService'in client'ı sakladığını kontrol et
      expect((redisService as any).client).toBe(mockClient);
    });
    
    it('should reuse existing connection', async () => {
      // İlk bağlantı
      const client = await redisService.getConnection();
      
      // createClient'in çağrıldığını doğrula
      expect(createClient).toHaveBeenCalledTimes(1);
      
      // İkinci bağlantı
      const secondConn = await redisService.getConnection();
      
      // Yeni bir bağlantı oluşturulamadığını doğrula
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      
      // Mevcut bağlantının döndürüldüğünü kontrol et
      expect(secondConn).toBe(client);
    });
  });
  
  describe('get', () => {
    it('should get value from Redis', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      
      // Mock Redis yanıtını ayarla
      mockClient.get.mockResolvedValue(JSON.stringify({ id: 1, name: 'Test' }));
      
      // get fonksiyonunu çağır
      const result = await redisService.get<any>('test-key');
      
      // Client'in get fonksiyonunun çağrıldığını kontrol et
      expect(mockClient.get).toHaveBeenCalledWith('test-key');
      
      // Dönen değeri kontrol et
      expect(result).toEqual({ id: 1, name: 'Test' });
    });
    
    it('should return null for non-existent key', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      
      // Olmayan anahtar için null yanıtı ayarla
      mockClient.get.mockResolvedValue(null);
      
      // get fonksiyonunu çağır
      const result = await redisService.get<any>('non-existent');
      
      // Null döndüğünü kontrol et
      expect(result).toBeNull();
    });
    
    it('should handle JSON parse errors', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      
      // Geçersiz JSON döndür
      mockClient.get.mockResolvedValue('invalid-json');
      
      // get fonksiyonunu çağır
      const result = await redisService.get<any>('test-key');
      
      // Parse hatası durumunda null döndüğünü kontrol et
      expect(result).toBeNull();
    });
  });
  
  describe('set', () => {
    it('should set value with TTL', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // set fonksiyonunu çağır
      await redisService.set('test-key', { id: 1, name: 'Test' }, 600);
      
      // setEx metodunun doğru parametrelerle çağrıldığını kontrol et
      expect(mockClient.setEx).toHaveBeenCalledWith(
        'test-key',
        600,
        JSON.stringify({ id: 1, name: 'Test' })
      );
    });
    
    it('should use default TTL if not specified', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // set fonksiyonunu çağır
      await redisService.set('test-key', { id: 1, name: 'Test' });
      
      // Varsayılan TTL (3600) ile çağrıldığını kontrol et
      expect(mockClient.setEx).toHaveBeenCalledWith(
        'test-key',
        3600, // Varsayılan TTL
        expect.any(String)
      );
    });
    
    it('should not set null values', async () => {
      // Null değer için set çağır
      const result = await redisService.set('test-key', null);
      
      // Dönen değerin false olduğunu kontrol et
      expect(result).toBe(false);
      
      // setEx metodunun çağrılmadığını kontrol et
      expect(mockClient.setEx).not.toHaveBeenCalled();
    });
  });
  
  describe('del', () => {
    it('should delete a key', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // mock.keys yanıtını ayarla
      mockClient.keys.mockResolvedValue(['test-key']);
      mockClient.del.mockResolvedValue(1);
      
      // del fonksiyonunu çağır
      const result = await redisService.del('test-key');
      
      // keys ve del metodlarının doğru çağrıldığını kontrol et
      expect(mockClient.keys).toHaveBeenCalledWith('test-key');
      expect(mockClient.del).toHaveBeenCalledWith(['test-key']);
      
      // Dönen değerin 1 olduğunu kontrol et
      expect(result).toBe(1);
    });
    
    it('should handle patterns', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // Mock yanıtları ayarla
      mockClient.keys.mockResolvedValue(['users:1', 'users:2']);
      mockClient.del.mockResolvedValue(2);
      
      // del fonksiyonunu çağır
      const result = await redisService.del('users:*');
      
      // keys ve del metodlarının doğru çağrıldığını kontrol et
      expect(mockClient.keys).toHaveBeenCalledWith('users:*');
      expect(mockClient.del).toHaveBeenCalledWith(['users:1', 'users:2']);
      
      // Dönen değerin 2 olduğunu kontrol et
      expect(result).toBe(2);
    });
    
    it('should handle array of patterns', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // Mock yanıtları ayarla
      mockClient.keys.mockImplementation((pattern) => {
        if (pattern === 'users:*') return Promise.resolve(['users:1', 'users:2']);
        if (pattern === 'posts:*') return Promise.resolve(['posts:1']);
        return Promise.resolve([]);
      });
      
      mockClient.del.mockResolvedValue(3);
      
      // del fonksiyonunu çağır
      const result = await redisService.del(['users:*', 'posts:*']);
      
      // del metodunun doğru çağrıldığını kontrol et
      expect(mockClient.del).toHaveBeenCalledWith(['users:1', 'users:2', 'posts:1']);
      
      // Dönen değerin 3 olduğunu kontrol et
      expect(result).toBe(3);
    });
    
    it('should return 0 if no keys match', async () => {
      // Mock Redis client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // Boş dizi yanıtını ayarla
      mockClient.keys.mockResolvedValue([]);
      
      // del fonksiyonunu çağır
      const result = await redisService.del('non-existent:*');
      
      // del metodunun çağrılmadığını kontrol et
      expect(mockClient.del).not.toHaveBeenCalled();
      
      // Dönen değerin 0 olduğunu kontrol et
      expect(result).toBe(0);
    });
  });
  
  describe('cleanup', () => {
    it('should close Redis connection', async () => {
      // Önce mock client'i ayarla
      (redisService as any).client = mockClient;
      mockClient.isOpen = true;
      
      // cleanup fonksiyonunu çağır
      await redisService.cleanup();
      
      // quit fonksiyonunun çağrıldığını kontrol et
      expect(mockClient.quit).toHaveBeenCalled();
      
      // Client'in null olarak ayarlandığını doğrula
      expect((redisService as any).client).toBeNull();
    });
  });
});
