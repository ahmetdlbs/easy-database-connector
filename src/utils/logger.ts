/**
 * Loglama için basit bir sınıf
 */
export class Logger {
    private readonly context: string;
    private static logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'; // Varsayılan değeri info yap
    
    /**
     * Yeni bir logger örneği oluşturur
     * @param context Modül veya sınıf adı
     */
    constructor(context: string) {
        this.context = context;
    }
    
    /**
     * Global log seviyesini ayarlar
     */
    public static setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
        Logger.logLevel = level;
    }
    
    /**
     * Log mesajını biçimlendirir
     */
    private formatMessage(message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${this.context}] ${message}`;
    }
    
    /**
     * Debug seviyesinde log oluşturur
     */
    public debug(message: string, ...args: any[]): void {
        if (Logger.logLevel === 'debug') {
            console.debug(this.formatMessage(message), ...args);
        }
    }
    
    /**
     * Info seviyesinde log oluşturur
     */
    public info(message: string, ...args: any[]): void {
        if (['debug', 'info'].includes(Logger.logLevel)) {
            console.info(this.formatMessage(message), ...args);
        }
    }
    
    /**
     * Uyarı seviyesinde log oluşturur
     */
    public warn(message: string, ...args: any[]): void {
        if (['debug', 'info', 'warn'].includes(Logger.logLevel)) {
            console.warn(this.formatMessage(message), ...args);
        }
    }
    
    /**
     * Hata seviyesinde log oluşturur
     */
    public error(message: string, ...args: any[]): void {
        console.error(this.formatMessage(message), ...args);
    }
}

// Her modül için logger nesneleri
export const databaseLogger = new Logger('Database');
export const redisLogger = new Logger('Redis');
export const mssqlLogger = new Logger('MSSQL');
export const keyManagerLogger = new Logger('KeyManager');
