import { mssql } from '../../../types/database.types';
import { dbConfig } from '../../../config/database.config';

interface KeyConfig {
    aes?: boolean;
    masterkey?: boolean;
}

// Global key state tracking
class KeyState {
    private static instance: KeyState;
    private masterKeyOpen: boolean = false;
    private symmetricKeyOpen: boolean = false;
    private operationPromise: Promise<void> | null = null;

    private constructor() {}

    static getInstance(): KeyState {
        if (!KeyState.instance) {
            KeyState.instance = new KeyState();
        }
        return KeyState.instance;
    }

    async performOperation(operation: () => Promise<void>): Promise<void> {
        if (this.operationPromise) {
            await this.operationPromise;
        }
        
        this.operationPromise = operation().finally(() => {
            this.operationPromise = null;
        });
        
        return this.operationPromise;
    }

    setMasterKeyState(isOpen: boolean) {
        this.masterKeyOpen = isOpen;
    }

    setSymmetricKeyState(isOpen: boolean) {
        this.symmetricKeyOpen = isOpen;
    }

    isMasterKeyOpen(): boolean {
        return this.masterKeyOpen;
    }

    isSymmetricKeyOpen(): boolean {
        return this.symmetricKeyOpen;
    }
}

export const manageKey = async (
    pool: mssql.ConnectionPool,
    config: KeyConfig,
    transaction?: mssql.Transaction
): Promise<void> => {
    const keyState = KeyState.getInstance();

    return keyState.performOperation(async () => {
        const request = transaction ? new mssql.Request(transaction) : pool.request();

        try {
            if (config.masterkey || config.aes) {
                // Master key işlemi
                if (config.masterkey && !keyState.isMasterKeyOpen()) {
                    try {
                        await request.batch(`
                            BEGIN TRY
                                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                                BEGIN
                                    OPEN MASTER KEY DECRYPTION BY PASSWORD = '${dbConfig.masterKeyPassword}'
                                END
                            END TRY
                            BEGIN CATCH
                                IF ERROR_NUMBER() != 15466 THROW;
                            END CATCH
                        `);
                        keyState.setMasterKeyState(true);
                    } catch (error) {
                        const masterKeyError = error as mssql.RequestError;
                        if (masterKeyError.number !== 15466) {
                            console.error('Master key error:', masterKeyError);
                            throw new Error(`Master key operation failed: ${masterKeyError}`);
                        }
                    }
                }

                // Ensure master key is open before symmetric key
                if (config.aes && !keyState.isSymmetricKeyOpen()) {
                    if (!keyState.isMasterKeyOpen()) {
                        throw new Error('Master key must be open before opening symmetric key');
                    }

                    try {
                        await request.batch(`
                            BEGIN TRY
                                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                                BEGIN
                                    OPEN SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
                                    DECRYPTION BY CERTIFICATE ${dbConfig.certificateName}
                                END
                            END TRY
                            BEGIN CATCH
                                IF ERROR_NUMBER() != 15466 THROW;
                            END CATCH
                        `);
                        keyState.setSymmetricKeyState(true);
                    } catch (error) {
                        const symKeyError = error as mssql.RequestError;
                        if (symKeyError.number !== 15466) {
                            console.error('Symmetric key error:', symKeyError);
                            throw new Error(`Symmetric key operation failed: ${symKeyError}`);
                        }
                    }
                }
            } else {
                // Anahtarları kapat
                if (keyState.isSymmetricKeyOpen()) {
                    await request.batch(`
                        IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
                            CLOSE SYMMETRIC KEY ${dbConfig.symmetricKeyName}
                    `);
                    keyState.setSymmetricKeyState(false);
                }
                
                if (keyState.isMasterKeyOpen()) {
                    await request.batch(`
                        IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                            CLOSE MASTER KEY
                    `);
                    keyState.setMasterKeyState(false);
                }
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error('Key operation error:', error);
            throw new Error(`Key operation failed: ${errMsg}`);
        }
    });
};