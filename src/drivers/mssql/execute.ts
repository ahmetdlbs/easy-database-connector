import { Row, ColumnType, EncryptionOptions, mssql } from '../../types/database.types';
import { dbConfig } from '../../config/database.config';
import { manageKey } from './utils/manageKey';

const bulkEncrypt = async (pool: mssql.ConnectionPool, values: unknown[]): Promise<unknown[]> => {
    if (!values.length) return [];
    const request = new mssql.Request(pool);
    request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(values));
    const result = await request.query(`
        SELECT EncryptByKey(
            Key_GUID('${dbConfig.symmetricKeyName}'), 
            CONVERT(VARBINARY(MAX), value)
        ) AS encrypted 
        FROM OPENJSON(@values) WITH (value nvarchar(max) '$')
    `);    
    return result.recordset.map(r => r.encrypted);
};

const bulkProcess = async (
    pool: mssql.ConnectionPool,
    tableName: string,
    data: Row[],
    columns: ColumnType[],
    encryption: EncryptionOptions | undefined,
    batchSize = 5000,
    existingTransaction?: mssql.Transaction
): Promise<void> => {
    if (!data.length) return;

    const transaction = existingTransaction || new mssql.Transaction(pool);
    let keyOpened = false;
    let needsTransactionManagement = !existingTransaction;

    try {
        if (needsTransactionManagement) {
            await transaction.begin();
        }

        if (encryption?.open) {
            await manageKey(pool, true, existingTransaction);
            keyOpened = true;
        }

        const encryptedColumns = new Set(encryption?.data || []);
        const processedData = await Promise.all(
            columns.map(async ([name]) => {
                const values = data.map(row => row[name]);
                return encryptedColumns.has(name) 
                    ? await bulkEncrypt(pool, values)
                    : values;
            })
        );

        const table = new mssql.Table(tableName);
        columns.forEach(([name, type, options]) => {
            if (typeof type === 'string') return;
            table.columns.add(name, type, { nullable: true, ...options });
        });

        for (let i = 0; i < data.length; i += batchSize) {
            const batchEnd = Math.min(i + batchSize, data.length);
            const batchRows = processedData.map(col => 
                col.slice(i, batchEnd)
            );

            table.rows.length = 0;
            for (let j = 0; j < batchRows[0].length; j++) {
                table.rows.add(...batchRows.map(col => col[j]));
            }
            
            const request = new mssql.Request(transaction);
            await request.bulk(table);
        }

        if (needsTransactionManagement) {
            await transaction.commit();
        }
    } catch (error) {
        if (needsTransactionManagement) {
            await transaction.rollback();
        }
        throw error;
    } finally {
        if (keyOpened) {
            await manageKey(pool, false, existingTransaction).catch(console.error);
        }
    }
};

export const executeSql = async <T = any>(
    pool: mssql.ConnectionPool,
    input: {
        sql: string;
        parameters?: unknown[];
        bulk?: { columns?: ColumnType[]; batchSize?: number };
        encryption?: EncryptionOptions;
        transaction?: mssql.Transaction;
    }
): Promise<T[]> => {
    if (!pool) throw new Error('Database pool not initialized');

    let keyOpened = false;
    try {
        if (input.encryption?.open) {
            await manageKey(pool, true, input.transaction);
            keyOpened = true;
        }
        console.log(input.bulk)

        if (!input.bulk) {
            console.log("buraya girdi")
            const request = input.transaction ? new mssql.Request(input.transaction) : pool.request();

            input.parameters?.forEach((param, idx) => 
                request.input(`p${idx}`, param)
            );
            const result = await request.query<T>(input.sql);
            return result?.recordset || [];
        }

        if (input.bulk?.columns) {
            console.log("girdi buraya")
            console.log(input.sql.split(' ')[2])
            await bulkProcess(
                pool, 
                input.sql.split(' ')[2],
                input.parameters as Row[], 
                input.bulk.columns,
                input.encryption,
                input.bulk.batchSize,
                input.transaction
            );
        }

        return [];
    } finally {
        if (keyOpened) {
            await manageKey(pool, false, input.transaction).catch(console.error);
        }
    }
};