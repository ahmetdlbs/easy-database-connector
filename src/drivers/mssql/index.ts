import { DatabaseConfig, DatabaseProvider, ExecuteInput, mssql, PaginatedResult, PaginatedRecord } from '../../types/database.types';
import { executeSql } from './execute'
import { dbConfig } from '../../config/database.config';

let pool: mssql.ConnectionPool | null = null;

const getPool = async (): Promise<mssql.ConnectionPool> => {
    if (!pool) {
        pool = await new mssql.ConnectionPool({
            server: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password,
            database: dbConfig.database,
            port: dbConfig.port,
            options: {
                encrypt: dbConfig.options?.encrypt,
                trustServerCertificate: dbConfig.options?.trustServerCertificate
            }
        }).connect();
    }
    return pool;
};

export const mssqlProvider: DatabaseProvider = {
    query: async (input: ExecuteInput): Promise<any[]> => {
        const pool = await getPool();
        return await executeSql(pool, input)
    },
    execute: async (input: ExecuteInput): Promise<any[]> => {
        const pool = await getPool();
        return await executeSql(pool, input)
    },
    queryWithPagination: async <T extends Record<string, unknown>>(input: ExecuteInput): Promise<PaginatedResult> => {
        const pool = await getPool();
        const page = input.page || 1;
        const pageSize = input.pageSize || 10;
        const offset = (page - 1) * pageSize;

        const paginatedSql = `WITH Results AS ( SELECT COUNT(*) OVER() AS TotalRows, ROW_NUMBER() OVER(${input.orderBy ? `ORDER BY ${input.orderBy}` : 'ORDER BY (SELECT NULL)'}) AS RowNum, * FROM (${input.sql}) AS BaseQuery ) SELECT * FROM Results WHERE RowNum > ${offset} AND RowNum <= ${offset + pageSize}`;
        const result = await executeSql(pool, { ...input, sql: paginatedSql });
        const total = result[0]?.TotalRows ?? 0;
        
        return {
            totalCount: total,
            pageCount: Math.ceil(total / pageSize),
            page,
            pageSize,
            detail: result.map(({ TotalRows, RowNum, ...rest }: PaginatedRecord) => rest as T),
        };
    },
    transaction: async <T>(callback: (transaction: mssql.Transaction) => Promise<T>): Promise<T> => {
        const pool = await getPool();
        const transaction = new mssql.Transaction(pool);
        await transaction.begin();
        try {
            const result = await callback(transaction);
            await transaction.commit();
            return result;
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
    close: async (): Promise<void> => {
        if (pool) {
            await pool.close();
            pool = null;
        }
    }
};