import { createClient, RedisClientType } from 'redis';
import { redisConfig } from '../config/database.config';

let client: RedisClientType | null = null;
let connectionPromise: Promise<RedisClientType> | null = null;

const getConnection = async (): Promise<RedisClientType> => {
    if (connectionPromise) return connectionPromise;
    if (client?.isOpen) return client;

    connectionPromise = (async () => {
        try {
            if (!client || !client.isOpen) {
                client = createClient({
                    socket: {
                        host: redisConfig.host,
                        port: redisConfig.port,
                        connectTimeout: 20000,
                        keepAlive: 30000
                    },
                    password: redisConfig.password
                });

                client.on('error', (err) => console.error('Redis Error:', err));
                
                await client.connect();
            }
            return client;
        } catch (err) {
            connectionPromise = null;
            throw err;
        }
    })();

    return connectionPromise;
};

const cleanup = async () => {
    if (client?.isOpen) {
        await client.quit();
        client = null;
        connectionPromise = null;
    }
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

export const redisService = {
    get: async <T>(key: string): Promise<T | null> => {
        try {
            const redis = await getConnection();
            const data = await redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error(`Redis get error - ${key}:`, err);
            throw err;
        }
    },

    set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
        try {
            const redis = await getConnection();
            await redis.setEx(key, ttl ?? redisConfig.ttl, JSON.stringify(value));
        } catch (err) {
            console.error(`Redis set error - ${key}:`, err);
            throw err;
        }
    },

    del: async (patterns: string | string[]): Promise<void> => {
        try {
            const redis = await getConnection();
            const keys = Array.isArray(patterns)
                ? await Promise.all(patterns.map(p => redis.keys(p)))
                : await redis.keys(patterns);
            
            const allKeys = keys.flat();
            if (allKeys.length) {
                await redis.del(allKeys);
            }
        } catch (err) {
            console.error('Redis delete error:', err);
            throw err;
        }
    }
};