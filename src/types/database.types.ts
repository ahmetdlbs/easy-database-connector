// Veritabanı işlemleri için tip tanımlamaları
import * as mssql from 'mssql';
import { ExecuteOptions, PaginationResult, QueryOptions, QueryWithPaginationOptions } from './query.types';

export { mssql };

// MSSQL kütüphanesi ile uyumlu SQL değer tipi
export type SqlValue = string | number | boolean | Date | Buffer | null | undefined;

export interface DatabaseRecord {
    [key: string]: any;
}

export type ColumnType = [string, mssql.ISqlTypeWithNoParams | string, mssql.IColumnOptions?];

export interface Row {
    [key: string]: any;
}

export interface DatabaseResultWithCount extends DatabaseRecord {
    TotalCount: number;
    RowNum: number;
}

export interface DatabaseProvider {
    query: <T>(options: QueryOptions) => Promise<T[]>;
    execute: (options: ExecuteOptions) => Promise<unknown[]>;
    queryWithPagination: <T>(options: QueryWithPaginationOptions) => Promise<PaginationResult<T>>;
    transaction: <T>(callback: (transaction: mssql.Transaction) => Promise<T>) => Promise<T>;
    close: () => Promise<void>;
}
