"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSql = void 0;
const database_types_1 = require("../../types/database.types");
// SQL Cache için helper
const prepareEncryptedQuery = (paramIndex, symmetricKeyName) => `EncryptByKey(Key_GUID('${symmetricKeyName}'), CONVERT(VARBINARY(MAX), @p${paramIndex}))`;
// Encryption Operations with Caching
const handleEncryption = {
    // SQL sorgu cache'i
    queryCache: new Map(),
    openKey: async (pool, config) => {
        if (!config.symmetricKeyName || !config.certificateName)
            return;
        await pool.request().batch(`
            IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.symmetricKeyName}')
            BEGIN 
                OPEN SYMMETRIC KEY ${config.symmetricKeyName}
                DECRYPTION BY CERTIFICATE ${config.certificateName};
            END`);
    },
    closeKey: async (pool, config) => {
        if (!config.symmetricKeyName)
            return;
        await pool.request().batch(`
            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.symmetricKeyName}')
            BEGIN 
                CLOSE SYMMETRIC KEY ${config.symmetricKeyName};
            END`);
    },
    modifySqlForEncryption: (sql, encryption, config) => {
        var _a;
        if (!((_a = encryption === null || encryption === void 0 ? void 0 : encryption.data) === null || _a === void 0 ? void 0 : _a.length) || !config.symmetricKeyName)
            return sql;
        // Cache key oluştur
        const cacheKey = `${sql}_${encryption.data.join('_')}_${config.symmetricKeyName}`;
        // Cache'de varsa döndür
        const cachedSql = handleEncryption.queryCache.get(cacheKey);
        if (cachedSql)
            return cachedSql;
        // Yoksa oluştur ve cache'le
        let modifiedSql = sql;
        encryption.data.forEach(paramIndex => {
            const paramRegex = new RegExp(`@p${paramIndex}(?=[,\\s)])`);
            modifiedSql = modifiedSql.replace(paramRegex, prepareEncryptedQuery(paramIndex, config.symmetricKeyName));
        });
        handleEncryption.queryCache.set(cacheKey, modifiedSql);
        return modifiedSql;
    }
};
const handleBulk = async (pool, tableName, data, columns, encryption, config, batchSize = 1000) => {
    const transaction = new database_types_1.mssql.Transaction(pool);
    await transaction.begin();
    try {
        const table = new database_types_1.mssql.Table(tableName);
        columns.forEach(([name, type, options]) => {
            var _a, _b, _c;
            if (typeof type !== 'string') {
                if ((_a = encryption === null || encryption === void 0 ? void 0 : encryption.data) === null || _a === void 0 ? void 0 : _a.includes(name)) {
                    table.columns.add(name, database_types_1.mssql.VarBinary(database_types_1.mssql.MAX), {
                        ...options,
                        nullable: (_b = options === null || options === void 0 ? void 0 : options.nullable) !== null && _b !== void 0 ? _b : true
                    });
                }
                else {
                    table.columns.add(name, type, {
                        ...options,
                        nullable: (_c = options === null || options === void 0 ? void 0 : options.nullable) !== null && _c !== void 0 ? _c : true
                    });
                }
            }
        });
        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);
            for (const row of batch) {
                const values = await Promise.all(columns.map(async ([name]) => {
                    var _a, _b, _c;
                    let value = row[name];
                    if (value == null)
                        return null;
                    if (((_a = encryption === null || encryption === void 0 ? void 0 : encryption.data) === null || _a === void 0 ? void 0 : _a.includes(name)) && config.symmetricKeyName) {
                        try {
                            const encryptRequest = new database_types_1.mssql.Request(transaction);
                            encryptRequest.input('value', value);
                            const encryptResult = await encryptRequest.query(`
                                    SELECT EncryptByKey(
                                        Key_GUID('${config.symmetricKeyName}'), 
                                        CONVERT(VARBINARY(MAX), @value)
                                    ) AS EncryptedValue
                                `);
                            return (_c = (_b = encryptResult.recordset[0]) === null || _b === void 0 ? void 0 : _b.EncryptedValue) !== null && _c !== void 0 ? _c : null;
                        }
                        catch (error) {
                            console.error(`Encryption error for value: ${value}`, error);
                            throw error;
                        }
                    }
                    return value;
                }));
                table.rows.add(...values);
            }
        }
        const bulkRequest = new database_types_1.mssql.Request(transaction);
        await bulkRequest.bulk(table);
        await transaction.commit();
    }
    catch (error) {
        await transaction.rollback();
        throw error;
    }
};
const executeSql = async (pool, input, config) => {
    var _a, _b, _c;
    const hasEncryption = ((_a = input.encryption) === null || _a === void 0 ? void 0 : _a.open) === true;
    try {
        if (!pool)
            throw new Error('Database pool is not initialized');
        if (hasEncryption) {
            await handleEncryption.openKey(pool, config);
        }
        if (!input.bulk) {
            const request = pool.request();
            if (((_b = input.parameters) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                input.parameters.forEach((param, idx) => request.input(`p${idx}`, param));
            }
            const modifiedSql = hasEncryption
                ? handleEncryption.modifySqlForEncryption(input.sql, input.encryption, config)
                : input.sql;
            const result = await request.query(modifiedSql);
            return result.recordset || [];
        }
        else if ((_c = input.bulk) === null || _c === void 0 ? void 0 : _c.columns) {
            await handleBulk(pool, input.sql.split(' ')[2], input.parameters, input.bulk.columns, input.encryption, config, input.bulk.batchSize);
            return [];
        }
        return [];
    }
    catch (error) {
        throw error;
    }
    finally {
        if (hasEncryption) {
            await handleEncryption.closeKey(pool, config);
        }
    }
};
exports.executeSql = executeSql;
