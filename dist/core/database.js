"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
exports.execute = execute;
exports.transaction = transaction;
exports.queryWithPagination = queryWithPagination;
const index_1 = require("../drivers/mssql/index");
const redis_service_1 = require("../services/redis.service");
const database_config_1 = require("../config/database.config");
const provider = index_1.mssqlProvider;
async function query(input) {
    try {
        if (input === null || input === void 0 ? void 0 : input.cache) {
            const cached = await redis_service_1.redisService.get(input.cache.key, database_config_1.redisConfig);
            if (cached)
                return cached;
        }
        const result = await provider.query(input, database_config_1.dbConfig);
        if (input === null || input === void 0 ? void 0 : input.cache) {
            await redis_service_1.redisService.set(input.cache.key, result, database_config_1.redisConfig);
        }
        return result;
    }
    catch (error) {
        throw error;
    }
}
async function execute(input) {
    try {
        if (input.cache) {
            await redis_service_1.redisService.del(input.cache.key, database_config_1.redisConfig);
        }
        return await provider.execute(input, database_config_1.dbConfig);
    }
    catch (error) {
        throw error;
    }
}
async function transaction(callback) {
    try {
        return provider.transaction(callback, database_config_1.dbConfig);
    }
    catch (error) {
        throw error;
    }
}
async function queryWithPagination(input) {
    var _a;
    try {
        if (input === null || input === void 0 ? void 0 : input.cache) {
            const cached = await redis_service_1.redisService.get(input.cache.key, database_config_1.redisConfig);
            if (cached)
                return cached;
        }
        const result = await provider.queryWithPagination(input, database_config_1.dbConfig);
        if (input === null || input === void 0 ? void 0 : input.cache) {
            await redis_service_1.redisService.set(input.cache.key, result, database_config_1.redisConfig, (_a = input.cache) === null || _a === void 0 ? void 0 : _a.ttl);
        }
        return result;
    }
    catch (error) {
        throw error;
    }
}
