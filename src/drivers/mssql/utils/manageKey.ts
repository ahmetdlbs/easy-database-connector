
import { mssql } from '../../../types/database.types';
import { dbConfig } from '../../../config/database.config';

export const manageKey = async (pool: mssql.ConnectionPool, isOpen: boolean,transaction:any): Promise<void> => {
    if (!dbConfig.symmetricKeyName || (isOpen && !dbConfig.certificateName)) return;
    const request = transaction ? new mssql.Request(transaction) : pool.request();
   
    await request.batch(`
        IF ${isOpen ? 'NOT ' : ''}EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
        ${isOpen ? 'OPEN' : 'CLOSE'} SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
        ${isOpen ? `DECRYPTION BY CERTIFICATE ${dbConfig.certificateName}` : ''}`
    );
};