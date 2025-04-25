// Sorgu işlemleri için tip tanımlamaları
import { SqlValue } from './database.types';

export interface CacheOptions {
    key: string;
    ttl?: number;
}

export interface EncryptionOptions {
    open: boolean | { aes?: boolean; masterkey?: boolean };
    data?: string[];
}

export interface PaginationOptions {
    page?: number;
    pageSize?: number;
    orderBy?: string;
}

export interface Pagination {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}


export interface PaginationResult<T> {
    detail: T[];
    totalCount: number,
    pageCount: number
    page: string,
    pageSize: number,
}

export interface QueryOptions {
    sql: string;
    parameters?: SqlValue[];
    encryption?: EncryptionOptions;
    cache?: CacheOptions;
    transaction?: any; // Gerçek tipi database.types.ts'de tanımlanacak
}

export interface QueryWithPaginationOptions extends QueryOptions, PaginationOptions {}

export interface BulkOptions {
    columns: any[]; // Gerçek tipi database.types.ts'de tanımlanacak
    batchSize?: number;
}

export interface ExecuteOptions extends QueryOptions {
    bulk?: BulkOptions;
}
