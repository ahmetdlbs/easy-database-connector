import { DatabaseConfig, Row, ColumnType, EncryptionOptions, mssql } from '../../types/database.types';

// SQL Cache için helper
const prepareEncryptedQuery = (paramIndex: string, symmetricKeyName: string): string => 
    `EncryptByKey(Key_GUID('${symmetricKeyName}'), CONVERT(VARBINARY(MAX), @p${paramIndex}))`;

// Encryption Operations with Caching
const handleEncryption = {
    // SQL sorgu cache'i
    queryCache: new Map<string, string>(),

    openKey: async (pool: mssql.ConnectionPool, config: DatabaseConfig): Promise<void> => {
        if (!config.symmetricKeyName || !config.certificateName) return;
        
        await pool.request().batch(`
            IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.symmetricKeyName}')
            BEGIN 
                OPEN SYMMETRIC KEY ${config.symmetricKeyName}
                DECRYPTION BY CERTIFICATE ${config.certificateName};
            END`);
    },

    closeKey: async (pool: mssql.ConnectionPool, config: DatabaseConfig): Promise<void> => {
        if (!config.symmetricKeyName) return;
        
        await pool.request().batch(`
            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.symmetricKeyName}')
            BEGIN 
                CLOSE SYMMETRIC KEY ${config.symmetricKeyName};
            END`);
    },

    modifySqlForEncryption: (sql: string, encryption: EncryptionOptions | undefined, config: DatabaseConfig): string => {
        if (!encryption?.data?.length || !config.symmetricKeyName) return sql;

        // Cache key oluştur
        const cacheKey = `${sql}_${encryption.data.join('_')}_${config.symmetricKeyName}`;
        
        // Cache'de varsa döndür
        const cachedSql = handleEncryption.queryCache.get(cacheKey);
        if (cachedSql) return cachedSql;

        // Yoksa oluştur ve cache'le
        let modifiedSql = sql;
        encryption.data.forEach(paramIndex => {
            const paramRegex = new RegExp(`@p${paramIndex}(?=[,\\s)])`);
            modifiedSql = modifiedSql.replace(
                paramRegex,
                prepareEncryptedQuery(paramIndex, config.symmetricKeyName!)
            );
        });

        handleEncryption.queryCache.set(cacheKey, modifiedSql);
        return modifiedSql;
    }
};

const handleBulk = async (
    pool: mssql.ConnectionPool,
    tableName: string,
    data: Row[],
    columns: ColumnType[],
    encryption: EncryptionOptions | undefined,
    config: DatabaseConfig,
    batchSize: number = 1000
): Promise<void> => {
    const transaction = new mssql.Transaction(pool);
    await transaction.begin();

    try {
        const table = new mssql.Table(tableName);

        columns.forEach(([name, type, options]) => {
            if (typeof type !== 'string') {
                if (encryption?.data?.includes(name)) {
                    table.columns.add(name, mssql.VarBinary(mssql.MAX), {
                        ...options,
                        nullable: options?.nullable ?? true
                    });
                } else {
                    table.columns.add(name, type, {
                        ...options,
                        nullable: options?.nullable ?? true
                    });
                }
            }
        });

        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);

            for (const row of batch) {
                const values = await Promise.all(
                    columns.map(async ([name]) => {
                        let value = row[name];

                        if (value == null) return null;

                        if (encryption?.data?.includes(name) && config.symmetricKeyName) {
                            try {
                                const encryptRequest = new mssql.Request(transaction);
                                encryptRequest.input('value', value);
                                
                                const encryptResult = await encryptRequest.query(`
                                    SELECT EncryptByKey(
                                        Key_GUID('${config.symmetricKeyName}'), 
                                        CONVERT(VARBINARY(MAX), @value)
                                    ) AS EncryptedValue
                                `);

                                return encryptResult.recordset[0]?.EncryptedValue ?? null;
                            } catch (error) {
                                console.error(`Encryption error for value: ${value}`, error);
                                throw error;
                            }
                        }

                        return value;
                    })
                );

                table.rows.add(...values);
            }
        }

        const bulkRequest = new mssql.Request(transaction);
        await bulkRequest.bulk(table);
        await transaction.commit();

    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};


export const executeSql = async <T = any>(
    pool: mssql.ConnectionPool,
    input: {
        sql: string;
        parameters: unknown[];
        bulk?: {
            columns?: ColumnType[];
            batchSize?: number;
        };
        encryption?: EncryptionOptions;
    },
    config: DatabaseConfig
): Promise<T[]> => {
    const hasEncryption = input.encryption?.open === true;

    try {
        if (!pool) throw new Error('Database pool is not initialized');

        if (hasEncryption) {
            await handleEncryption.openKey(pool, config);
        }

        if (!input.bulk) {
            const request = pool.request();
            if(input.parameters?.length > 0){
                input.parameters.forEach((param, idx) => request.input(`p${idx}`, param));
            }
            
            const modifiedSql = hasEncryption 
                ? handleEncryption.modifySqlForEncryption(input.sql, input.encryption, config)
                : input.sql;

            const result = await request.query<T>(modifiedSql);
            return result.recordset || [];
        }
        else if (input.bulk?.columns) {
            await handleBulk(
                pool,
                input.sql.split(' ')[2],
                input.parameters as Row[],
                input.bulk.columns,
                input.encryption,
                config,
                input.bulk.batchSize
            );
            return [];
        }

        return [];
    } catch (error) {
        throw error;
    } finally {
        if (hasEncryption) {
            await handleEncryption.closeKey(pool, config);
        }
    }
};