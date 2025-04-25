import { mssql } from '../../../types';
import { config } from '../../../config';
import { keyManagerService } from './key-manager';
import { mssqlLogger } from '../../../utils';

/**
 * MSSQL bağlantı havuzu yöneticisi
 */
export class MssqlPoolManager {
    private static instance: MssqlPoolManager;
    private pool: mssql.ConnectionPool | null = null;
    private poolPromise: Promise<mssql.ConnectionPool> | null = null;
    private isShuttingDown = false;
    private connectionTimeouts: Map<string, NodeJS.Timeout> = new Map();
    
    private constructor() {
        // Temizleme işleyicilerini kaydet
        process.once('SIGINT', () => this.shutdown('SIGINT'));
        process.once('SIGTERM', () => this.shutdown('SIGTERM'));
        process.once('exit', () => this.shutdown('exit'));
    }
    
    public static getInstance(): MssqlPoolManager {
        if (!MssqlPoolManager.instance) {
            MssqlPoolManager.instance = new MssqlPoolManager();
        }
        return MssqlPoolManager.instance;
    }
    
    /**
     * Uygun hata işleme ile yeni bir bağlantı havuzu oluşturur
     */
    private async createPool(): Promise<mssql.ConnectionPool> {
        if (this.isShuttingDown) {
            throw new Error('Kapatma sırasında yeni havuz oluşturulamaz');
        }
        
        // Makul varsayılanlarla yapılandırma oluştur
        const dbConfig: mssql.config = {
            server: config.database.host,
            user: config.database.user,
            password: config.database.password,
            database: config.database.database,
            port: config.database.port,
            options: {
                encrypt: config.database.options?.encrypt,
                trustServerCertificate: config.database.options?.trustServerCertificate,
                enableArithAbort: true,
                appName: 'easy-database-connector',
            },
            pool: {
                max: 20,           // Maksimum havuz boyutu
                min: 2,            // Minimum havuz boyutu
                idleTimeoutMillis: 30000,  // 30 saniye
                acquireTimeoutMillis: 15000, // 15 saniye
                createTimeoutMillis: 30000, // 30 saniye
            },
            connectionTimeout: 30000,   // 30 saniye
            requestTimeout: 60000,      // 60 saniye
        };

        // Yeni havuz oluştur
        const newPool = new mssql.ConnectionPool(dbConfig);
        
        // Hata işleyicileri ayarla
        newPool.on('error', err => {
            mssqlLogger.error('Havuz hatası tespit edildi:', err);
            
            // Sadece ölümcül bir hataysa ve hala bu havuzu kullanıyorsak havuzu sıfırla
            if (this.pool === newPool && !this.isShuttingDown) {
                mssqlLogger.warn('Ölümcül hata nedeniyle havuz sıfırlanıyor');
                
                // Anahtar yöneticisini temizle
                keyManagerService.cleanupConnection(newPool);
                
                // Bir sonraki istekte yeni bir havuz oluşturulacak şekilde havuz değişkenlerini sıfırla
                this.pool = null;
                this.poolPromise = null;
            }
        });
        
        // Bağlan ve döndür
        try {
            const connectedPool = await newPool.connect();
            mssqlLogger.info(`${config.database.database} veritabanına ${config.database.host}:${config.database.port} üzerinden bağlandı`);
            return connectedPool;
        } catch (error) {
            mssqlLogger.error('Veritabanına bağlanılamadı:', error);
            
            // Bellek sızıntılarını önlemek için havuzu kapatmaya çalış
            try {
                await newPool.close();
            } catch (closeError) {
                // Sadece logla, fırlatma
                mssqlLogger.error('Başarısız havuzu kapatma hatası:', closeError);
            }
            
            throw error;
        }
    }
    
    /**
     * Mevcut bir havuz alır veya yeni bir tane oluşturur
     */
    public async getPool(): Promise<mssql.ConnectionPool> {
        // Zaten bağlı bir havuzumuz olup olmadığını kontrol et
        if (this.pool?.connected && !this.isShuttingDown) {
            return this.pool;
        }
        
        // Kapatma sürecindeyse yeni bağlantı oluşturma
        if (this.isShuttingDown) {
            throw new Error('Kapatma işlemi during shutdown sırasında havuz alınamaz');
        }
        
        // Zaten bir havuz oluşturuyorsak o promise'i döndür
        if (this.poolPromise) {
            return this.poolPromise;
        }
        
        // Yeni bir havuz oluştur
        this.poolPromise = this.createPool().then(newPool => {
            this.pool = newPool;
            this.poolPromise = null;
            return newPool;
        }).catch(error => {
            // Hatada tekrar deneyebilmek için promise'i sıfırla
            this.poolPromise = null;
            throw error;
        });
        
        return this.poolPromise;
    }
    
    /**
     * Havuzu düzgün bir şekilde kapatır
     */
    public async shutdown(reason?: string): Promise<void> {
        if (this.isShuttingDown || !this.pool) {
            return; // Zaten kapanıyor veya kapatılacak havuz yok
        }
        
        this.isShuttingDown = true;
        mssqlLogger.info(`Veritabanı havuzu kapatılıyor${reason ? ` (${reason})` : ''}`);
        
        try {
            // Tüm zaman aşımlarını iptal et
            for (const [id, timeout] of this.connectionTimeouts.entries()) {
                clearTimeout(timeout);
                this.connectionTimeouts.delete(id);
            }
            
            // Tüm anahtarları kapat ve anahtar yöneticisini kapat
            keyManagerService.shutdown();
            
            // Havuzu kapat
            if (this.pool) {
                await this.pool.close();
                this.pool = null;
            }
            
            mssqlLogger.info('Veritabanı havuzu başarıyla kapatıldı');
        } catch (error) {
            mssqlLogger.error('Veritabanı havuzu kapatma sırasında hata:', error);
        } finally {
            this.poolPromise = null;
            this.pool = null;
        }
    }
}

// Singleton havuz yöneticisi
export const poolManager = MssqlPoolManager.getInstance();
