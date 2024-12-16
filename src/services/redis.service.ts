import { createClient, RedisClientType, RedisDefaultModules, RedisFunctions, RedisScripts } from 'redis';
import { redisConfig } from '../config/database.config';

type RedisClient = RedisClientType<RedisDefaultModules, RedisFunctions, RedisScripts>;

let client: RedisClient | null = null;
let isConnecting = false;
let reconnectTimeout: NodeJS.Timeout | null = null;

const createRedisClient = () => {
    return createClient({
        socket: {
            host: redisConfig.host,
            port: redisConfig.port,
            connectTimeout: 5000,
            keepAlive: 5000,
            reconnectStrategy: (retries) => {
                if (retries > 10) return new Error('Max retries reached');
                return Math.min(retries * 1000, 3000);
            }
        },
        password: redisConfig.password
    });
};

const connect = async (): Promise<RedisClient> => {
    if (client?.isOpen) return client;
    if (isConnecting) {
        while (isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (client?.isOpen) return client;
    }

    isConnecting = true;
    try {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }

        client = createRedisClient();

        client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            if (client?.isOpen) {
                client.quit().catch(console.error);
            }
            client = null;
        });

        await client.connect();
        console.log('Successfully connected to Redis');
        return client;
    } catch (err) {
        console.error('Redis connection error:', err);
        client = null;
        throw err;
    } finally {
        isConnecting = false;
    }
};

export const redisService = {
    client: async (): Promise<RedisClient> => {
        try {
            return await connect();
        } catch (err) {
            throw new Error('Failed to get Redis client');
        }
    },

    get: async <T>(key: string): Promise<T | null> => {
        try {
            const redis = await connect();
            const data = await redis.get(key);
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error(`Error getting Redis key ${key}:`, err);
            return null;
        }
    },

    set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
        try {
            const redis = await connect();
            await redis.setEx(
                key, 
                ttl ?? redisConfig.ttl, 
                JSON.stringify(value)
            );
        } catch (err) {
            console.error(`Error setting Redis key ${key}:`, err);
        }
    },

    del: async (patterns: string | string[]): Promise<void> => {
        try {
            const redis = await connect();
            const patternArray = Array.isArray(patterns) ? patterns : [patterns];
            for (const pattern of patternArray) {
                const keys = await redis.keys(pattern);
                if (keys.length) {
                    await redis.del(keys);
                }
            }
        } catch (err) {
            console.error('Error deleting Redis keys:', err);
        }
    }
};