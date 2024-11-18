import { DatabaseConfig, Row, ColumnType, EncryptionOptions, mssql } from '../../types/database.types';

const manageKey = async (pool: mssql.ConnectionPool, config: DatabaseConfig, isOpen: boolean): Promise<void> => {
    if (!config.symmetricKeyName || (isOpen && !config.certificateName)) return;
    await pool.request().batch(`
        IF ${isOpen ? 'NOT ' : ''}EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.symmetricKeyName}')
        ${isOpen ? 'OPEN' : 'CLOSE'} SYMMETRIC KEY ${config.symmetricKeyName} 
        ${isOpen ? `DECRYPTION BY CERTIFICATE ${config.certificateName}` : ''}`
    );
};
const bulkEncrypt = async (transaction: mssql.Transaction, values: unknown[], config: DatabaseConfig): Promise<unknown[]> => {
    const request = new mssql.Request(transaction);
    request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(values));
    const result = await request.query(`SELECT EncryptByKey( Key_GUID('${config.symmetricKeyName}'), CONVERT(VARBINARY(MAX), value)) AS encrypted FROM OPENJSON(@values) WITH (value nvarchar(max) '$')`);
    
    return result.recordset.map(r => r.encrypted);
};
const executeBulk = async (pool: mssql.ConnectionPool, tableName: string, data: Row[], columns: ColumnType[], encryption: EncryptionOptions | undefined, config: DatabaseConfig, batchSize = 1000): Promise<void> => {
    const transaction = new mssql.Transaction(pool);
    await transaction.begin();

    try {
        const table = new mssql.Table(tableName);
        const encryptedColumns = new Set(encryption?.data || []);

        columns.forEach(([name, type, options]) => {
            if (typeof type === 'string') return;
            table.columns.add(
                name, 
                encryptedColumns.has(name) ? mssql.VarBinary(mssql.MAX) : type,
                { nullable: true, ...options }
            );
        });

        for (let i = 0; i < data.length; i += batchSize) {
            const batch = data.slice(i, i + batchSize);
            const columnValues = columns.map(([name]) => 
                batch.map(row => row[name])
            );

            const encryptedValues = await Promise.all(
                columnValues.map(async (values, idx) => {
                    const colName = columns[idx][0];
                    return encryptedColumns.has(colName)
                        ? bulkEncrypt(transaction, values, config)
                        : values;
                })
            );

            batch.forEach((_, rowIdx) => {
                const rowValues = encryptedValues.map(col => col[rowIdx]);
                table.rows.add(...rowValues);
            });
        }

        await new mssql.Request(transaction).bulk(table);
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
        bulk?: { columns?: ColumnType[]; batchSize?: number };
        encryption?: EncryptionOptions;
    },
    config: DatabaseConfig
): Promise<T[]> => {
    if (!pool) throw new Error('Database pool not initialized');
    
    try {
        if (input.encryption?.open) await manageKey(pool, config, true);

        if (!input.bulk) {
            const request = pool.request();
            input.parameters?.forEach((param, idx) => request.input(`p${idx}`, param));

            const sql = input.encryption?.data?.length && config.symmetricKeyName 
                ? input.sql.replace(/(@p\d+)(?=[,\s)])/g, (match, param) => `EncryptByKey(Key_GUID('${config.symmetricKeyName}'), CONVERT(VARBINARY(MAX), ${param}))`)
                : input.sql;

            const result = await request.query<T>(sql);
            return result.recordset || [];
        }


        if (input.bulk?.columns) {
            await executeBulk( pool, input.sql.split(' ')[2], input.parameters as Row[], input.bulk.columns, input.encryption, config, input.bulk.batchSize);
        }

        return [];
    } finally {
        if (input.encryption?.open) await manageKey(pool, config, false);
    }
};