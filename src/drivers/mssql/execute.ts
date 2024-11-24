import { Row, ColumnType, EncryptionOptions, mssql } from '../../types/database.types';
import { dbConfig } from '../../config/database.config';
import { manageKey } from './utils/manageKey'

const bulkEncrypt = async (transaction: mssql.Transaction, values: unknown[]): Promise<unknown[]> => {
    const request = new mssql.Request(transaction);
    request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(values));
    const result = await request.query(`SELECT EncryptByKey( Key_GUID('${dbConfig.symmetricKeyName}'), CONVERT(VARBINARY(MAX), value)) AS encrypted FROM OPENJSON(@values) WITH (value nvarchar(max) '$')`);

    return result.recordset.map(r => r.encrypted);
};
const executeBulk = async (pool: mssql.ConnectionPool, tableName: string, data: Row[], columns: ColumnType[], encryption: EncryptionOptions | undefined, batchSize = 1000): Promise<void> => {
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
                        ? bulkEncrypt(transaction, values)
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
): Promise<T[]> => {
    if (!pool) throw new Error('Database pool not initialized');

    try {
        if (input.encryption?.open) await manageKey(pool, true);

        if (!input.bulk) {
            const request = pool.request();
            input.parameters?.forEach((param, idx) => request.input(`p${idx}`, param));

            const sql = input.encryption?.data?.length && dbConfig.symmetricKeyName
                ? input.sql.replace(/(@p\d+)(?=[,\s)])/g, (match, param) => `EncryptByKey(Key_GUID('${dbConfig.symmetricKeyName}'), CONVERT(VARBINARY(MAX), ${param}))`)
                : input.sql;


            const result = await request.query<T>(sql);
            const data: any = (result?.recordsets?.length === 1 ? result.recordset : result.recordsets) || []
            return data;
        }


        if (input.bulk?.columns) {
            await executeBulk(pool, input.sql.split(' ')[2], input.parameters as Row[], input.bulk.columns, input.encryption, input.bulk.batchSize);
        }

        return [];
    } finally {
        if (input.encryption?.open) await manageKey(pool, false);
    }
};