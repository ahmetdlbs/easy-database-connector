// Yapılandırma için tip tanımlamaları

export type DatabaseType = 'mysql' | 'mssql';

export interface DatabaseConfig {
    type: DatabaseType;
    host: string;
    user: string;
    password: string;
    database: string;
    port?: number;
    options?: {
        encrypt?: boolean;
        trustServerCertificate?: boolean;
    };
    symmetricKeyName?: string;
    certificateName?: string;
    masterKeyPassword?: string;
}

export interface RedisConfig {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
    ttl: number;
}

export interface LoggerConfig {
    level: 'debug' | 'info' | 'warn' | 'error';
}

export interface AppConfig {
    database: DatabaseConfig;
    redis: RedisConfig;
    logger: LoggerConfig;
}
