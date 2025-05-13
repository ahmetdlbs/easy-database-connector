import { mssqlProvider } from './mssql';
import { DatabaseProvider } from '../../types';
import { config } from '../../config';
import { DatabaseError, ErrorCode } from '../../common/errors';

/**
 * Yapılandırmada belirtilen veritabanı sağlayıcısını döndürür
 */
export const getProvider = (): DatabaseProvider => {
    if (!config || !config.database || !config.database.type) {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'Veritabanı tipi belirtilmemiş',
            { config }
        );
    }
    
    switch (config.database.type) {
        case 'mssql':
            return mssqlProvider;
        default:
            throw new DatabaseError(
                ErrorCode.INVALID_PARAMETER,
                `Desteklenmeyen veritabanı türü: ${config.database.type}`,
                { databaseType: config.database.type }
            );
    }
};

export { mssqlProvider };
