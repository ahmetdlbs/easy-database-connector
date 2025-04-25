// Mock sağlayıcısını oluştur
export const mockProvider = {
  query: jest.fn().mockResolvedValue([{ id: 1, name: 'Test' }]),
  execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
  queryWithPagination: jest.fn().mockResolvedValue({
    detail: [{ id: 1, name: 'Test' }],
    totalCount: 1,
    pageCount: 1,
    page: '1',
    pageSize: 10
  }),
  transaction: jest.fn().mockImplementation(async (callback) => {
    return callback('tx-mock');
  }),
  close: jest.fn().mockResolvedValue(undefined)
};

// Mock yapılandırma
export const mockConfig = {
  database: {
    type: 'mssql',
    host: 'localhost',
    user: 'test-user',
    password: 'test-password',
    database: 'test-db',
    port: 1433,
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
    symmetricKeyName: 'test-symmetric-key',
    certificateName: 'test-certificate',
    masterKeyPassword: 'test-master-key-password'
  },
  redis: {
    enabled: true,
    host: 'localhost',
    port: 6379,
    password: 'test-redis-password',
    ttl: 3600,
  },
  logger: {
    level: 'info',
  },
};

// Mock redis service
export const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
};

// Mock logger
export const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};
