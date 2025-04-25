import { mockProvider } from '../../mocks/provider.mock';

// Kütüphane modülünü mockla
jest.mock('../../../src/database/providers', () => ({
  getProvider: jest.fn().mockReturnValue(mockProvider)
}));

// Redis servisini mockla
jest.mock('../../../src/services/redis.service', () => ({
  redisService: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
  }
}));

// ErrorCode'u mockla
jest.mock('../../../src/common/errors', () => {
  const originalModule = jest.requireActual('../../../src/common/errors');
  return {
    ...originalModule,
    // Hataları yakalamak için orjinal DatabaseError sınıfını kullan
  };
});

// Logger'ı mockla
jest.mock('../../../src/utils/logger', () => ({
  databaseLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  redisLogger: jest.fn(),
  mssqlLogger: jest.fn(),
  keyManagerLogger: jest.fn(),
  Logger: jest.fn()
}));

// İçe aktar - mocklar hazır olduktan sonra içe aktarılmalı
import { query, execute, queryWithPagination, transaction } from '../../../src/database';
import { redisService } from '../../../src/services/redis.service';
import { DatabaseError, ErrorCode } from '../../../src/common/errors';

describe('Database Module', () => {
  beforeEach(() => {
    // Her test öncesinde mockları temizle
    jest.clearAllMocks();
  });
  
  describe('query', () => {
    it('should return data from the provider', async () => {
      const result = await query({
        sql: 'SELECT * FROM users'
      });
      
      expect(mockProvider.query).toHaveBeenCalledWith({
        sql: 'SELECT * FROM users'
      });
      expect(result).toEqual([{ id: 1, name: 'Test' }]);
    });
    
    it('should get cached data if available', async () => {
      // Önbellek verisini simüle et
      (redisService.get as jest.Mock).mockResolvedValue([{ id: 1, name: 'Cached' }]);
      
      const result = await query({
        sql: 'SELECT * FROM users',
        cache: {
          key: 'users:all'
        }
      });
      
      // Önbellekten alınmalı, sağlayıcı çağrılmamalı
      expect(redisService.get).toHaveBeenCalledWith('users:all');
      expect(mockProvider.query).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: 'Cached' }]);
    });
    
    it('should cache query results if cache specified', async () => {
      // Önbellekte veri yok
      (redisService.get as jest.Mock).mockResolvedValue(null);
      
      await query({
        sql: 'SELECT * FROM users',
        cache: {
          key: 'users:all',
          ttl: 300
        }
      });
      
      // Önbelleğe alınmalı
      expect(redisService.set).toHaveBeenCalledWith(
        'users:all',
        [{ id: 1, name: 'Test' }],
        300
      );
    });
    
    it('should not use cache for transactions', async () => {
      await query({
        sql: 'SELECT * FROM users',
        cache: {
          key: 'users:all'
        },
        transaction: 'tx-mock' as any
      });
      
      // Önbellek kontrolü yapılmamalı
      expect(redisService.get).not.toHaveBeenCalled();
      
      // Sonuç önbelleğe alınmamalı
      expect(redisService.set).not.toHaveBeenCalled();
    });
    
    it('should throw and log errors', async () => {
      // Mock provider'a hata vermesini söyle - önceki çağrıları temizle
      mockProvider.query.mockReset();
      
      // Önce hata durumunu ayarla
      const queryError = new Error('Query failed');
      mockProvider.query.mockRejectedValueOnce(queryError);
      
      // Logger'u takip et
      const loggerSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Hata fırlatılıyor mu?
      await expect(query({
        sql: 'SELECT * FROM users'
      })).rejects.toThrow();
      
      // Hata loglandı mı?
      expect(loggerSpy).toHaveBeenCalled();
      
      // Temizle
      loggerSpy.mockRestore();
      mockProvider.query.mockReset();
      mockProvider.query.mockResolvedValue([{ id: 1, name: 'Test' }]);
    });
  });
  
  describe('execute', () => {
    it('should return results from the provider', async () => {
      const result = await execute({
        sql: 'INSERT INTO users (name) VALUES (@p0)',
        parameters: ['Test']
      });
      
      expect(mockProvider.execute).toHaveBeenCalledWith({
        sql: 'INSERT INTO users (name) VALUES (@p0)',
        parameters: ['Test']
      });
      expect(result).toEqual([{ affectedRows: 1 }]);
    });
    
    it('should invalidate cache if specified', async () => {
      await execute({
        sql: 'UPDATE users SET name = @p0',
        parameters: ['Updated'],
        cache: {
          key: 'users:*'
        }
      });
      
      // Önbellek temizlenmeli
      expect(redisService.del).toHaveBeenCalledWith('users:*');
    });
    
    it('should not invalidate cache in transactions', async () => {
      await execute({
        sql: 'UPDATE users SET name = @p0',
        parameters: ['Updated'],
        cache: {
          key: 'users:*'
        },
        transaction: 'tx-mock' as any
      });
      
      // Önbellek temizlenmemeli
      expect(redisService.del).not.toHaveBeenCalled();
    });
    
    it('should throw and log errors', async () => {
      // Mock provider'a hata vermesini söyle - önceki çağrıları temizle
      mockProvider.execute.mockReset();
      
      // Önce hata durumunu ayarla
      const executeError = new Error('Execute failed');
      mockProvider.execute.mockRejectedValueOnce(executeError);
      
      // Logger'u takip et
      const loggerSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Hata fırlatılıyor mu?
      await expect(execute({
        sql: 'INSERT INTO users (name) VALUES (@p0)',
        parameters: ['Test']
      })).rejects.toThrow();
      
      // Hata loglandı mı?
      expect(loggerSpy).toHaveBeenCalled();
      
      // Temizle
      loggerSpy.mockRestore();
      mockProvider.execute.mockReset();
      mockProvider.execute.mockResolvedValue([{ affectedRows: 1 }]);
    });
  });
  
  describe('queryWithPagination', () => {
    it('should return paginated results from the provider', async () => {
      const result = await queryWithPagination({
        sql: 'SELECT * FROM users',
        page: 2,
        pageSize: 10
      });
      
      expect(mockProvider.queryWithPagination).toHaveBeenCalledWith({
        sql: 'SELECT * FROM users',
        page: 2,
        pageSize: 10
      });
      
      expect(result).toEqual({
        detail: [{ id: 1, name: 'Test' }],
        totalCount: 1,
        pageCount: 1,
        page: '1',
        pageSize: 10
      });
    });
    
    it('should get cached paginated data if available', async () => {
      // Önbellek verisini simüle et
      (redisService.get as jest.Mock).mockResolvedValue({
        detail: [{ id: 1, name: 'Cached' }],
        totalCount: 1,
        pageCount: 1,
        page: '1',
        pageSize: 10
      });
      
      const result = await queryWithPagination({
        sql: 'SELECT * FROM users',
        page: 1,
        pageSize: 10,
        cache: {
          key: 'users:page:1'
        }
      });
      
      // Önbellekten alınmalı, sağlayıcı çağrılmamalı
      expect(redisService.get).toHaveBeenCalledWith('users:page:1');
      expect(mockProvider.queryWithPagination).not.toHaveBeenCalled();
      expect(result.detail).toEqual([{ id: 1, name: 'Cached' }]);
    });
    
    it('should cache paginated results if cache specified', async () => {
      // Önbellekte veri yok
      (redisService.get as jest.Mock).mockResolvedValue(null);
      
      const result = await queryWithPagination({
        sql: 'SELECT * FROM users',
        page: 1,
        pageSize: 10,
        cache: {
          key: 'users:page:1',
          ttl: 300
        }
      });
      
      // Önbelleğe alınmalı
      expect(redisService.set).toHaveBeenCalledWith(
        'users:page:1',
        result,
        300
      );
    });
    
    it('should throw and log errors', async () => {
      // Mock provider'a hata vermesini söyle - önceki çağrıları temizle
      mockProvider.queryWithPagination.mockReset();
      
      // Önce hata durumunu ayarla
      const paginationError = new Error('Pagination failed');
      mockProvider.queryWithPagination.mockRejectedValueOnce(paginationError);
      
      // Logger'u takip et
      const loggerSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Hata fırlatılıyor mu?
      await expect(queryWithPagination({
        sql: 'SELECT * FROM users',
        page: 1,
        pageSize: 10
      })).rejects.toThrow();
      
      // Hata loglandı mı?
      expect(loggerSpy).toHaveBeenCalled();
      
      // Temizle
      loggerSpy.mockRestore();
      mockProvider.queryWithPagination.mockReset();
      mockProvider.queryWithPagination.mockResolvedValue({
        detail: [{ id: 1, name: 'Test' }],
        totalCount: 1,
        pageCount: 1,
        page: '1',
        pageSize: 10
      });
    });
  });
  
  describe('transaction', () => {
    it('should delegate to provider transaction method', async () => {
      const callback = jest.fn().mockResolvedValue('transaction-result');
      
      const result = await transaction(callback);
      
      expect(mockProvider.transaction).toHaveBeenCalledWith(callback);
      expect(result).toBe('transaction-result');
    });
    
    it('should throw and log errors', async () => {
      // Mock provider'a hata vermesini söyle - önceki çağrıları temizle
      mockProvider.transaction.mockReset();
      
      // Önce hata durumunu ayarla
      const transactionError = new Error('Transaction failed');
      mockProvider.transaction.mockRejectedValueOnce(transactionError);
      
      // Logger'u takip et
      const loggerSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Hata fırlatılıyor mu?
      await expect(transaction(() => {
        return Promise.resolve('result');
      })).rejects.toThrow();
      
      // Hata loglandı mı?
      expect(loggerSpy).toHaveBeenCalled();
      
      // Temizle
      loggerSpy.mockRestore();
      mockProvider.transaction.mockReset();
      mockProvider.transaction.mockImplementation(async (callback) => {
        return callback('tx-mock');
      });
    });
  });
});
