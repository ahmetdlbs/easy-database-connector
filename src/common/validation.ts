import { DatabaseError, ErrorCode } from './errors';

/**
 * Sorgu parametrelerini doğrular
 * @param sql SQL sorgusu
 * @param parameters Parametreler
 * @throws Geçersiz parametreler için hata
 */
export function validateQueryParameters(
    sql: string | undefined, 
    parameters?: unknown[]
): void {
    if (!sql || typeof sql !== 'string' || sql.trim() === '') {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'Geçerli bir SQL sorgusu sağlanmalıdır',
            { sql }
        );
    }
    
    if (parameters && !Array.isArray(parameters)) {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'Parametreler bir dizi olmalıdır',
            { parameters }
        );
    }
}

/**
 * Sayfalama parametrelerini doğrular
 * @param page Sayfa numarası
 * @param pageSize Sayfa boyutu
 * @throws Geçersiz sayfalama için hata
 */
export function validatePaginationParameters(
    page?: number | string,
    pageSize?: number | string
): { page: number; pageSize: number } {
    const pageNumber = typeof page === 'string' ? parseInt(page, 10) : (page || 1);
    const pageSizeNumber = typeof pageSize === 'string' ? parseInt(pageSize, 10) : (pageSize || 10);
    
    if (isNaN(pageNumber) || pageNumber < 1) {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'Sayfa numarası pozitif bir tamsayı olmalıdır',
            { page }
        );
    }
    
    if (isNaN(pageSizeNumber) || pageSizeNumber < 1 || pageSizeNumber > 1000) {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'Sayfa boyutu 1 ile 1000 arasında olmalıdır',
            { pageSize }
        );
    }
    
    return { page: pageNumber, pageSize: pageSizeNumber };
}

/**
 * Önbellek parametrelerini doğrular
 * @param cacheKey Önbellek anahtarı
 * @param ttl Önbellek TTL değeri
 * @throws Geçersiz önbellek parametreleri için hata
 */
export function validateCacheParameters(
    cacheKey?: string,
    ttl?: number
): void {
    if (cacheKey !== undefined && (typeof cacheKey !== 'string' || cacheKey.trim() === '')) {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'Geçerli bir önbellek anahtarı sağlanmalıdır',
            { cacheKey }
        );
    }
    
    if (ttl !== undefined && (typeof ttl !== 'number' || ttl < 0)) {
        throw new DatabaseError(
            ErrorCode.INVALID_PARAMETER,
            'TTL değeri sıfır veya pozitif bir sayı olmalıdır',
            { ttl }
        );
    }
}
