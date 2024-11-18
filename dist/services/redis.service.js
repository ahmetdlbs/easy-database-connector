"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisService = void 0;
const redis_1 = require("redis");
let client = null;
const getClient = async (config) => {
    if (!config.enabled)
        return null;
    if (!client) {
        client = (0, redis_1.createClient)({
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
exports.redisService = {
    get: async (key, config) => {
        const client = await getClient(config);
        if (!client)
            return null;
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    },
    set: async (key, value, config, ttl) => {
        const client = await getClient(config);
        if (!client)
            return;
        await client.setEx(key, (ttl ? ttl : config.ttl), JSON.stringify(value));
    },
    del: async (patterns, config) => {
        const client = await getClient(config);
        if (!client)
            return;
        const patternArray = Array.isArray(patterns) ? patterns : [patterns];
        for (const pattern of patternArray) {
            const keys = await client.keys(pattern);
            if (keys.length) {
                await client.del(keys);
            }
        }
    }
};
