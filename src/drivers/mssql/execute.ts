// src/drivers/mssql/execute.ts
import { Row, ColumnType, EncryptionOptions, mssql } from '../../types/database.types';
import { dbConfig } from '../../config/database.config';
import { keyManagerService } from './utils/key-manager';

const bulkEncrypt = async (pool: mssql.ConnectionPool, values: unknown[], transaction?: mssql.Transaction): Promise<unknown[]> => {
    if (!values.length) return [];
    
    // Ensure AES key is open before encryption
    await keyManagerService.manageKey(pool, { aes: true, masterkey: true }, transaction);
    
    const request = transaction ? new mssql.Request(transaction) : new mssql.Request(pool);
    request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(values));
    const result = await request.query(`SELECT EncryptByKey(Key_GUID('${dbConfig.symmetricKeyName}'), CONVERT(VARBINARY(MAX), value)) AS encrypted FROM OPENJSON(@values) WITH (value nvarchar(max) '$')`);    
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
    let needsTransactionManagement = !existingTransaction;

    try {
        if (needsTransactionManagement) {
            await transaction.begin();
        }

        // Handle encryption keys if needed
        if (encryption?.open) {
            await keyManagerService.manageKey(pool, encryption.open, transaction);
        }

        const encryptedColumns = new Set(encryption?.data || []);
        const processedData = await Promise.all(
            columns.map(async ([name]) => {
                const values = data.map(row => row[name]);
                return encryptedColumns.has(name) 
                    ? await bulkEncrypt(pool, values, transaction)
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
            const batchRows = processedData.map(col => col.slice(i, batchEnd));

            table.rows.length = 0;
            for (let j = 0; j < batchRows[0].length; j++) {
                table.rows.add(...batchRows.map(col => col[j]));
            }
            
            const request = new mssql.Request(transaction);
            await request.bulk(table);
        }

        if (needsTransactionManagement) {
            await transaction.commit();
            
            // Clean up transaction context if we created it
            keyManagerService.cleanupTransaction(pool, transaction);
        }
    } catch (error) {
        if (needsTransactionManagement) {
            try {
                await transaction.rollback();
                
                // Clean up transaction context
                keyManagerService.cleanupTransaction(pool, transaction);
            } catch (rollbackError) {
                console.error('Error during transaction rollback:', rollbackError);
            }
        }
        throw error;
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

    try {
        // Open encryption keys if needed
        if (input.encryption?.open) {
            await keyManagerService.manageKey(pool, input.encryption.open, input.transaction);
        }

        if (!input.bulk) {
            const request = input.transaction ? new mssql.Request(input.transaction) : pool.request();

            if (input.parameters?.length) {
                input.parameters.forEach((param, idx) => {
                    // Handle null parameters properly
                    if (param === null) {
                        request.input(`p${idx}`, null);
                    } else {
                        request.input(`p${idx}`, param);
                    }
                });
            }
            
            const result = await request.query<T>(input.sql);
            const data: any = (result?.recordsets?.length === 1 ? result.recordset : result.recordsets) || [];
            return data;
        }

        if (input.bulk?.columns) {
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
    } catch (error) {
        console.error('SQL execution error:', error);
        throw error;
    }
};