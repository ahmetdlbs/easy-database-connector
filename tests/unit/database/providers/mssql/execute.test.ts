import { executeSql, bulkEncrypt, bulkProcess } from '../../../../../src/database/providers/mssql/execute';
import { keyManagerService } from '../../../../../src/database/providers/mssql/key-manager';
import { mssql, MockConnectionPool, MockRequest, MockTransaction, MockTable } from '../../../../mocks/mssql.mock';
import { ColumnType } from '../../../../../src/types';

// MSSQL modülünü mockla
jest.mock('mssql', () => {
  const mockMssql = require('../../../../mocks/mssql.mock').mssql;
  return mockMssql;
});

// KeyManagerService modülünü mockla
jest.mock('../../../../../src/database/providers/mssql/key-manager', () => {
  return {
    keyManagerService: {
      manageKey: jest.fn().mockImplementation(() => {
        return Promise.resolve('mock-connection-id');
      }),
      cleanupTransaction: jest.fn()
    }
  };
});

// Config modülünü mockla
jest.mock('../../../../../src/config', () => {
  return {
    config: {
      database: {
        symmetricKeyName: 'test-symmetric-key'
      }
    }
  };
});

describe('MSSQL Execute Module', () => {
  let pool: MockConnectionPool;
  
  beforeEach(() => {
    // Her test öncesinde yeni bir ConnectionPool oluştur
    pool = new MockConnectionPool();
    
    // Mock'ları temizle
    jest.clearAllMocks();
  });
  
  describe('executeSql', () => {
    it('should execute a basic query with no parameters', async () => {
      const result = await executeSql(pool as any, {
        sql: 'SELECT * FROM users'
      });
      
      const request = pool.request();
      expect(request.query).toHaveBeenCalledWith('SELECT * FROM users');
      expect(result).toBeDefined();
    });
    
    it('should execute a query with parameters', async () => {
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users WHERE id = @p0',
        parameters: [1]
      });
      
      const request = pool.request();
      expect(request.input).toHaveBeenCalledWith('p0', 1);
      expect(request.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = @p0');
    });
    
    it('should handle parameters of different types', async () => {
      const date = new Date();
      const buffer = Buffer.from('test');
      
      await executeSql(pool as any, {
        sql: 'INSERT INTO users VALUES (@p0, @p1, @p2, @p3, @p4)',
        parameters: [1, 'test', date, buffer, null]
      });
      
      const request = pool.request();
      expect(request.input).toHaveBeenCalledWith('p0', 1);
      expect(request.input).toHaveBeenCalledWith('p1', 'test');
      expect(request.input).toHaveBeenCalledWith('p2', mssql.DateTime, date);
      expect(request.input).toHaveBeenCalledWith('p3', mssql.VarBinary, buffer);
      expect(request.input).toHaveBeenCalledWith('p4', null);
    });
    
    it('should execute a query with a transaction', async () => {
      const transaction = new MockTransaction();
      
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users',
        transaction: transaction as any
      });
      
      expect(mssql.Request).toHaveBeenCalledWith(transaction);
    });
    
    it('should open encryption keys if encryption is specified', async () => {
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users',
        encryption: {
          open: { aes: true }
        }
      });
      
      expect(keyManagerService.manageKey).toHaveBeenCalledWith(
        pool,
        { aes: true },
        undefined,
        undefined
      );
    });
    
    it('should close encryption keys after execution if not in a transaction', async () => {
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users',
        encryption: {
          open: { aes: true }
        }
      });
      
      expect(keyManagerService.manageKey).toHaveBeenCalledTimes(2);
      expect(keyManagerService.manageKey).toHaveBeenLastCalledWith(
        pool,
        { aes: false, masterkey: false },
        undefined,
        'mock-connection-id'
      );
    });
    
    it('should not close encryption keys if in a transaction', async () => {
      const transaction = new MockTransaction();
      
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users',
        encryption: {
          open: { aes: true }
        },
        transaction: transaction as any
      });
      
      expect(keyManagerService.manageKey).toHaveBeenCalledTimes(1);
    });
    
    it('should throw an error if pool is not initialized', async () => {
      await expect(executeSql(null as any, {
        sql: 'SELECT * FROM users'
      })).rejects.toThrow('Veritabanı havuzu başlatılmamış');
    });
  });
  
  describe('bulkEncrypt', () => {
    it('should encrypt values in batches', async () => {
      const values = ['value1', 'value2', 'value3'];
      
      const mockRequest = pool.request();
      mockRequest.query.mockResolvedValue({
        recordset: [
          { encrypted: Buffer.from('encrypted1') },
          { encrypted: Buffer.from('encrypted2') },
          { encrypted: Buffer.from('encrypted3') }
        ]
      });
      
      const result = await bulkEncrypt(
        pool as any,
        values
      );
      
      expect(keyManagerService.manageKey).toHaveBeenCalled();
      expect(mockRequest.input).toHaveBeenCalledWith('values', mssql.NVarChar(mssql.MAX), JSON.stringify(values));
      expect(mockRequest.query).toHaveBeenCalledWith(expect.stringMatching(/EncryptByKey/));
      expect(result).toHaveLength(3);
    });
    
    it('should handle empty values array', async () => {
      const result = await bulkEncrypt(
        pool as any,
        []
      );
      
      expect(result).toEqual([]);
      expect(keyManagerService.manageKey).not.toHaveBeenCalled();
      expect(pool.request().query).not.toHaveBeenCalled();
    });
    
    it('should reuse provided connection ID', async () => {
      await bulkEncrypt(
        pool as any,
        ['value'],
        undefined,
        'existing-connection-id'
      );
      
      expect(keyManagerService.manageKey).toHaveBeenCalledWith(
        pool,
        { aes: true, masterkey: true },
        undefined,
        'existing-connection-id'
      );
    });
  });
  
  describe('bulkProcess', () => {
    // Mock Table sınıfını ayarla
    let mockTable: MockTable;
    
    beforeEach(() => {
      mockTable = new MockTable();
      mssql.Table.mockReturnValue(mockTable);
    });
    
    it('should process bulk data without encryption', async () => {
      const data = [
        { id: 1, name: 'Test 1' },
        { id: 2, name: 'Test 2' }
      ];
      
      const columns: ColumnType[] = [
        ['id', mssql.Int()],
        ['name', mssql.NVarChar(100)]
      ];
      
      await bulkProcess(
        pool as any,
        'users',
        data,
        columns,
        undefined,
        1000
      );
      
      // Table oluşturuldu mu?
      expect(mssql.Table).toHaveBeenCalledWith('users');
      
      // Bulk işlemi çağrıldı mı?
      const mockRequest = new mssql.Request();
      expect(mockRequest.bulk).toHaveBeenCalled();
    });
    
    it('should create a transaction if none provided', async () => {
      const mockTransaction = new MockTransaction();
      mssql.Transaction.mockImplementation(() => mockTransaction);
      
      const data = [{ name: 'Test' }];
      const columns: ColumnType[] = [['name', mssql.NVarChar(100)]];
      
      await bulkProcess(
        pool as any,
        'users',
        data,
        columns,
        undefined,
        1000
      );
      
      // Transaction başlatıldı mı?
      expect(mockTransaction.begin).toHaveBeenCalled();
      
      // İşlem tamamlandı mı?
      expect(mockTransaction.commit).toHaveBeenCalled();
    });
    
    it('should use provided transaction', async () => {
      const transaction = new MockTransaction();
      
      const data = [{ name: 'Test' }];
      const columns: ColumnType[] = [['name', mssql.NVarChar(100)]];
      
      await bulkProcess(
        pool as any,
        'users',
        data,
        columns,
        undefined,
        1000,
        transaction as any
      );
      
      // Sağlanan transaction'ı başlatmamalı
      expect(transaction.begin).not.toHaveBeenCalled();
      
      // Sağlanan transaction'ı commit etmemeli
      expect(transaction.commit).not.toHaveBeenCalled();
    });
    
    it('should rollback transaction on error', async () => {
      const mockTransaction = new MockTransaction();
      mssql.Transaction.mockImplementation(() => mockTransaction);
      
      const mockRequest = new mssql.Request();
      mockRequest.bulk.mockRejectedValue(new Error('Bulk insert error'));
      
      const data = [{ name: 'Test' }];
      const columns: ColumnType[] = [['name', mssql.NVarChar(100)]];
      
      await expect(bulkProcess(
        pool as any,
        'users',
        data,
        columns,
        undefined,
        1000
      )).rejects.toThrow();
      
      // Transaction geri alındı mı?
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });
    
    it('should handle empty data array', async () => {
      const result = await bulkProcess(
        pool as any,
        'users',
        [],
        [['name', mssql.NVarChar(100)]],
        undefined,
        1000
      );
      
      expect(result).toBeUndefined();
      expect(mssql.Table).not.toHaveBeenCalled();
    });
  });
});
