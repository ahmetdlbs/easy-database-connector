import { mssqlProvider } from '../drivers/mssql/index';
import { redisService } from '../services/redis.service';
import { DatabaseRecord, ExecuteInput, PaginatedResult } from '../types/database.types';

const provider = mssqlProvider;

export async function query<T extends DatabaseRecord>(input: ExecuteInput): Promise<T[]> {
    try {
        if (input?.cache) {
            const cached = await redisService.get<T[]>(input.cache.key);
            if (cached) return cached;
        }

        const result = await provider.query<T>(input);

        if (input?.cache) {
            await redisService.set(input.cache.key, result);
        }

        return result;
    } catch (error) {
        throw error
    }
}
export async function execute(input: ExecuteInput): Promise<any[]> {
    try {
        if (input.cache) {
            await redisService.del(input.cache.key);
        }

        return await provider.execute(input);
    } catch (error) {
        throw error
    }
}
export async function transaction<T>(callback: (trx: any) => Promise<T>): Promise<T> {
    try {
        return provider.transaction(callback);
    } catch (error) {
        throw error
    }
}
export async function queryWithPagination(input: ExecuteInput): Promise<PaginatedResult> {
    try {
        if (input?.cache) {
            const cached = await redisService.get(input.cache.key);
            if (cached) return cached as PaginatedResult;
        }

        const result = await provider.queryWithPagination(input);
        
        if (input?.cache) {
            await redisService.set(input.cache.key, result, input.cache?.ttl);
        }

        return result;
    } catch (error) {
        throw error;
    }
}