import { mssql } from '../../../types/database.types';
import { dbConfig } from '../../../config/database.config';

interface KeyConfig {
    aes?: boolean;
    masterkey?: boolean;
}

export const manageKey = async (
    pool: mssql.ConnectionPool, 
    config: KeyConfig, 
    transaction?: mssql.Transaction
): Promise<void> => {
    const request = transaction ? new mssql.Request(transaction) : pool.request();
    
    try {
        if (config.masterkey || config.aes) {
            let query = `
                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                BEGIN
                    OPEN MASTER KEY DECRYPTION BY PASSWORD = '${dbConfig.masterKeyPassword}';
                END;
            `;

            if (config.aes) {
                query += `
                    IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                    BEGIN
                        OPEN SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
                        DECRYPTION BY CERTIFICATE ${dbConfig.certificateName};
                    END;
                `;
            }

            await request.batch(query);
        } else {
            await request.batch(`
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                    CLOSE SYMMETRIC KEY ${dbConfig.symmetricKeyName};
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                    CLOSE MASTER KEY;
            `);
        }
    } catch (error) {
        throw new Error(`Key operation failed: ${error}`);
    }
};