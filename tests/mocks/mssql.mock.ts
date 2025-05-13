import { EventEmitter } from 'events';
import { ColumnType } from '../../src/types';

// MSSQL modülü için mock
const mockRecordset = [
  { id: 1, name: 'Test User 1', email: 'test1@example.com' },
  { id: 2, name: 'Test User 2', email: 'test2@example.com' },
];

const mockRecordsets = [mockRecordset];

// Jest mock fonksiyonları için tip tanımları
type JestMockFunction<T = any, Y extends any[] = any[]> = 
  jest.Mock<T, Y> & {
    mockClear: () => JestMockFunction<T, Y>;
    mockReset: () => JestMockFunction<T, Y>;
    mockImplementation: (fn: (...args: Y) => T) => JestMockFunction<T, Y>;
    mockResolvedValue: (value: T) => JestMockFunction<T, Y>;
    mockRejectedValue: (value: any) => JestMockFunction<T, Y>;
    mockResolvedValueOnce: (value: T) => JestMockFunction<T, Y>;
    mockRejectedValueOnce: (value: any) => JestMockFunction<T, Y>;
    mockReturnValue: (value: T) => JestMockFunction<T, Y>;
    mockReturnThis: () => JestMockFunction<T, Y>;
  };

// Tiplerini düzgün belirten mock sınıfları
class MockRequest extends EventEmitter {
  public query: JestMockFunction<Promise<any>> = jest.fn().mockResolvedValue({ recordset: mockRecordset, recordsets: mockRecordsets });
  public batch: JestMockFunction<Promise<any>> = jest.fn().mockResolvedValue({ recordset: mockRecordset, recordsets: mockRecordsets });
  public input: JestMockFunction<MockRequest> = jest.fn().mockReturnThis();
  public output: JestMockFunction<MockRequest> = jest.fn().mockReturnThis();
  public execute: JestMockFunction<Promise<any>> = jest.fn().mockResolvedValue({ recordset: mockRecordset, recordsets: mockRecordsets });
  public cancel: JestMockFunction<MockRequest> = jest.fn().mockReturnThis();
  public bulk: JestMockFunction<Promise<any>> = jest.fn().mockResolvedValue({ rowsAffected: 1 });
  public parameters: Record<string, any> = {};
}

// Mock Transaction sınıfı
class MockTransaction extends EventEmitter {
  public begin: JestMockFunction<Promise<MockTransaction>> = jest.fn().mockResolvedValue(this);
  public commit: JestMockFunction<Promise<MockTransaction>> = jest.fn().mockResolvedValue(this);
  public rollback: JestMockFunction<Promise<MockTransaction>> = jest.fn().mockResolvedValue(this);
  public isolationLevel = 0;
}

// Mock Table sınıfı
class MockTable {
  public create: JestMockFunction = jest.fn();
  public columns = { add: jest.fn() };
  public rows = { 
    add: jest.fn(),
    length: 0
  };
}

// Mock ConnectionPool sınıfı
class MockConnectionPool extends EventEmitter {
  public connected = true;
  public connecting = false;
  public close = jest.fn().mockResolvedValue(undefined) as JestMockFunction<Promise<void>>;
  public connect = jest.fn().mockResolvedValue(this) as JestMockFunction<Promise<MockConnectionPool>>;
  public request = jest.fn().mockImplementation(() => new MockRequest()) as JestMockFunction<MockRequest>;
  public transaction = jest.fn().mockImplementation(() => new MockTransaction()) as JestMockFunction<MockTransaction>;
  
  constructor() {
    super();
  }
  
  // EventEmitter.on metodunu extend et
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    return this;
  }
}

// Gerçek MSSQL mock
const mockSqlModule = {
  ConnectionPool: jest.fn().mockImplementation(() => new MockConnectionPool()),
  Request: jest.fn().mockImplementation(() => new MockRequest()),
  Transaction: jest.fn().mockImplementation(() => new MockTransaction()),
  Table: jest.fn().mockImplementation(() => new MockTable()),
  MAX: Number.MAX_SAFE_INTEGER,
  VarChar: jest.fn().mockReturnValue({ type: 'VarChar' }),
  NVarChar: jest.fn().mockReturnValue({ type: 'NVarChar' }),
  Int: jest.fn().mockReturnValue({ type: 'Int' }),
  DateTime: jest.fn().mockReturnValue({ type: 'DateTime' }),
  VarBinary: jest.fn().mockReturnValue({ type: 'VarBinary' }),
  TYPES: {
    NVarChar: { type: 'NVarChar' }
  },
  RequestError: class RequestError extends Error {
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'RequestError';
      this.code = code || 'UNKNOWN';
      this.number = 0;
    }
    code: string;
    number: number;
  },
  connect: jest.fn().mockResolvedValue(new MockConnectionPool()),
};

// SQL hata numaraları için sabitler
const SQL_ERROR_NUMBERS = {
  KEY_ALREADY_OPEN: 15466,
  MASTER_KEY_NOT_FOUND: 15581,
  SYMMETRIC_KEY_NOT_FOUND: 15208,
  CERTIFICATE_NOT_FOUND: 15151,
};

// Özel hata oluşturma fonksiyonu
function createSqlError(message: string, number: number): any {
  const error = new Error(message);
  (error as any).number = number;
  return error;
}

const mssql = mockSqlModule;

export { 
  mssql, 
  MockConnectionPool, 
  MockRequest, 
  MockTransaction, 
  MockTable,
  mockRecordset, 
  mockRecordsets, 
  SQL_ERROR_NUMBERS, 
  createSqlError 
};
