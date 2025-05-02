import { getProvider } from './providers';
import { DatabaseProvider, DatabaseRecord, ExecuteOptions, PaginationResult, QueryOptions, QueryWithPaginationOptions } from '../types';
import { redisService } from '../services';
import { databaseLogger } from '../utils';
import { DatabaseError, ErrorCode } from '../common/errors';

// Yapılandırmada belirtilen sağlayıcıyı al
let provider: DatabaseProvider;
try {
    provider = getProvider();
    if (!provider) {
        throw new DatabaseError(
            ErrorCode.DB_CONNECTION_ERROR,
            'Veritabanı sağlayıcısı bulunamadı',
            { provider }
        );
    }
} catch (error) {
    databaseLogger.error('Sağlayıcı başlatılırken hata:', error);
    throw error instanceof DatabaseError 
        ? error 
        : new DatabaseError(
            ErrorCode.DB_CONNECTION_ERROR,
            'Veritabanı sağlayıcısı başlatılamadı: ' + (error instanceof Error ? error.message : String(error)),
            { originalError: error }
        );
}

/**
 * Veritabanında açık anahtarları kontrol eder
 * Bu fonksiyon tanılama amaçlıdır - açık anahtarları tespit etmek için kullanılır
 */
export async function checkOpenKeys(): Promise<unknown[]> {
    try {
        // @ts-ignore - MSSQL provider olduğunu varsayıyoruz
        if (typeof provider.checkOpenKeys === 'function') {
            // @ts-ignore
            return await provider.checkOpenKeys();
        }
        databaseLogger.warn('Bu veritabanı sağlayıcısı açık anahtar kontrollerini desteklemiyor');
        return [];
    } catch (error) {
        databaseLogger.error('Açık anahtarları kontrol ederken hata:', error);
        throw error instanceof DatabaseError 
            ? error 
            : new DatabaseError(
                ErrorCode.DB_CONNECTION_ERROR,
                'Açık anahtarları kontrol ederken hata: ' + (error instanceof Error ? error.message : String(error)),
                { error }
            );
    }
}

/**
 * Veritabanında tüm açık anahtarları kapatır
 * Bu, veri ekleme/sorgulama sorunlarını çözmek için kullanılabilir
 */
export async function closeAllKeys(): Promise<void> {
    try {
        // Provider'da bu fonksiyon varsa kullan
        // @ts-ignore - MSSQL provider olduğunu varsayıyoruz
        if (typeof provider.closeAllKeys === 'function') {
            // @ts-ignore
            await provider.closeAllKeys();
            databaseLogger.debug('Tüm anahtarlar kapatıldı');
            return;
        }
        databaseLogger.debug('Bu veritabanı sağlayıcısı anahtar kapatma işlemini desteklemiyor');
    } catch (error) {
        // Hata durumunda programın çalışmasını engellememek için sadece logla
        databaseLogger.debug('Tüm anahtarları kapatma işleminde hata (yok sayılıyor):', error);
    }
}

/**
 * İsteğe bağlı önbellekleme ile SELECT sorgusu çalıştırır
 * @param options Sorgu seçenekleri
 * @returns Sorgu sonuçları
 */
export async function query<T extends DatabaseRecord>(options: QueryOptions): Promise<T[]> {
    try {
        // Önbellek etkinse ve işlemde değilsek önbellekten almayı dene
        if (options?.cache && !options.transaction) {
            const cached = await redisService.get<T[]>(options.cache.key);
            if (cached) {
                databaseLogger.debug(`Önbellekten alındı: ${options.cache.key}`);
                return cached;
            }
        }

        // Sorguyu çalıştır
        const result = await provider.query<T>(options);

        // Önbellek etkinse ve işlemde değilsek sonucu önbelleğe al
        if (options?.cache && !options.transaction && result) {
            await redisService.set(
                options.cache.key, 
                result, 
                options.cache?.ttl
            );
            databaseLogger.debug(`Önbelleğe alındı: ${options.cache.key}`);
        }

        return result;
    } catch (error) {
        databaseLogger.error('Sorgu hatası:', error);
        throw error instanceof DatabaseError 
            ? error 
            : new DatabaseError(
                ErrorCode.DB_QUERY_ERROR,
                'Sorgu çalıştırılırken hata oluştu: ' + (error instanceof Error ? error.message : String(error)),
                { query: options?.sql, error }
            );
    }
}

/**
 * Önbelleği temizler - hem doğrudan key hem de önek ile eşleşen tüm anahtarlar
 * @param cacheKey Önbellek anahtarı
 * @returns 
 */
async function clearCache(cacheKey: string): Promise<void> {
    if (!cacheKey) return;

    try {
        // Önce belirli anahtarı sil
        await redisService.del(cacheKey);
        databaseLogger.debug(`Önbellek silindi: ${cacheKey}`);
        
        // Eğer ':' içeriyorsa, bu bir namespace olabilir, bu desenle eşleşen tüm önbelleği temizle
        if (cacheKey.includes(':')) {
            const cachePrefix = cacheKey.split(':')[0];
            const wildcardKey = `${cachePrefix}:*`;
            try {
                const deleteCount = await redisService.del(wildcardKey);
                if (deleteCount > 0) {
                    databaseLogger.debug(`${deleteCount} önbellek öğesi silindi: ${wildcardKey}`);
                }
            } catch (redisError) {
                databaseLogger.debug('Joker karakter ile önbellek silme hatası:', redisError);
            }
        }
    } catch (error) {
        // Hata durumunda sadece logla - uygulamanın devam etmesini sağla
        databaseLogger.debug('Önbellek temizleme hatası (yok sayılıyor):', error);
    }
}

/**
 * INSERT, UPDATE veya DELETE sorgusu çalıştırır
 * @param options Çalıştırma seçenekleri
 * @returns İşlem sonuçları
 */
export async function execute(options: ExecuteOptions): Promise<unknown[]> {
    try {
        // Önbellek temizleme - işlemde değilse
        if (!options.transaction) {
            // 1. Doğrudan belirtilen cache key varsa temizle
            if (options.cache?.key) {
                await clearCache(options.cache.key);
            }
            
            // 2. SQL sorgusundan tablo adını çıkar ve ilgili önbellekleri temizle
            const sql = options.sql?.toLowerCase();
            if (sql) {
                let tableName: string | undefined;
                
                // Çeşitli SQL komutları için tablo adını çıkar
                if (sql.startsWith('insert into ')) {
                    tableName = sql.substring(12).split(/\s+/)[0].replace(/[\[\]"`']/g, '');
                } else if (sql.startsWith('update ')) {
                    tableName = sql.substring(7).split(/\s+/)[0].replace(/[\[\]"`']/g, '');
                } else if (sql.startsWith('delete from ')) {
                    tableName = sql.substring(12).split(/\s+/)[0].replace(/[\[\]"`']/g, '');
                }
                
                // Bulk insert durumunda da tablo adı olabilir
                if (!tableName && options.bulk) {
                    tableName = sql.trim().replace(/[\[\]"`']/g, '');
                }
                
                // Tablo adı bulunduysa, bu tabloyla ilgili tüm önbellekleri temizle
                if (tableName) {
                    try {
                        await redisService.del(`${tableName}:*`);
                        databaseLogger.debug(`'${tableName}:*' desenine uyan tüm önbellek öğeleri temizlendi`);
                    } catch (redisError) {
                        // Hata durumunda sadece logla, işlemin devam etmesini sağla
                        databaseLogger.debug(`'${tableName}:*' desenine uyan önbellek temizleme hatası:`, redisError);
                    }
                }
            }
        }

        // Sorguyu çalıştır
        return await provider.execute(options);
    } catch (error) {
        databaseLogger.error('Çalıştırma hatası:', error);
        throw error instanceof DatabaseError 
            ? error 
            : new DatabaseError(
                ErrorCode.DB_EXECUTION_ERROR,
                'Sorgu çalıştırılırken hata oluştu: ' + (error instanceof Error ? error.message : String(error)),
                { query: options?.sql, error }
            );
    }
}

/**
 * Bir işlem içinde birden çok sorgu çalıştırır
 * @param callback İşlem içinde çalıştırılacak fonksiyon
 * @returns İşlem sonucu
 */
export async function transaction<T>(
    callback: (transaction: any) => Promise<T>
): Promise<T> {
    try {
        return await provider.transaction(callback);
    } catch (error) {
        databaseLogger.error('İşlem hatası:', error);
        throw error instanceof DatabaseError 
            ? error 
            : new DatabaseError(
                ErrorCode.DB_TRANSACTION_ERROR,
                'İşlem sırasında hata oluştu: ' + (error instanceof Error ? error.message : String(error)),
                { error }
            );
    }
}

/**
 * Sayfalanmış sorgu çalıştırır
 * @param options Sayfalama seçenekleri
 * @returns Sayfalanmış sorgu sonuçları
 */
export async function queryWithPagination<T>(
    options: QueryWithPaginationOptions
): Promise<PaginationResult<T>> {
    try {
        // Önbellek etkinse ve işlemde değilsek önbellekten almayı dene
        if (options?.cache && !options.transaction) {
            const cached = await redisService.get<PaginationResult<T>>(options.cache.key);
            if (cached) {
                databaseLogger.debug(`Önbellekten alındı: ${options.cache.key}`);
                return cached;
            }
        }

        // Sayfalanmış sorguyu çalıştır
        const result = await provider.queryWithPagination<T>(options);
        
        // Önbellek etkinse ve işlemde değilsek sonucu önbelleğe al
        if (options?.cache && !options.transaction && result) {
            await redisService.set(
                options.cache.key, 
                result, 
                options.cache?.ttl
            );
            databaseLogger.debug(`Önbelleğe alındı: ${options.cache.key}`);
        }

        return result;
    } catch (error) {
        databaseLogger.error('Sayfalama sorgu hatası:', error);
        throw error instanceof DatabaseError 
            ? error 
            : new DatabaseError(
                ErrorCode.DB_QUERY_ERROR,
                'Sayfalama sorgusu çalıştırılırken hata oluştu: ' + (error instanceof Error ? error.message : String(error)),
                { query: options?.sql, pagination: { page: options?.page, pageSize: options?.pageSize }, error }
            );
    }
}

/**
 * Tüm veritabanı bağlantılarını kapatır
 * Uygulama kapatılırken çağrılmalıdır
 */
export async function closeConnections(): Promise<void> {
    try {
        // Önce anahtarları güvenli bir şekilde temizlemeye çalış
        try {
            await closeAllKeys();
        } catch (keyError) {
            // Anahtar hatasını yok say - bu performans için kritik bir sorun değil
            databaseLogger.debug('Anahtar temizleme hatası (yok sayılıyor):', keyError);
        }
        
        // Bağlantıları kapat
        await provider.close();
        databaseLogger.info('Veritabanı bağlantıları kapatıldı');
    } catch (error) {
        databaseLogger.error('Veritabanı bağlantılarını kapatma hatası:', error);
        throw error instanceof DatabaseError 
            ? error 
            : new DatabaseError(
                ErrorCode.DB_CONNECTION_ERROR,
                'Veritabanı bağlantıları kapatılırken hata oluştu: ' + (error instanceof Error ? error.message : String(error)),
                { error }
            );
    }
}

// Veritabanı modülüne dışa aktarılan arabirim
export default {
    query,
    execute,
    transaction,
    queryWithPagination,
    closeConnections,
    checkOpenKeys,
    closeAllKeys
};