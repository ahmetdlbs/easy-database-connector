import { DatabaseConfig, DatabaseProvider, ExecuteInput, mssql, PaginatedResult, PaginatedRecord } from '../../types/database.types';
import { executeSql } from './execute'

let pool: mssql.ConnectionPool | null = null;

const getPool = async (config: DatabaseConfig): Promise<mssql.ConnectionPool> => {
    if (!pool) {
        pool = await new mssql.ConnectionPool({
            server: config.host,
            user: config.user,
            password: config.password,
            database: config.database,
            port: config.port,
            options: {
                encrypt: config.options?.encrypt,
                trustServerCertificate: config.options?.trustServerCertificate
            }
        }).connect();
    }
    return pool;
};

export const mssqlProvider: DatabaseProvider = {
    query: async (input: ExecuteInput, config: DatabaseConfig): Promise<any[]> => {
        const pool = await getPool(config);
        return await executeSql(pool, input, config)
    },
    execute: async (input: ExecuteInput, config: DatabaseConfig): Promise<any[]> => {
        const pool = await getPool(config);
        return await executeSql(pool, input, config)
    },
    queryWithPagination: async <T extends Record<string, unknown>>( input: ExecuteInput, config: DatabaseConfig ): Promise<PaginatedResult> => {
        const pool = await getPool(config);
        const page = input.page || 1;
        const pageSize = input.pageSize || 10;
        const offset = (page - 1) * pageSize;

        const paginatedSql = `WITH Results AS ( SELECT COUNT(*) OVER() AS TotalRows, ROW_NUMBER() OVER(${input.orderBy ? `ORDER BY ${input.orderBy}` : 'ORDER BY (SELECT NULL)'}) AS RowNum, * FROM (${input.sql}) AS BaseQuery ) SELECT * FROM Results WHERE RowNum > ${offset} AND RowNum <= ${offset + pageSize}`;
        const result = await executeSql(pool, { ...input, sql: paginatedSql }, config);
        const total = result[0]?.TotalRows ?? 0;

        return {
            data: result.map(({ TotalRows, RowNum, ...rest }: PaginatedRecord) => rest as T),
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        };
    },
    transaction: async <T>( callback: (transaction: mssql.Transaction) => Promise<T>, config: DatabaseConfig ): Promise<T> => {
        const pool = await getPool(config);
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