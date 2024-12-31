import { DatabaseProvider, ExecuteInput, mssql, PaginatedResult, TransactionInput, PaginationInput } from '../../types/database.types';
import { executeSql } from './execute';
import { dbConfig } from '../../config/database.config';
import { manageKey } from './utils/manageKey';


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
        input: PaginationInput
    ): Promise<PaginatedResult> => {
        const currentPool = await getPool();
        const page = Number.isInteger(Number(input.page)) && Number(input.page) >= 0 ? Number(input.page) : 1;
        const pageSize = Math.max(1, Math.min(1000, Number(input.pageSize) || 10));
        const offset = page * pageSize;

        let keyOpened = false;
        try {
            if (input.encryption?.open) {
                await manageKey(currentPool, true, input.transaction);
                keyOpened = true;
            }

            const orderByRegex = /\bORDER\s+BY\s+(.+?)$/i;
            const orderByMatch = input.sql.match(orderByRegex);
            const baseQuery = input.sql.replace(orderByRegex, '');

            const orderByClause = input.orderBy || (orderByMatch ? orderByMatch[1] : 'CURRENT_TIMESTAMP');

            const [{ total }] = await executeSql(currentPool, {
                ...input,
                sql: `SELECT COUNT(1) as total FROM (${baseQuery}) AS CountQuery`
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

            const newParameters = [...(input.parameters || []), offset, pageSize];
            const results = await executeSql(currentPool, {
                ...input,
                sql: ` SELECT mainQuery.* FROM (${baseQuery}) AS mainQuery ORDER BY ${orderByClause} OFFSET @p${newParameters.length - 2} ROWS FETCH NEXT @p${newParameters.length - 1} ROWS ONLY`,
                parameters: newParameters
            });

            return {
                totalCount: total,
                pageCount: Math.ceil(total / pageSize),
                page: page.toString(),
                pageSize,
                detail: results as T[]
            };
        } finally {
            if (keyOpened) {
                await manageKey(currentPool, false, input.transaction).catch(console.error);
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