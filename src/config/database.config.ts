import { DatabaseConfig, RedisConfig,DatabaseType } from '../types/database.types';
import dotenv from 'dotenv';

dotenv.config();

export const dbConfig: DatabaseConfig = {
    type: (process.env.DB_TYPE as DatabaseType) || 'mssql',
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || '',
    port: parseInt(process.env.DB_PORT || '3306'),
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true
    },
    symmetricKeyName: process.env.MSSQL_SYNNETRIC_KEY_NAME, 
    certificateName: process.env.MSSQL_CERTIFICATE_NAME, 
};

export const redisConfig: RedisConfig = {
    enabled: process.env.REDIS_ENABLED === 'true',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    ttl: parseInt(process.env.REDIS_TTL || '3600')
};