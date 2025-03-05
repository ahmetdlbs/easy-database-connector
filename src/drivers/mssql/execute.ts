// src/drivers/mssql/execute.ts
import { Row, ColumnType, EncryptionOptions, mssql } from '../../types/database.types';
import { dbConfig } from '../../config/database.config';
import { keyManagerService } from './utils/key-manager';

/**
 * Encrypts data in batches to avoid memory issues
 */
const bulkEncrypt = async (pool: mssql.ConnectionPool, values: unknown[], transaction?: mssql.Transaction): Promise<unknown[]> => {
    if (!values.length) return [];
    
    // Ensure AES key is open before encryption
    await keyManagerService.manageKey(pool, { aes: true, masterkey: true }, transaction);
    
    // Process in smaller batches to avoid memory issues
    const batchSize = 1000;
    const results: unknown[] = [];
    
    for (let i = 0; i < values.length; i += batchSize) {
        const batchValues = values.slice(i, i + batchSize);
        const request = transaction ? new mssql.Request(transaction) : new mssql.Request(pool);
        
        request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(batchValues));
        const result = await request.query(`
            SELECT EncryptByKey(Key_GUID('${dbConfig.symmetricKeyName}'), CONVERT(VARBINARY(MAX), value)) AS encrypted 
            FROM OPENJSON(@values) WITH (value nvarchar(max) '$')
        `);
        
        results.push(...result.recordset.map(r => r.encrypted));
    }
    
    return results;
};

/**
 * Processes bulk operations with better memory management
 */
const bulkProcess = async (
    pool: mssql.ConnectionPool,
    tableName: string,
    data: Row[],
    columns: ColumnType[],
    encryption: EncryptionOptions | undefined,
    batchSize = 1000, // Smaller default batch size
    existingTransaction?: mssql.Transaction
): Promise<void> => {
    if (!data.length) return;

    const transaction = existingTransaction || new mssql.Transaction(pool);
    let needsTransactionManagement = !existingTransaction;

    try {
        if (needsTransactionManagement) {
            await transaction.begin();
        }

        // Handle encryption keys if needed - do this once
        if (encryption?.open) {
            await keyManagerService.manageKey(pool, encryption.open, transaction);
        }

        // Get columns that need encryption
        const encryptedColumns = new Set(encryption?.data || []);
        
        // Process data in column-wise approach for better memory efficiency
        const processedData: unknown[][] = [];
        
        for (let colIndex = 0; colIndex < columns.length; colIndex++) {
            const [colName] = columns[colIndex];
            
            // Extract all values for this column
            const colValues = data.map(row => row[colName]);
            
            // Process column (encrypt if needed)
            if (encryptedColumns.has(colName)) {
                processedData[colIndex] = await bulkEncrypt(pool, colValues, transaction);
            } else {
                processedData[colIndex] = colValues;
            }
        }

        // Create table for bulk insert
        const table = new mssql.Table(tableName);
        columns.forEach(([name, type, options]) => {
            if (typeof type === 'string') return;
            table.columns.add(name, type, { nullable: true, ...options });
        });

        // Process in batches
        for (let i = 0; i < data.length; i += batchSize) {
            const batchEnd = Math.min(i + batchSize, data.length);
            
            // Clear previous rows
            table.rows.length = 0;
            
            // Add rows for this batch
            for (let rowIndex = i; rowIndex < batchEnd; rowIndex++) {
                const rowValues = columns.map((_, colIndex) => {
                    const value = processedData[colIndex][rowIndex - i];
                    return value !== undefined ? (value as string | number | boolean | Date | Buffer | null) : null;
                });
                
                table.rows.add(...rowValues);
            }
            
            // Execute bulk operation
            const request = new mssql.Request(transaction);
            await request.bulk(table);
        }

        if (needsTransactionManagement) {
            await transaction.commit();
            keyManagerService.cleanupTransaction(pool, transaction);
        }
    } catch (error) {
        if (needsTransactionManagement) {
            try {
                await transaction.rollback();
                keyManagerService.cleanupTransaction(pool, transaction);
            } catch (rollbackError) {
                console.error('Error during transaction rollback:', rollbackError);
            }
        }
        throw error;
    }
};

/**
 * Executes SQL queries with encryption support
 */
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
            // Regular query execution
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
            // Extract table name from SQL for bulk operations
            let tableName: string;
            const sqlLower = input.sql.toLowerCase().trim();
            
            if (sqlLower.startsWith('insert into') || sqlLower.startsWith('update')) {
                // Get table name from SQL
                tableName = input.sql.split(/\s+/)[2].replace(/[[\]"`']/g, '');
            } else {
                // Assuming the SQL is just the table name
                tableName = input.sql.trim().replace(/[[\]"`']/g, '');
            }
            
            await bulkProcess(
                pool, 
                tableName, 
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