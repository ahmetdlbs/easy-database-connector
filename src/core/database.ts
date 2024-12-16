import { mssqlProvider } from '../drivers/mssql/index';
import { redisService } from '../services/redis.service';
import { DatabaseRecord, ExecuteInput, PaginatedResult } from '../types/database.types';
import { mssql } from '../types/database.types';

const provider = mssqlProvider;

export async function query<T extends DatabaseRecord>(input: ExecuteInput & { transaction?: mssql.Transaction }): Promise<T[]> {
    try {
        if (input?.cache && !input.transaction) {
            const cached = await redisService.get<T[]>(input.cache.key);
            if (cached) return cached;
        }

        const result = await provider.query<T>(input);

        if (input?.cache && !input.transaction) {
            await redisService.set(input.cache.key, result, input.cache?.ttl);
        }

        return result;
    } catch (error) {
        console.error('Query error:', error);
        throw error;
    }
}

export async function execute(input: ExecuteInput & { transaction?: mssql.Transaction }): Promise<any[]> {
    try {
        if (input.cache) {
            await redisService.del(input.cache.key);
        }

        return await provider.execute(input);
    } catch (error) {
        console.error('Execute error:', error);
        throw error;
    }
}

export async function transaction<T>( callback: (transaction: mssql.Transaction) => Promise<T>): Promise<T> {
    return provider.transaction(callback);
}

export async function queryWithPagination(input: ExecuteInput & { transaction?: mssql.Transaction }): Promise<PaginatedResult> {
    try {
        if (input?.cache && !input.transaction) {
            const cached = await redisService.get<PaginatedResult>(input.cache.key);
            if (cached) return cached;
        }

        const result = await provider.queryWithPagination(input);
        
        if (input?.cache && !input.transaction) {
            await redisService.set(input.cache.key, result, input.cache?.ttl);
        }

        return result;
    } catch (error) {
        console.error('Pagination query error:', error);
        throw error;
    }
}