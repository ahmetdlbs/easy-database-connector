import dotenv from 'dotenv';
import { AppConfig, DatabaseConfig, DatabaseType, RedisConfig } from '../types';

// .env dosyasını yükle
dotenv.config();

// Veritabanı yapılandırması
const database: DatabaseConfig = {
    type: (process.env.DB_TYPE as DatabaseType) || 'mssql',
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || '',
    port: parseInt(process.env.DB_PORT || '1433'),
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true
    },
    symmetricKeyName: process.env.MSSQL_SYNNETRIC_KEY_NAME,
    certificateName: process.env.MSSQL_CERTIFICATE_NAME,
    masterKeyPassword: process.env.MASTER_KEY_PASSWORD
};

// Redis yapılandırması
const redis: RedisConfig = {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    ttl: parseInt(process.env.REDIS_TTL || '3600'),
};

// Logger yapılandırması
const logger = {
    level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
};

// Uygulama yapılandırması
export const config: AppConfig = {
    database,
    redis,
    logger,
};
