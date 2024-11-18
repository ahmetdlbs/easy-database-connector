"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mssqlProvider = void 0;
const database_types_1 = require("../../types/database.types");
const execute_1 = require("./execute");
let pool = null;
const getPool = async (config) => {
    var _a, _b;
    if (!pool) {
        pool = await new database_types_1.mssql.ConnectionPool({
            server: config.host,
            user: config.user,
            password: config.password,
            database: config.database,
            port: config.port,
            options: {
                encrypt: (_a = config.options) === null || _a === void 0 ? void 0 : _a.encrypt,
                trustServerCertificate: (_b = config.options) === null || _b === void 0 ? void 0 : _b.trustServerCertificate
            }
        }).connect();
    }
    return pool;
};
exports.mssqlProvider = {
    query: async (input, config) => {
        const pool = await getPool(config);
        return await (0, execute_1.executeSql)(pool, input, config);
    },
    execute: async (input, config) => {
        const pool = await getPool(config);
        return await (0, execute_1.executeSql)(pool, input, config);
    },
    queryWithPagination: async (input, config) => {
        var _a, _b;
        const pool = await getPool(config);
        const page = input.page || 1;
        const pageSize = input.pageSize || 10;
        const offset = (page - 1) * pageSize;
        const paginatedSql = `WITH Results AS ( SELECT COUNT(*) OVER() AS TotalRows, ROW_NUMBER() OVER(${input.orderBy ? `ORDER BY ${input.orderBy}` : 'ORDER BY (SELECT NULL)'}) AS RowNum, * FROM (${input.sql}) AS BaseQuery ) SELECT * FROM Results WHERE RowNum > ${offset} AND RowNum <= ${offset + pageSize}`;
        const result = await (0, execute_1.executeSql)(pool, { ...input, sql: paginatedSql }, config);
        const total = (_b = (_a = result[0]) === null || _a === void 0 ? void 0 : _a.TotalRows) !== null && _b !== void 0 ? _b : 0;
        return {
            data: result.map(({ TotalRows, RowNum, ...rest }) => rest),
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        };
    },
    transaction: async (callback, config) => {
        const pool = await getPool(config);
        const transaction = new database_types_1.mssql.Transaction(pool);
        await transaction.begin();
        try {
            const result = await callback(transaction);
            await transaction.commit();
            return result;
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    },
    close: async () => {
        if (pool) {
            await pool.close();
            pool = null;
        }
    }
};
