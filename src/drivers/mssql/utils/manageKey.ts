import { mssql } from '../../../types/database.types';
import { dbConfig } from '../../../config/database.config';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const manageKey = async (pool: mssql.ConnectionPool, isOpen: boolean, transaction?: mssql.Transaction): Promise<void> => {
    if (!dbConfig.symmetricKeyName || (isOpen && !dbConfig.certificateName)) {
        throw new Error('Symmetric key or certificate configuration is missing');
    }

    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
        try {
            const request = transaction ? new mssql.Request(transaction) : pool.request();
            await request.batch(`
                IF ${isOpen ? 'NOT' : ''} EXISTS (
                    SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}'
                )
                BEGIN
                    ${isOpen ? 'OPEN' : 'CLOSE'} SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
                    ${isOpen ? `DECRYPTION BY CERTIFICATE ${dbConfig.certificateName}` : ''}
                END
            `);

            const result = await request.query(`SELECT COUNT(1) as isOpen FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}'`);

            const keyIsOpen = result.recordset[0].isOpen > 0;
            if (keyIsOpen === isOpen) { return; }

            throw new Error('Key operation verification failed');
        } catch (error) {
            retryCount++;
            
            if (retryCount === maxRetries) {
                throw error;
            }

            await sleep(500 * retryCount);
        }
    }
};