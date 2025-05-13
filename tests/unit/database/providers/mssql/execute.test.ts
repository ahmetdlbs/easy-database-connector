import { executeSql, SqlExecutor } from '../../../../../src/database/providers/mssql/execute';
import { sqlServerEncryption } from '../../../../../src/database/providers/mssql/encryption';
import { mssql, MockConnectionPool, MockRequest, MockTransaction, MockTable } from '../../../../mocks/mssql.mock';
import { ColumnType } from '../../../../../src/types';

// MSSQL modülünü mockla
jest.mock('mssql', () => {
  const mockMssql = require('../../../../mocks/mssql.mock').mssql;
  return mockMssql;
});

// Encryption modülünü mockla
jest.mock('../../../../../src/database/providers/mssql/encryption', () => {
  return {
    sqlServerEncryption: {
      initialize: jest.fn().mockResolvedValue(true),
      isEncryptionAvailable: jest.fn().mockReturnValue(true),
      wrapQueryWithEncryption: jest.fn(sql => `/* WRAPPED */ ${sql}`),
      buildEncryptionQuery: jest.fn().mockReturnValue('SELECT EncryptByKey(...) AS encrypted FROM OPENJSON(@values)'),
      encryptValues: jest.fn().mockImplementation((pool, values) => {
        // Mock şifrelenmiş değerleri döndür
        return Promise.resolve(values.map(v => Buffer.from(`encrypted:${v}`)));
      }),
      getDecryptSqlTemplate: jest.fn(col => `CAST(DECRYPTBYKEY(${col}) AS NVARCHAR(MAX))`),
      getEncryptSqlTemplate: jest.fn(val => `ENCRYPTBYKEY(KEY_GUID('test-key'), CONVERT(VARBINARY(MAX), ${val}))`)
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
    
    it('should initialize encryption if encryption is specified', async () => {
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users',
        encryption: {
          open: true
        }
      });
      
      expect(sqlServerEncryption.initialize).toHaveBeenCalledWith(pool);
    });
    
    it('should wrap query with encryption if encryption is available', async () => {
      await executeSql(pool as any, {
        sql: 'SELECT * FROM users',
        encryption: {
          open: true
        }
      });
      
      expect(sqlServerEncryption.wrapQueryWithEncryption).toHaveBeenCalledWith('SELECT * FROM users');
    });
    
    it('should throw an error if pool is not initialized', async () => {
      await expect(executeSql(null as any, {
        sql: 'SELECT * FROM users'
      })).rejects.toThrow('Veritabanı bağlantısı sağlanmadı');
    });
  });
  
  describe('SqlExecutor.encryptValues', () => {
    it('should encrypt values using sqlServerEncryption', async () => {
      const values = ['value1', 'value2', 'value3'];
      
      const result = await SqlExecutor.encryptValues(
        pool as any,
        values
      );
      
      expect(sqlServerEncryption.initialize).toHaveBeenCalled();
      expect(sqlServerEncryption.encryptValues).toHaveBeenCalledWith(pool, values, undefined);
      expect(result).toHaveLength(3);
    });
    
    it('should handle empty values array', async () => {
      const result = await SqlExecutor.encryptValues(
        pool as any,
        []
      );
      
      expect(result).toEqual([]);
      expect(sqlServerEncryption.encryptValues).not.toHaveBeenCalled();
    });
    
    it('should pass transaction to encryption service', async () => {
      const transaction = new MockTransaction();
      
      await SqlExecutor.encryptValues(
        pool as any,
        ['value'],
        transaction as any
      );
      
      expect(sqlServerEncryption.encryptValues).toHaveBeenCalledWith(pool, ['value'], transaction);
    });
  });
  
  describe('SqlExecutor.bulkInsert', () => {
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
      
      await SqlExecutor.bulkInsert(
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
      
      await SqlExecutor.bulkInsert(
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
      
      await SqlExecutor.bulkInsert(
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
      
      await expect(SqlExecutor.bulkInsert(
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
      const result = await SqlExecutor.bulkInsert(
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
    
    it('should process bulk data with encryption', async () => {
      (sqlServerEncryption.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
      
      const data = [
        { id: 1, name: 'Test 1', secret: 'secret1' },
        { id: 2, name: 'Test 2', secret: 'secret2' }
      ];
      
      const columns: ColumnType[] = [
        ['id', mssql.Int()],
        ['name', mssql.NVarChar(100)],
        ['secret', mssql.VarBinary(mssql.MAX)]
      ];
      
      await SqlExecutor.bulkInsert(
        pool as any,
        'users',
        data,
        columns,
        {
          open: true,
          data: ['secret']
        },
        1000
      );
      
      // Şifreleme yapılıyor mu?
      expect(sqlServerEncryption.encryptValues).toHaveBeenCalled();
    });
  });
});
