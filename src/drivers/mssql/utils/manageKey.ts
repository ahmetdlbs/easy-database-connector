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
            if (config.masterkey) {
                await request.batch(`
                    IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                    BEGIN
                        OPEN MASTER KEY DECRYPTION BY PASSWORD = '${dbConfig.masterKeyPassword}';
                    END;

                    IF NOT EXISTS (SELECT 1 FROM sys.certificates WHERE name = '${dbConfig.certificateName}')
                    BEGIN
                        CREATE CERTIFICATE ${dbConfig.certificateName}
                            WITH SUBJECT = 'Certificate for column encryption';
                    END;
                `);
            }

            if (config.aes) {
                await request.batch(`
                    IF NOT EXISTS (SELECT 1 FROM sys.symmetric_keys WHERE name = '${dbConfig.symmetricKeyName}')
                    BEGIN
                        CREATE SYMMETRIC KEY ${dbConfig.symmetricKeyName}
                            WITH ALGORITHM = AES_256,
                            IDENTITY_VALUE = 'AES 256 Encryption for Data'
                            ENCRYPTION BY CERTIFICATE ${dbConfig.certificateName};
                    END;

                    IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                    BEGIN
                        OPEN SYMMETRIC KEY ${dbConfig.symmetricKeyName}
                            DECRYPTION BY CERTIFICATE ${dbConfig.certificateName};
                    END;
                `);
            }
        } else {
            await request.batch(`
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                BEGIN
                    CLOSE SYMMETRIC KEY ${dbConfig.symmetricKeyName};
                END;

                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                BEGIN
                    CLOSE MASTER KEY;
                END;
            `);
        }
    } catch (error) {
        throw new Error(`Key operation failed: ${error}`);
    }
};