import { ErrorCode } from '../../src/common/errors';

// ErrorCode mockunu dışa aktar
export { ErrorCode };

// Config mock
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
