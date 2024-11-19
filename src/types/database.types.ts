import * as mssql from 'mssql';

export { mssql };

export type DatabaseType = 'mysql' | 'mssql';

export interface DatabaseConfig {
    type: 'mysql' | 'mssql';
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
}

export interface RedisConfig {
    enabled: boolean;
    host: string;
    port: number;
    password?: string;
    ttl: number;
}
export interface Pagination {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}



export interface QueryResult<T> {
    data: T[];
    pagination: Pagination;
}

export interface Row {
    [key: string]: any;
}

export interface BulkInsertData {
    tableName: string;
    data: Row[];
}

export interface DatabaseRecord {
    [key: string]: any;
}

// Pagination metadata
export interface PaginationMeta {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

// Database result with count
export interface DatabaseResultWithCount extends DatabaseRecord {
    TotalCount: number;
    RowNum: number;
}

// Final paginated response
export interface PaginatedResult {
    data: DatabaseRecord[];
    pagination: PaginationMeta;
}
export interface EncryptionOptions {
    open: boolean;
    data: string[];
}


export type ColumnType = [string, mssql.ISqlTypeWithNoParams | string, mssql.IColumnOptions?];
export type ExecuteInput = string | BulkInsertData | any;

export interface DatabaseProvider {
    query: <T>(input: ExecuteInput) => Promise<T[]>;
    execute: (input: ExecuteInput) => Promise<unknown[]>;
    queryWithPagination: <T>(input: ExecuteInput) => Promise<PaginatedResult>;
    transaction: <T>(callback: (transaction: mssql.Transaction) => Promise<T>) => Promise<T>;
    close: () => Promise<void>;
}

export interface PaginatedRecord {
    TotalRows: number;
    RowNum: number;
    [key: string]: unknown;
}