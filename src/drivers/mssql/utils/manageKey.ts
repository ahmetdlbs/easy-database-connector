import { mssql } from '../../../types/database.types';
import { dbConfig } from '../../../config/database.config';

export const manageKey = async (pool: mssql.ConnectionPool, isOpen: boolean, transaction?: mssql.Transaction): Promise<void> => {
    if (!dbConfig.symmetricKeyName || (isOpen && !dbConfig.certificateName)) {
        throw new Error('Symmetric key or certificate configuration is missing');
    }
    
    try {
        const request = transaction ? new mssql.Request(transaction) : pool.request();
        const keyStatusResult = await request.query(`SELECT COUNT(1) as isOpen FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}'`);
        const isKeyOpen = keyStatusResult.recordset[0].isOpen > 0;

        if (isOpen === isKeyOpen) { return }

        await request.batch(`
            BEGIN TRY
                ${isOpen ? 'OPEN' : 'CLOSE'} SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
                ${isOpen ? `DECRYPTION BY CERTIFICATE ${dbConfig.certificateName}` : ''}
            END TRY
            BEGIN CATCH
                THROW;
            END CATCH
        `);

        const verificationResult = await request.query(`SELECT COUNT(1) as isOpen FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}'`);

        const finalKeyState = verificationResult.recordset[0].isOpen > 0;
        if (isOpen !== finalKeyState) {
            throw new Error(`Failed to ${isOpen ? 'open' : 'close'} symmetric key`);
        }
    } catch (error) {
        console.error(error);
        throw error;
    }
};