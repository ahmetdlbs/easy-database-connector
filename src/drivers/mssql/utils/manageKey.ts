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
            try {
                await request.batch(`
                    OPEN MASTER KEY DECRYPTION BY PASSWORD = '${dbConfig.masterKeyPassword}';
                `);
            } catch (error) {
                const masterKeyError = error as mssql.RequestError;
                if (masterKeyError.number !== 15466) {
                    console.error('Master key error:', masterKeyError);
                    throw new Error(`Master key operation failed: ${masterKeyError}`);
                }
            }

            if (config.aes) {
                try {
                    await request.batch(`
                        OPEN SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
                        DECRYPTION BY CERTIFICATE ${dbConfig.certificateName};
                    `);
                } catch (error) {
                    const symmetricKeyError = error as mssql.RequestError;
                    if (symmetricKeyError.number !== 15466) {
                        console.error('Symmetric key error:', symmetricKeyError);
                        throw new Error(`Symmetric key operation failed: ${symmetricKeyError}`);
                    }
                }
            }
        } else {
            await request.batch(`
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                    CLOSE SYMMETRIC KEY ${dbConfig.symmetricKeyName};
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                    CLOSE MASTER KEY;
            `);
        }
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Full error details:', error);
        throw new Error(`Key operation failed: ${errMsg}`);
    }
};