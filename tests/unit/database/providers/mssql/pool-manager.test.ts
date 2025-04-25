import { poolManager } from '../../../../../src/database/providers/mssql/pool-manager';
import { keyManagerService } from '../../../../../src/database/providers/mssql/key-manager';
import { mssql, MockConnectionPool } from '../../../../mocks/mssql.mock';

// MSSQL modülünü mockla
jest.mock('mssql', () => require('../../../../mocks/mssql.mock').mssql);

// KeyManagerService modülünü mockla
jest.mock('../../../../../src/database/providers/mssql/key-manager', () => {
  return {
    keyManagerService: {
      cleanupConnection: jest.fn(),
      shutdown: jest.fn()
    }
  };
});

// Config modülünü mockla
jest.mock('../../../../../src/config', () => {
  return {
    config: {
      database: {
        host: 'test-host',
        user: 'test-user',
        password: 'test-password',
        database: 'test-db',
        port: 1433,
        options: {
          encrypt: true,
          trustServerCertificate: true
        }
      }
    }
  };
});

describe('MSSQL Pool Manager', () => {
  beforeEach(() => {
    // Mock'ları temizle
    jest.clearAllMocks();
    
    // Pool Manager instance'ını sıfırla
    (poolManager as any).isShuttingDown = false;
    (poolManager as any).pool = null;
    (poolManager as any).poolPromise = null;
  });
  
  afterEach(async () => {
    // Her test sonrasında havuzu kapat
    await poolManager.shutdown('test');
  });
  
  describe('getPool', () => {
    it('should create a new connection pool', async () => {
      const pool = await poolManager.getPool();
      
      expect(pool).toBeDefined();
      expect(mssql.ConnectionPool).toHaveBeenCalled();
      expect(pool.connect).toHaveBeenCalled();
    });
    
    it('should return the same pool for subsequent calls', async () => {
      const pool1 = await poolManager.getPool();
      const pool2 = await poolManager.getPool();
      
      expect(pool1).toBe(pool2);
      expect(mssql.ConnectionPool).toHaveBeenCalledTimes(1);
    });
    
    it('should handle connection errors', async () => {
      // Bağlantı hatası simüle et
      const mockErrorPool = new MockConnectionPool();
      mockErrorPool.connect = jest.fn().mockRejectedValue(new Error('Connection failed')) as any;
      
      // Mock ConnectionPool oluşturucuyu geçersiz kıl
      (mssql.ConnectionPool as jest.Mock).mockImplementationOnce(() => mockErrorPool);
      
      await expect(poolManager.getPool()).rejects.toThrow('Connection failed');
      
      // Havuz oluşturma hataya rağmen bir sonraki çağrıda tekrar denenebilmeli
      (mssql.ConnectionPool as jest.Mock).mockClear();
      
      const pool = await poolManager.getPool();
      expect(pool).toBeDefined();
      expect(mssql.ConnectionPool).toHaveBeenCalledTimes(1);
    });
    
    it('should throw error if called during shutdown', async () => {
      // Shutdown modunu ayarla
      (poolManager as any).isShuttingDown = true;
      
      await expect(poolManager.getPool()).rejects.toThrow(/during shutdown/);
      
      // Temizle
      (poolManager as any).isShuttingDown = false;
    });
  });
  
  describe('shutdown', () => {
    it('should close the pool and clean up resources', async () => {
      // Önce havuzu oluştur
      const pool = await poolManager.getPool();
      
      // Sonra kapat
      await poolManager.shutdown();
      
      // Havuz kapatıldı mı?
      expect(pool.close).toHaveBeenCalled();
      
      // KeyManagerService kapatıldı mı?
      expect(keyManagerService.shutdown).toHaveBeenCalled();
    });
    
    it('should handle empty pool on shutdown', async () => {
      // Havuz henüz oluşturulmadı - varsayalım
      (poolManager as any).pool = null;
      (poolManager as any).poolPromise = null;
      
      // keyManagerService.shutdown'un mock old
      keyManagerService.shutdown = jest.fn();
      
      // Kapat
      await poolManager.shutdown();
      
      // Hata vermeden tamamlanmalı
      expect(keyManagerService.shutdown).toHaveBeenCalled();
    });
    
    it('should set isShuttingDown flag', async () => {
      // isShuttingDown başlangıç değerini ayarla
      (poolManager as any).isShuttingDown = false;
      
      // keyManagerService.shutdown'un mock olduğundan emin ol
      keyManagerService.shutdown = jest.fn();
      
      // Kapat
      await poolManager.shutdown();
      
      // isShuttingDown ayarlandı mı?
      expect((poolManager as any).isShuttingDown).toBe(true);
    });
    
    it('should reset pool variables after shutdown', async () => {
      // Havuz oluştur
      await poolManager.getPool();
      
      // Kapat
      await poolManager.shutdown();
      
      // Değişkenler sıfırlandı mı?
      expect((poolManager as any).pool).toBeNull();
      expect((poolManager as any).poolPromise).toBeNull();
    });
    
    it('should handle errors during pool close', async () => {
      // Havuz oluştur
      const pool = await poolManager.getPool();
      
      // Kapatma hatası simüle et - reject yerine exception kullan
      pool.close = jest.fn().mockImplementation(() => {
        throw new Error('Close failed');
      });
      
      // Kapat - hata vermeden tamamlanmalı
      await poolManager.shutdown();
      
      // Shutdown işlemi tamamlandı mı?
      expect((poolManager as any).isShuttingDown).toBe(true);
      expect((poolManager as any).pool).toBeNull();
    });
  });
});
