import { createClient, RedisClientType, RedisDefaultModules, RedisFunctions, RedisScripts } from 'redis';
import { redisConfig } from '../config/database.config';
type RedisClient = RedisClientType<RedisDefaultModules, RedisFunctions, RedisScripts>;

let client: RedisClient | null = null;
let connectionAttempts = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000;

const initializeClient = () => {
    if (redisConfig.enabled && !client) {
        client = createClient({
            socket: {
                host: redisConfig.host,
                port: redisConfig.port,
                connectTimeout: 10000,
                reconnectStrategy: (retries) => {
                    if (retries > MAX_RETRIES) {
                        console.error(`Failed to connect to Redis after ${MAX_RETRIES} attempts`);
                        return new Error('Max retries reached');
                    }
                    return RETRY_DELAY;
                }
            },
            password: redisConfig.password
        });

        client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            handleReconnect();
        });

        client.on('connect', () => {
            connectionAttempts = 0;
        });

        client.connect().catch(err => {
            console.error('Error connecting to Redis:', err);
            handleReconnect();
        });
    }
};

const handleReconnect = () => {
    connectionAttempts++;
    if (connectionAttempts < MAX_RETRIES) {
        console.log(`Retrying connection in ${RETRY_DELAY/1000} seconds... (Attempt ${connectionAttempts}/${MAX_RETRIES})`);
        setTimeout(() => {
            client?.disconnect();
            client = null;
            initializeClient();
        }, RETRY_DELAY);
    }
};

initializeClient();

export const redisService = {
    get: async <T>(key: string): Promise<T | null> => {
        if (!client) return null;
        try {
            const data = await client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error(`Error getting Redis key ${key}:`, err);
            return null;
        }
    },

    set: async <T>(key: string, value: T, ttl?: number): Promise<void> => {
        if (!client) return;
        try {
            await client.setEx(key, ttl ?? redisConfig.ttl, JSON.stringify(value));
        } catch (err) {
            console.error(`Error setting Redis key ${key}:`, err);
        }
    },

    del: async (patterns: string | string[]): Promise<void> => {
        if (!client) return;
        try {
            const patternArray = Array.isArray(patterns) ? patterns : [patterns];
            for (const pattern of patternArray) {
                const keys = await client.keys(pattern);
                if (keys.length) {
                    await client.del(keys);
                }
            }
        } catch (err) {
            console.error('Error deleting Redis keys:', err);
        }
    },

    client: (): RedisClient | null => {
        return client;
    }
};