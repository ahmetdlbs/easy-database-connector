import { DatabaseProvider, ExecuteOptions, mssql, PaginationResult, QueryOptions, QueryWithPaginationOptions } from '../../../types';
import { executeSql } from './execute';
import { keyManagerService } from './key-manager';
import { poolManager } from './pool-manager';
import { mssqlLogger } from '../../../utils';
import { config } from '../../../config';

/**
 * MSSQL veritabanı sağlayıcısı
 * Bu sınıf, SQL Server veritabanı işlemlerini yürütür
 */
export class MssqlProvider implements DatabaseProvider {
    /**
     * SELECT sorgusu çalıştırır
     * @param options Sorgu seçenekleri
     * @returns Sorgu sonuçları
     */
    async query<T>(options: QueryOptions): Promise<T[]> {
        const pool = await poolManager.getPool();
        return executeSql<T>(pool, options);
    }

    /**
     * INSERT, UPDATE veya DELETE sorgusu çalıştırır
     * @param options Çalıştırma seçenekleri
     * @returns İşlem sonuçları
     */
    async execute(options: ExecuteOptions): Promise<unknown[]> {
        const pool = await poolManager.getPool();
        return executeSql(pool, options);
    }

    /**
     * Sayfalanmış bir sorgu çalıştırır
     * @param options Sayfalama seçenekleri
     * @returns Sayfalanmış sorgu sonuçları
     */
    async queryWithPagination<T>(options: QueryWithPaginationOptions): Promise<PaginationResult<T>> {
        const pool = await poolManager.getPool();
        const page = Math.max(1, Number(options.page) || 1);
        const pageSize = Math.max(1, Math.min(1000, Number(options.pageSize) || 10));
        const offset = (page - 1) * pageSize;

        try {
            // Herhangi bir sorgu işleminden önce anahtarları aç
            let keyConnId: string | undefined;
            if (options.encryption?.open) {
                keyConnId = await keyManagerService.manageKey(
                    pool, 
                    options.encryption.open as any, 
                    options.transaction
                );
            }

            // Sayım sorgusu için mevcut ORDER BY'ı kaldır
            const orderByRegex = /\bORDER\s+BY\s+(.+?)(?:\s*OFFSET|\s*$)/i;
            const orderByMatch = options.sql.match(orderByRegex);
            const baseQuery = options.sql.replace(orderByRegex, '');

            // Sağlanan ORDER BY veya sorgudan al, ya da varsayılana düş
            const orderByClause = options.orderBy || (orderByMatch ? orderByMatch[1] : 'CURRENT_TIMESTAMP');

            // Önce sayım sorgusunu çalıştır
            const countResults = await executeSql(pool, {
                ...options,
                sql: `SELECT COUNT(1) as total FROM (${baseQuery}) AS CountQuery`,
                encryption: options.encryption
            });
            
            const total = countResults?.[0]?.total || 0;

            // Sonuç yoksa boş döndür
            if (!total) {

                return {
                    totalCount: 0,
                    pageCount: 0,
                    page: page.toString(),
                    pageSize,
                    detail: []
                };
            }

            // Sayfalama parametrelerini ekle
            const newParameters = [...(options.parameters || []), offset, pageSize];
            
            // Sayfalama ile veri sorgusunu çalıştır
            const results = await executeSql(pool, {
                ...options,
                sql: `SELECT mainQuery.* FROM (${baseQuery}) AS mainQuery 
                      ORDER BY ${orderByClause} 
                      OFFSET @p${newParameters.length - 2} ROWS 
                      FETCH NEXT @p${newParameters.length - 1} ROWS ONLY`,
                parameters: newParameters
            });

            // Sayfalanmış sonuçları döndür
            return {
                totalCount: total,
                pageCount: Math.ceil(total / pageSize),
                page: page.toString(),
                pageSize,
                detail: results as T[],
            };
        } catch (error) {
            mssqlLogger.error('Sayfalama sorgu hatası:', error);
            throw error;
        }
    }
    
    /**
     * Bir işlem içinde birden çok sorgu çalıştırır
     * @param callback İşlem içinde çalıştırılacak fonksiyon
     * @returns İşlem sonucu
     */
    async transaction<T>(
        callback: (transaction: mssql.Transaction) => Promise<T>
    ): Promise<T> {
        const pool = await poolManager.getPool();
        const transaction = new mssql.Transaction(pool);

        try {
            // İşlemi başlat
            await transaction.begin();
            
            // Anahtar yöneticisi için işleme özgü bağlantı ID'si oluştur
            const keyConnId = keyManagerService.generateConnectionId(pool, transaction);
            
            // İşlem ile geri çağırımı çalıştır
            const result = await callback(transaction);
            
            // İşlemi tamamla
            await transaction.commit();
            
            // Anahtarları ve işlem kaynaklarını temizle
            keyManagerService.cleanupTransaction(pool, transaction, keyConnId);
            
            return result;
        } catch (error) {
            mssqlLogger.error('İşlem hatası:', error);
            
            // Geri almayı dene
            try {
                await transaction.rollback();
                
                // Hata durumunda da kaynakları temizle
                keyManagerService.cleanupTransaction(pool, transaction);
            } catch (rollbackError) {
                mssqlLogger.error('İşlem geri alma sırasında hata:', rollbackError);
            }
            
            throw error;
        }
    }

    /**
     * Veritabanında açık anahtarları kontrol eder
     */
    async checkOpenKeys(): Promise<unknown[]> {
        const pool = await poolManager.getPool();
        return keyManagerService.checkOpenKeys(pool);
    }

    /**
     * Veritabanında tüm anahtarları kapatır - SQL Server kısıtlamalarını dikkate alır
     */
    async closeAllKeys(): Promise<void> {
        const pool = await poolManager.getPool();
        try {
            // Açık anahtarları kontrol et
            const openKeys = await keyManagerService.checkOpenKeys(pool, false);
            
            if (openKeys.length > 0) {
                mssqlLogger.info(`${openKeys.length} açık anahtar bulundu, sadece özel anahtarlar kapatılıyor`);
                
                // Sadece özel simetrik anahtarı kapat
                if (config.database.symmetricKeyName) {
                    try {
                        const request = pool.request();
                        await request.batch(`
                            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                            BEGIN
                                CLOSE SYMMETRIC KEY ${config.database.symmetricKeyName};
                            END
                        `);
                        mssqlLogger.info(`Simetrik anahtar kapatıldı: ${config.database.symmetricKeyName}`);
                    } catch (error) {
                        // Hata durumunda sadece logla ve devam et
                        mssqlLogger.debug('Simetrik anahtar kapatma sırasında hata (yok sayılıyor):', error);
                    }
                }
                
                // Master key'i kapatmayı deneme, MS SQL Server bunu izin vermiyor
            } else {
                mssqlLogger.info('Kapatılacak açık anahtar bulunmamaktadır');
            }
            
            // Hafızadaki anahtar durumlarını temizle
            const connectionStates = keyManagerService['connectionKeyStates'];
            if (connectionStates && connectionStates instanceof Map) {
                for (const connId of connectionStates.keys()) {
                    connectionStates.delete(connId); // Doğrudan temizleme
                }
                mssqlLogger.debug('Hafızadaki anahtar durumları temizlendi');
            }
        } catch (error) {
            // Hata durumunda sadece logla, uygulamanın çalışmaya devam etmesini sağla
            mssqlLogger.debug('Anahtarları kapatma sırasında beklenen hata (yok sayılıyor):', error);
        }
    }

    /**
     * Veritabanı bağlantısını kapatır
     */
    async close(): Promise<void> {
        try {
            // Önce tüm anahtarları kapatmaya çalış
            await this.closeAllKeys().catch(err => {
                mssqlLogger.error('Kapatma sırasında anahtarları temizleme hatası:', err);
            });
            
            // Havuzu kapat
            await poolManager.shutdown();
            
        } catch (error) {
            mssqlLogger.error('Veritabanı bağlantısını kapatma hatası:', error);
            throw error;
        }
    }
}

// MSSQL sağlayıcı örneğini oluştur
export const mssqlProvider = new MssqlProvider();