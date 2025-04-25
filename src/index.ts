// Temel veritabanı işlevleri
export { query, execute, transaction, queryWithPagination, closeConnections } from './database';

// Redis servisi
export { redisService } from './services';

// Tipleri ve sabitleri dışa aktar
export { mssql } from './types';

// Config
export { config } from './config';

// Sürüm bilgisi
export const VERSION = '1.3.0';

// Uygulama bilgisi
export const INFO = {
    name: 'easy-database-connector',
    version: VERSION,
    description: 'A flexible database connector service with MSSQL support, pagination, caching, and encryption'
};