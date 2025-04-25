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
 * INSERT, UPDATE veya DELETE sorgusu çalıştırır
 * @param options Çalıştırma seçenekleri
 * @returns İşlem sonuçları
 */
export async function execute(options: ExecuteOptions): Promise<unknown[]> {
    try {
        // Belirtilmişse ve işlemde değilsek önbelleği geçersiz kıl
        if (options.cache && !options.transaction) {
            await redisService.del(options.cache.key);
            databaseLogger.debug(`Önbellek geçersiz kılındı: ${options.cache.key}`);
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
    closeConnections
};
