import { DatabaseProvider, ExecuteInput, mssql, PaginatedResult } from '../../types/database.types';
import { executeSql } from './execute';
import { dbConfig } from '../../config/database.config';
import { manageKey } from './utils/manageKey';

interface TransactionInput {
    transaction?: mssql.Transaction;
}

let pool: mssql.ConnectionPool | null = null;
let poolPromise: Promise<mssql.ConnectionPool> | null = null;

const createPool = async (): Promise<mssql.ConnectionPool> => {
    const config: mssql.config = {
        server: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port,
        options: {
            encrypt: dbConfig.options?.encrypt,
            trustServerCertificate: dbConfig.options?.trustServerCertificate,
            enableArithAbort: true,
        },
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        },
        connectionTimeout: 30000,
        requestTimeout: 30000
    };

    return new mssql.ConnectionPool(config).connect();
};

const getPool = async (): Promise<mssql.ConnectionPool> => {
    if (pool?.connected) {
        return pool;
    }

    if (!poolPromise) {
        poolPromise = createPool().then(newPool => {
            pool = newPool;
            poolPromise = null;

            newPool.on('error', err => {
                console.error('Pool error:', err);
                pool = null;
                poolPromise = null;
            });

            return newPool;
        });
    }

    return poolPromise;
};

export const mssqlProvider: DatabaseProvider = {
    query: async <T>(input: ExecuteInput & TransactionInput): Promise<T[]> => {
        const currentPool = await getPool();
        return executeSql(currentPool, input);
    },

    execute: async (input: ExecuteInput & TransactionInput): Promise<unknown[]> => {
        const currentPool = await getPool();
        return executeSql(currentPool, input);
    },

    queryWithPagination: async <T extends Record<string, unknown>>(
        input: ExecuteInput & TransactionInput
    ): Promise<PaginatedResult> => {
        const currentPool = await getPool();
        const page = Math.max(1, Number(input.page) || 1);
        const pageSize = Math.max(1, Math.min(1000, Number(input.pageSize) || 10));
        const offset = (page - 1) * pageSize;

        let keyOpened = false;
        try {
            if (input.encryption?.open) {
                await manageKey(currentPool, true,input.transaction);
                keyOpened = true;
            }

            const [{ total }] = await executeSql(currentPool, {
                ...input,
                sql: `SELECT COUNT(1) as total FROM (${input.sql}) AS CountQuery`
            });

            if (!total) {
                return {
                    totalCount: 0,
                    pageCount: 0,
                    page: page.toString(),
                    pageSize,
                    detail: []
                };
            }

            const paginatedSql = `
                WITH PaginatedData AS (
                    SELECT QueryData.*, 
                           ROW_NUMBER() OVER (ORDER BY CURRENT_TIMESTAMP) as RowNum 
                    FROM (${input.sql}) as QueryData
                )
                SELECT * FROM PaginatedData 
                WHERE RowNum > ${offset} AND RowNum <= ${offset + pageSize}
            `;

            const results = await executeSql(currentPool, {
                ...input,
                sql: paginatedSql
            });

            return {
                totalCount: total,
                pageCount: Math.ceil(total / pageSize),
                page: page.toString(),
                pageSize,
                detail: results.map(({ RowNum, ...rest }) => rest) as T[]
            };
        } finally {
            if (keyOpened) {
                await manageKey(currentPool, false,input.transaction).catch(console.error);
            }
        }
    },
    transaction: async <T>(
        callback: (transaction: mssql.Transaction) => Promise<T>
    ): Promise<T> => {
        const currentPool = await getPool();
        const transaction = new mssql.Transaction(currentPool);

        try {
            await transaction.begin();

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
            poolPromise = null;
        }
    }
};