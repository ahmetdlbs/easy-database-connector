import { createClient, RedisClientType } from 'redis';
import { redisConfig } from '../config/database.config';

let client: RedisClientType | null = null;

const getClient = async (): Promise<RedisClientType | null> => {
    if (!redisConfig.enabled) return null;

    if (!client) {
        client = createClient({
            socket: {
                host: redisConfig.host,
                port: redisConfig.port
            },
            password: redisConfig.password
        });

        await client.connect();
    }
    return client;
};

export const redisService = {
    get: async <T>(key: string): Promise<T | null> => {
        const client = await getClient();
        if (!client) return null;

        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    },

    set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
        const client = await getClient();
        if (!client) return;
        await client.setEx(key, (ttl ? ttl : redisConfig.ttl), JSON.stringify(value));
    },

    del: async (patterns: string | string[]): Promise<void> => {
        const client = await getClient();
        if (!client) return;
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];

        for (const pattern of patternArray) {
            const keys = await client.keys(pattern);
            if (keys.length) {
                await client.del(keys);
            }
        }
    },
    client: () => {
        return getClient();
    }
};