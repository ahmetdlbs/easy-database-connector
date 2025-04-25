/**
 * Hata kodları
 */
export enum ErrorCode {
    // Genel hatalar
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    INVALID_PARAMETER = 'INVALID_PARAMETER',
    
    // Veritabanı hataları
    DB_CONNECTION_ERROR = 'DB_CONNECTION_ERROR',
    DB_QUERY_ERROR = 'DB_QUERY_ERROR',
    DB_TRANSACTION_ERROR = 'DB_TRANSACTION_ERROR',
    DB_EXECUTION_ERROR = 'DB_EXECUTION_ERROR',
    
    // Şifreleme hataları
    ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
    KEY_MANAGEMENT_ERROR = 'KEY_MANAGEMENT_ERROR',
    
    // Redis hataları
    REDIS_CONNECTION_ERROR = 'REDIS_CONNECTION_ERROR',
    REDIS_OPERATION_ERROR = 'REDIS_OPERATION_ERROR',
    CACHE_ERROR = 'CACHE_ERROR',
}

/**
 * Özel hata sınıfı
 */
export class DatabaseError extends Error {
    readonly code: ErrorCode;
    readonly details?: unknown;
    
    constructor(code: ErrorCode, message: string, details?: unknown) {
        super(message);
        this.name = 'DatabaseError';
        this.code = code;
        this.details = details;
        
        // ES2022 öncesi için prototip bağlantısını kur
        Object.setPrototypeOf(this, DatabaseError.prototype);
    }
    
    /**
     * Hata bilgilerini JSON olarak döndürür
     */
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            stack: this.stack
        };
    }
}
