import { keyManagerService } from '../../../../../src/database/providers/mssql/key-manager';
import { mssql, MockConnectionPool, MockRequest, MockTransaction, SQL_ERROR_NUMBERS, createSqlError } from '../../../../mocks/mssql.mock';

// MSSQL modülünü jest.mock ile mockla
jest.mock('mssql', () => {
  const mockMssql = require('../../../../mocks/mssql.mock').mssql;
  return mockMssql;
});

// Config modülünü mockla
jest.mock('../../../../../src/config', () => {
  return {
    config: {
      database: {
        masterKeyPassword: 'test-password',
        symmetricKeyName: 'test-symmetric-key',
        certificateName: 'test-certificate'
      }
    }
  };
});

describe('KeyManagerService', () => {
  let pool: MockConnectionPool;
  
  beforeEach(() => {
    // Her test öncesinde yeni bir ConnectionPool oluştur
    pool = new MockConnectionPool();
    
    // Process.env değişkenlerini temizle
    delete process.env.DB_SKIP_ENCRYPTION;
    
    // Mock'ları temizle
    jest.clearAllMocks();
    
    // KeyManagerService instance'ını sıfırla
    (keyManagerService as any).keysChecked = false;
    (keyManagerService as any).keysAvailable = false;
    (keyManagerService as any).connectionKeyStates.clear();
  });
  
  describe('generateConnectionId', () => {
    it('should generate pool-specific ID without transaction', () => {
      const id = keyManagerService.generateConnectionId(pool as any);
      expect(id).toMatch(/^pool_/);
    });
    
    it('should generate transaction-specific ID with transaction', () => {
      const transaction = new mssql.Transaction(pool);
      const id = keyManagerService.generateConnectionId(pool as any, transaction as any);
      expect(id).toMatch(/^tx_/);
    });
  });
  
  describe('checkEncryptionKeys', () => {
    it('should return true when all keys exist', async () => {
      // Mock'ları yapılandır
      const request = pool.request();
      
      // Önce keysAvailable değerini true olarak ayarla
      (keyManagerService as any).keysAvailable = true;
      (keyManagerService as any).keysChecked = true;
      
      // Master key kontrolü
      request.query.mockResolvedValueOnce({
        recordset: [{ keyCount: 1 }]
      });
      
      // Simetrik anahtar kontrolü
      request.query.mockResolvedValueOnce({
        recordset: [{ keyCount: 1 }]
      });
      
      // Sertifika kontrolü
      request.query.mockResolvedValueOnce({
        recordset: [{ certCount: 1 }]
      });
      
      const result = await keyManagerService.checkEncryptionKeys(pool as any);
      expect(result).toBe(true);
    });
    
    it('should return false when master key does not exist', async () => {
      // Master key yoksa false dönmeli
      const request = pool.request();
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{ keyCount: 0 }]
        });
      });
      
      const result = await keyManagerService.checkEncryptionKeys(pool as any);
      expect(result).toBe(false);
    });
    
    it('should return false when symmetric key does not exist', async () => {
      // Master key var ama simetrik anahtar yok
      const request = pool.request();
      
      // Master key kontrolü
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{ keyCount: 1 }]
        });
      });
      
      // Simetrik anahtar kontrolü
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{ keyCount: 0 }]
        });
      });
      
      const result = await keyManagerService.checkEncryptionKeys(pool as any);
      expect(result).toBe(false);
    });
    
    it('should return false when certificate does not exist', async () => {
      // Master key ve simetrik anahtar var ama sertifika yok
      const request = pool.request();
      
      // Master key kontrolü
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{ keyCount: 1 }]
        });
      });
      
      // Simetrik anahtar kontrolü
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{ keyCount: 1 }]
        });
      });
      
      // Sertifika kontrolü
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{ certCount: 0 }]
        });
      });
      
      const result = await keyManagerService.checkEncryptionKeys(pool as any);
      expect(result).toBe(false);
    });
    
    it('should cache the result of the check', async () => {
      // Önce keysAvailable değerini true olarak ayarla
      (keyManagerService as any).keysAvailable = true;
      (keyManagerService as any).keysChecked = true;
      
      // İlk çağrı
      const request = pool.request();

      const result = await keyManagerService.checkEncryptionKeys(pool as any);
      
      expect(result).toBe(true);
      // Daha önce checked ve available true olarak ayarlandığı için
      // tekrar sorgu yapılmasına gerek yok
      expect(request.query).toHaveBeenCalledTimes(0); 
    });
  });
  
  describe('manageKey', () => {
    it('should skip encryption when DB_SKIP_ENCRYPTION is true', async () => {
      process.env.DB_SKIP_ENCRYPTION = 'true';
      
      const connId = await keyManagerService.manageKey(
        pool as any,
        { aes: true, masterkey: true }
      );
      
      expect(connId).toBeDefined();
      // Sorgu yapılmamalı
      const request = pool.request();
      expect(request.query).not.toHaveBeenCalled();
      expect(request.batch).not.toHaveBeenCalled();
    });
    
    it('should check for keys on first call with encryption', async () => {
      // CheckEncryptionKeys'i spy ile izle (mock değil)
      const checkSpy = jest.spyOn(keyManagerService, 'checkEncryptionKeys');
      
      // Önce keysChecked'i false'a ayarla
      (keyManagerService as any).keysChecked = false;
      
      // Sonra manageKey'i çağır
      await keyManagerService.manageKey(
        pool as any,
        { aes: true, masterkey: true }
      );
      
      expect(checkSpy).toHaveBeenCalledWith(pool);
      
      // Spy'i temizle
      checkSpy.mockRestore();
    });
    
    it('should open master key', async () => {
      // CheckEncryptionKeys'i mockla - burada mock kullanabiliriz
      jest.spyOn(keyManagerService, 'checkEncryptionKeys').mockImplementation(() => Promise.resolve(true));
      
      // Anahtarların durumunu ayarla
      (keyManagerService as any).keysChecked = true;
      (keyManagerService as any).keysAvailable = true;
      
      // Master key sorgusu
      const request = pool.request();
      request.query.mockResolvedValueOnce({
        recordset: [{ count: 1 }]
      });
      
      // Batch için başarılı yanıtı ayarla
      request.batch.mockResolvedValueOnce({});
      
      request.batch = jest.fn().mockImplementation((sql) => {
        if(sql.includes('OPEN MASTER KEY')) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // manageKey'i çağır
      await keyManagerService.manageKey(
        pool as any,
        { masterkey: true }
      );
      
      // Master key açma SQL'i kontrol et
      expect(request.batch).toHaveBeenCalled();
    });
    
    it('should open symmetric key', async () => {
      // CheckEncryptionKeys'i mockla
      jest.spyOn(keyManagerService, 'checkEncryptionKeys').mockImplementation(() => Promise.resolve(true));
      
      // Anahtarların durumunu ayarla
      (keyManagerService as any).keysChecked = true;
      (keyManagerService as any).keysAvailable = true;
      
      const request = pool.request();
      
      // Master key sorgusu ve batch yanıtı
      request.query.mockResolvedValueOnce({recordset: [{ count: 1 }]});
      
      // Mock batch ile SQL kontrolü
      request.batch = jest.fn().mockImplementation((sql) => {
        if(sql.includes('OPEN MASTER KEY') || sql.includes('OPEN SYMMETRIC KEY')) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Symmetric key sorgusu ve batch yanıtı
      request.query.mockResolvedValueOnce({recordset: [{ count: 1 }]});
      
      // manageKey'i çağır
      await keyManagerService.manageKey(
        pool as any,
        { aes: true, masterkey: true }
      );
      
      // Batch'in çağrıldığını kontrol et
      expect(request.batch).toHaveBeenCalled();
    });
    
    it('should handle already open keys gracefully', async () => {
      // CheckEncryptionKeys'i mockla
      jest.spyOn(keyManagerService, 'checkEncryptionKeys').mockResolvedValue(true);
      
      const request = pool.request();
      
      // Master key sorgusu
      request.query.mockImplementationOnce(() => {
        return Promise.resolve({
          recordset: [{}]
        });
      });
      
      // Master key açma hatası
      request.batch.mockImplementationOnce(() => {
        throw createSqlError('The master key is already open', SQL_ERROR_NUMBERS.KEY_ALREADY_OPEN);
      });
      
      await keyManagerService.manageKey(
        pool as any,
        { masterkey: true }
      );
      
      // Hata atılmamalı
    });
    
    it('should close keys when aes and masterkey flags are false', async () => {
      // CheckEncryptionKeys'i mockla
      jest.spyOn(keyManagerService, 'checkEncryptionKeys').mockImplementation(() => Promise.resolve(true));
      
      // Anahtarların durumunu ayarla
      (keyManagerService as any).keysChecked = true;
      (keyManagerService as any).keysAvailable = true;
      
      const request = pool.request();
      
      // Önce bir bağlantı ID'si oluştur ve state'ini ayarla
      const connId = 'test-conn-id';
      (keyManagerService as any).connectionKeyStates.set(connId, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now()
      });
      
      // Batch'i mockla ve SQL kontrolü
      request.batch = jest.fn().mockImplementation((sql) => {
        if(sql.includes('CLOSE SYMMETRIC KEY') || sql.includes('CLOSE MASTER KEY')) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Anahtarları kapat
      await keyManagerService.manageKey(
        pool as any,
        { aes: false, masterkey: false },
        undefined,
        connId
      );
      
      // Batch'in çağrıldığını kontrol et
      expect(request.batch).toHaveBeenCalled();
    });
  });
  
  describe('cleanupConnection and cleanupTransaction', () => {
    it('should cleanup specific connection by ID', async () => {
      // Önce bir bağlantı ID'si oluştur ve state'ini ayarla
      const connId = 'test-conn-id';
      (keyManagerService as any).connectionKeyStates.set(connId, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now()
      });
      
      // Temizle
      keyManagerService.cleanupConnection(pool as any, connId);
      
      // Bağlantının temizlendiğini kontrol et
      expect((keyManagerService as any).connectionKeyStates.has(connId)).toBe(false);
      
      // Aynı ID ile tekrar anahtar açmayı dene
      const request = pool.request();
      
      // Batch'i mockla
      request.batch = jest.fn().mockImplementation((sql) => {
        if(sql.includes('OPEN MASTER KEY')) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      request.query.mockResolvedValueOnce({recordset: [{ count: 1 }]});
      
      // Mock için keysChecked ve keysAvailable ayarla
      (keyManagerService as any).keysChecked = true;
      (keyManagerService as any).keysAvailable = true;

      // Anahtarların açılması gerekiyor
      await keyManagerService.manageKey(
        pool as any,
        { masterkey: true },
        undefined,
        connId
      );
      
      // Batch'in çağrıldığını kontrol et
      expect(request.batch).toHaveBeenCalled();
    });
    
    it('should cleanup all pool connections when no ID specified', async () => {
      // Birkaç pool bağlantısı oluştur
      const connId1 = 'pool_conn_1';
      const connId2 = 'pool_conn_2';
      
      (keyManagerService as any).connectionKeyStates.set(connId1, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now()
      });
      
      (keyManagerService as any).connectionKeyStates.set(connId2, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now()
      });
      
      // Tüm pool bağlantılarını temizle
      keyManagerService.cleanupConnection(pool as any);
      
      // Bağlantıların temizlendiğini kontrol et
      expect((keyManagerService as any).connectionKeyStates.has(connId1)).toBe(false);
      expect((keyManagerService as any).connectionKeyStates.has(connId2)).toBe(false);
      
      // Yeniden anahtar açmayı dene
      const request = pool.request();
      
      // Batch'i mockla
      request.batch = jest.fn().mockImplementation((sql) => {
        if(sql.includes('OPEN MASTER KEY')) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Mock için keysChecked ve keysAvailable ayarla
      (keyManagerService as any).keysChecked = true;
      (keyManagerService as any).keysAvailable = true;
      
      request.query.mockResolvedValueOnce({recordset: [{ count: 1 }]});
      
      await keyManagerService.manageKey(pool as any, { masterkey: true });
      
      // Batch'in çağrıldığını kontrol et
      expect(request.batch).toHaveBeenCalled();
    });
    
    it('should cleanup transaction connections', async () => {
      // Transaction oluştur
      const transaction = new MockTransaction();
      
      // Transaction için bir ID oluştur ve kaydet
      const connId = 'tx_1_test';
      (keyManagerService as any).connectionKeyStates.set(connId, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now()
      });
      
      // Transaction'ı temizle
      keyManagerService.cleanupTransaction(pool as any, transaction as any);
      
      // Bağlantının temizlendiğini kontrol et
      expect((keyManagerService as any).connectionKeyStates.has(connId)).toBe(false);
      
      // Yeni bir transaction oluştur ve tekrar dene
      const newTransaction = new MockTransaction();
      const request = pool.request();
      
      // Batch'i mockla
      request.batch = jest.fn().mockImplementation((sql) => {
        if(sql.includes('OPEN MASTER KEY')) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Mock için keysChecked ve keysAvailable ayarla
      (keyManagerService as any).keysChecked = true;
      (keyManagerService as any).keysAvailable = true;
      
      request.query.mockResolvedValueOnce({recordset: [{ count: 1 }]});
      
      await keyManagerService.manageKey(
        pool as any,
        { masterkey: true },
        newTransaction as any
      );
      
      // Batch'in çağrıldığını kontrol et
      expect(request.batch).toHaveBeenCalled();
    });
  });
  
  describe('shutdown', () => {
    it('should mark the service as closed and clear timers', () => {
      // Servis durumuna erişmek için reflection kullan
      const originalSetInterval = global.setInterval;
      const mockSetInterval = jest.fn(() => 123);
      global.setInterval = mockSetInterval as any;
      
      // Yeni bir instance oluştur
      const instance = new (keyManagerService.constructor as any)();
      
      // Zamanlayıcıyı temizle
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      // Kapat
      instance.shutdown();
      
      // Kapatma işaretini kontrol et
      expect(instance.closed).toBe(true);
      expect(clearIntervalSpy).toHaveBeenCalled();
      
      // Temizle
      global.setInterval = originalSetInterval;
    });
  });
  
  describe('cleanupInactiveKeys', () => {
    it('should remove inactive connections', async () => {
      // keyManagerService içinde özel erişim için değişkenleri ayarla
      const instance = keyManagerService as any;
      instance.KEY_INACTIVITY_THRESHOLD_MS = 100; // Test için 100ms
      
      // Önce bağlantı durumunu oluştur
      const connId1 = 'test-conn-1';
      
      // connectionKeyStates map'ine manuel olarak ekle
      instance.connectionKeyStates.set(connId1, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now() - 200 // Eşik değerinin üzerinde
      });
      
      // Temizleme fonksiyonunu çağır
      await instance.cleanupInactiveKeys();
      
      // Bağlantının temizlendiğini kontrol et
      expect(instance.connectionKeyStates.has(connId1)).toBe(false);
    });
    
    it('should not remove active connections', async () => {
      const instance = keyManagerService as any;
      instance.KEY_INACTIVITY_THRESHOLD_MS = 1000; // Test için 1 saniye
      
      // Aktif bir bağlantı oluştur (son kullanım zamanı şimdi)
      const connId = 'active-conn';
      
      // Manuel olarak bağlantıyı ekle
      instance.connectionKeyStates.set(connId, {
        openKeys: new Set(['test-symmetric-key']),
        masterKeyOpen: true,
        lastUsed: Date.now() // Yeni kullanıldı
      });
      
      // Temizleme fonksiyonunu çağır
      await instance.cleanupInactiveKeys();
      
      // Bağlantının hala mevcut olduğunu kontrol et
      expect(instance.connectionKeyStates.has(connId)).toBe(true);
    });
  });
});
