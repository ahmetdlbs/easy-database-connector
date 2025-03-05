// src/drivers/mssql/index.ts
import { DatabaseProvider, ExecuteInput, mssql, PaginatedResult, TransactionInput, PaginationInput } from '../../types/database.types';
import { executeSql } from './execute';
import { dbConfig } from '../../config/database.config';
import { keyManagerService } from './utils/key-manager';

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

    const newPool = new mssql.ConnectionPool(config);
    
    // Handle pool errors
    newPool.on('error', err => {
        console.error('Pool error:', err);
        if (pool === newPool) {
            keyManagerService.cleanupConnection(newPool);
            pool = null;
            poolPromise = null;
        }
    });
    
    return newPool.connect();
};

const getPool = async (): Promise<mssql.ConnectionPool> => {
    if (pool?.connected) {
        return pool;
    }

    if (!poolPromise) {
        poolPromise = createPool().then(newPool => {
            pool = newPool;
            poolPromise = null;
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
        const page = Math.max(1, Number(input.page) || 1);
        const pageSize = Math.max(1, Math.min(1000, Number(input.pageSize) || 10));
        const offset = (page - 1) * pageSize;

        try {
            if (input.encryption?.open) {
                await keyManagerService.manageKey(currentPool, input.encryption.open, input.transaction);
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
        } catch (error) {
            console.error('Pagination query error:', error);
            throw error;
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
            
            // Clean up transaction context
            keyManagerService.cleanupTransaction(currentPool, transaction);
            
            return result;
        } catch (error) {
            try {
                await transaction.rollback();
                
                // Clean up transaction context
                keyManagerService.cleanupTransaction(currentPool, transaction);
            } catch (rollbackError) {
                console.error('Error during transaction rollback:', rollbackError);
            }
            throw error;
        }
    },

    close: async (): Promise<void> => {
        if (pool) {
            try {
                await keyManagerService.manageKey(pool, { aes: false, masterkey: false });
            } catch (error) {
                console.error('Error closing keys during pool shutdown:', error);
            }
            
            await pool.close();
            keyManagerService.cleanupConnection(pool);
            pool = null;
            poolPromise = null;
        }
    }
};