import { createClient, RedisClientType } from 'redis';
import { RedisConfig } from '../types/database.types';

let client: RedisClientType | null = null;

const getClient = async (config: RedisConfig): Promise<RedisClientType | null> => {
    if (!config.enabled) return null;

    if (!client) {
        client = createClient({
            socket: {
                host: config.host,
                port: config.port
            },
            password: config.password
        });

        await client.connect();
    }
    return client;
};

export const redisService = {
    get: async <T>(key: string, config: RedisConfig): Promise<T | null> => {
        const client = await getClient(config);
        if (!client) return null;

        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    },

    set: async <T>(key: string, value: T, config: RedisConfig, ttl?: number): Promise<void> => {
        const client = await getClient(config);
        if (!client) return;
        await client.setEx(key, (ttl ? ttl : config.ttl), JSON.stringify(value));
    },

    del: async (patterns: string | string[], config: RedisConfig): Promise<void> => {
        const client = await getClient(config);
        if (!client) return;
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];

        for (const pattern of patternArray) {
            const keys = await client.keys(pattern);
            if (keys.length) {
                await client.del(keys);
            }
        }
    }
};