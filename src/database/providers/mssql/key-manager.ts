import { mssql } from '../../../types';
import { config } from '../../../config';
import { AsyncMutex, keyManagerLogger } from '../../../utils';

/**
 * MS SQL Server şifreleme anahtarları yönetimi
 */
export class KeyManagerService {
    private static instance: KeyManagerService;
    private connectionKeyStates = new Map<string, {
        openKeys: Set<string>;
        masterKeyOpen: boolean;
        lastUsed: number;
    }>();
    private mutex = new AsyncMutex();
    private autoCloseIntervalId?: NodeJS.Timeout;
    private closed = false;
    private keysChecked = false;
    private keysAvailable = false;
    
    // Sabitler
    private readonly KEY_AUTO_CLOSE_INTERVAL_MS = 2 * 60 * 1000; // 2 dakika
    private readonly KEY_INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000; // 5 dakika
    
    // Singleton pattern için private constructor
    private constructor() {
        // Otomatik kapatma aralığını başlat
        this.startAutoCloseInterval();
    }
    
    /**
     * KeyManagerService singleton örneğini alır
     */
    public static getInstance(): KeyManagerService {
        if (!KeyManagerService.instance) {
            KeyManagerService.instance = new KeyManagerService();
        }
        return KeyManagerService.instance;
    }
    
    /**
     * Etkin olmayan anahtarları otomatik kapatma zamanlayıcısını başlatır
     */
    private startAutoCloseInterval(): void {
        if (!this.autoCloseIntervalId) {
            this.autoCloseIntervalId = setInterval(() => {
                this.cleanupInactiveKeys().catch(err => {
                    keyManagerLogger.error('Etkin olmayan anahtarları temizleme hatası:', err);
                });
            }, this.KEY_AUTO_CLOSE_INTERVAL_MS);
            
            // Zamanlayıcının Node.js sürecini açık tutmasını engelle
            if (this.autoCloseIntervalId.unref) {
                this.autoCloseIntervalId.unref();
            }
        }
    }
    
    /**
     * Veritabanında şifreleme anahtarlarının var olup olmadığını kontrol eder
     * @param pool Veritabanı bağlantı havuzu
     * @returns Anahtarlar mevcutsa true, değilse false
     */
    public async checkEncryptionKeys(pool: mssql.ConnectionPool): Promise<boolean> {
        if (this.keysChecked) {
            return this.keysAvailable;
        }
        
        try {
            const request = pool.request();
            
            // Master key kontrol et
            const masterKeyResult = await request.query(`
                SELECT COUNT(*) AS keyCount 
                FROM sys.symmetric_keys 
                WHERE name = '##MS_DatabaseMasterKey##'
            `);
            
            const masterKeyExists = masterKeyResult.recordset[0].keyCount > 0;
            
            if (!masterKeyExists) {
                keyManagerLogger.warn('Veritabanında master key bulunamadı');
                this.keysChecked = true;
                this.keysAvailable = false;
                return false;
            }
            
            // Simetrik anahtar kontrol et
            if (config.database.symmetricKeyName) {
                const symKeyResult = await request.query(`
                    SELECT COUNT(*) AS keyCount 
                    FROM sys.symmetric_keys 
                    WHERE name = '${config.database.symmetricKeyName}'
                `);
                
                const symKeyExists = symKeyResult.recordset[0].keyCount > 0;
                
                if (!symKeyExists) {
                    keyManagerLogger.warn(`Simetrik anahtar '${config.database.symmetricKeyName}' bulunamadı`);
                    this.keysChecked = true;
                    this.keysAvailable = false;
                    return false;
                }
            }
            
            // Sertifika kontrol et
            if (config.database.certificateName) {
                const certResult = await request.query(`
                    SELECT COUNT(*) AS certCount 
                    FROM sys.certificates 
                    WHERE name = '${config.database.certificateName}'
                `);
                
                const certExists = certResult.recordset[0].certCount > 0;
                
                if (!certExists) {
                    keyManagerLogger.warn(`Sertifika '${config.database.certificateName}' bulunamadı`);
                    this.keysChecked = true;
                    this.keysAvailable = false;
                    return false;
                }
            }
            
            keyManagerLogger.info('Tüm şifreleme anahtarları ve sertifikalar mevcut');
            this.keysChecked = true;
            this.keysAvailable = true;
            return true;
        } catch (error) {
            keyManagerLogger.error('Şifreleme anahtarlarını kontrol ederken hata:', error);
            this.keysChecked = true;
            this.keysAvailable = false;
            return false;
        }
    }
    
    /**
     * Etkin olmayan bağlantılar için anahtar durumlarını temizler
     */
    private async cleanupInactiveKeys(): Promise<void> {
        if (this.closed) return;
        
        const now = Date.now();
        const staleSessions: string[] = [];
        
        // Etkin olmayan oturumları bul
        for (const [id, state] of this.connectionKeyStates.entries()) {
            if (now - state.lastUsed > this.KEY_INACTIVITY_THRESHOLD_MS) {
                staleSessions.push(id);
            }
        }
        
        // Yapılacak bir şey yoksa çık
        if (staleSessions.length === 0) return;
        
        // Temizleme işlemini logla
        keyManagerLogger.debug(`${staleSessions.length} etkin olmayan oturum için anahtarlar otomatik kapatılıyor`);
        
        // Eski oturumları kaldır
        for (const id of staleSessions) {
            this.connectionKeyStates.delete(id);
        }
    }
    
    /**
     * Anahtarları izlemek için belirleyici bir bağlantı ID'si oluşturur
     */
    public generateConnectionId(pool: mssql.ConnectionPool, transaction?: mssql.Transaction): string {
        if (transaction) {
            return `tx_${transaction.isolationLevel}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        }
        return `pool_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    }
    
    /**
     * SQL Server şifreleme anahtarlarını iyileştirilmiş eşzamanlılık işleme ile yönetir
     */
    public async manageKey(
        pool: mssql.ConnectionPool, 
        keyConfig: {
            aes?: boolean;
            masterkey?: boolean;
        }, 
        transaction?: mssql.Transaction,
        connectionId?: string
    ): Promise<string> {
        if (this.closed) {
            throw new Error('Anahtar yönetim servisi kapatıldı');
        }
        
        // Şifreleme yapılandırma göz ardı modunu kontrol et
        const skipEncryption = process.env.DB_SKIP_ENCRYPTION === 'true';
        if (skipEncryption && (keyConfig.aes || keyConfig.masterkey)) {
            keyManagerLogger.warn('Şifreleme devre dışı bırakıldı (DB_SKIP_ENCRYPTION=true)');
            return connectionId || this.generateConnectionId(pool, transaction);
        }
        
        // Anahtarların mevcut olup olmadığını kontrol et
        if (!this.keysChecked && (keyConfig.aes || keyConfig.masterkey)) {
            const keysAvailable = await this.checkEncryptionKeys(pool);
            if (!keysAvailable) {
                keyManagerLogger.warn('Şifreleme anahtarları kullanılamıyor, işlem şifreleme olmadan devam edecek');
                return connectionId || this.generateConnectionId(pool, transaction);
            }
        }
        
        const connId = connectionId || this.generateConnectionId(pool, transaction);
        
        // Zaman aşımı ile deadlock'ları önlemek için mutex al
        let release: (() => void) | undefined;
        try {
            release = await this.mutex.acquire();
            
            // Bu bağlantı için durum al veya başlat
            let connState = this.connectionKeyStates.get(connId);
            if (!connState) {
                connState = {
                    openKeys: new Set<string>(),
                    masterKeyOpen: false,
                    lastUsed: Date.now()
                };
                this.connectionKeyStates.set(connId, connState);
            } else {
                // Son kullanım zamanını güncelle
                connState.lastUsed = Date.now();
            }
            
            const request = transaction ? new mssql.Request(transaction) : pool.request();
            
            // ANAHTARLARI AÇMA
            if (keyConfig.masterkey || keyConfig.aes) {
                // Gerekirse master key'i aç
                if (keyConfig.masterkey && !connState.masterKeyOpen) {
                    try {
                        // Master key var mı kontrol et
                        const keyCheck = await request.query(`
                            SELECT 1 FROM sys.symmetric_keys 
                            WHERE name = '##MS_DatabaseMasterKey##'
                        `);
                        
                        if (keyCheck.recordset.length === 0) {
                            throw new Error('Veritabanında master key bulunamadı');
                        }
                        
                        // Master key'i aç
                        await request.batch(`
                            IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                            BEGIN
                                OPEN MASTER KEY DECRYPTION BY PASSWORD = '${config.database.masterKeyPassword}';
                            END
                        `);
                        connState.masterKeyOpen = true;
                    } catch (error) {
                        const err = error as mssql.RequestError;
                        // Anahtar zaten açıksa hata değil
                        if (err.number === 15466) {
                            connState.masterKeyOpen = true;
                        } else {
                            keyManagerLogger.error('Master key işlemi başarısız:', err);
                            throw new Error(`Master key işlemi başarısız: ${err.message}`);
                        }
                    }
                }
                
                // Gerekirse simetrik anahtarı aç
                if (keyConfig.aes && 
                    config.database.symmetricKeyName && 
                    !connState.openKeys.has(config.database.symmetricKeyName)) {
                    try {
                        // Önce master key'in açık olduğundan emin ol
                        if (!connState.masterKeyOpen && keyConfig.masterkey !== false) {
                            // Master key açma işlemi
                            await request.batch(`
                                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                                BEGIN
                                    OPEN MASTER KEY DECRYPTION BY PASSWORD = '${config.database.masterKeyPassword}';
                                END
                            `);
                            connState.masterKeyOpen = true;
                        }
                        
                        // Simetrik anahtar var mı kontrol et
                        const keyCheck = await request.query(`
                            SELECT 1 FROM sys.symmetric_keys 
                            WHERE name = '${config.database.symmetricKeyName}'
                        `);
                        
                        if (keyCheck.recordset.length === 0) {
                            throw new Error(`'${config.database.symmetricKeyName}' simetrik anahtarı veritabanında bulunamadı`);
                        }
                        
                        // Simetrik anahtarı aç
                        await request.batch(`
                            IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                            BEGIN
                                OPEN SYMMETRIC KEY ${config.database.symmetricKeyName} 
                                DECRYPTION BY CERTIFICATE ${config.database.certificateName};
                            END
                        `);
                        connState.openKeys.add(config.database.symmetricKeyName);
                    } catch (error) {
                        const err = error as mssql.RequestError;
                        // Anahtar zaten açıksa hata değil
                        if (err.number === 15466) {
                            connState.openKeys.add(config.database.symmetricKeyName || '');
                        } else {
                            keyManagerLogger.error('Simetrik anahtar işlemi başarısız:', err);
                            throw new Error(`Simetrik anahtar işlemi başarısız: ${err.message}`);
                        }
                    }
                }
            }
            // ANAHTARLARI KAPATMA
            else {
                // Açıksa simetrik anahtarı kapat
                if (config.database.symmetricKeyName && 
                    connState.openKeys.has(config.database.symmetricKeyName)) {
                    try {
                        await request.batch(`
                            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                            BEGIN
                                CLOSE SYMMETRIC KEY ${config.database.symmetricKeyName};
                            END
                        `);
                        connState.openKeys.delete(config.database.symmetricKeyName);
                    } catch (error) {
                        keyManagerLogger.error('Simetrik anahtarı kapatma hatası:', error);
                    }
                }
                
                // Açıksa master key'i kapat
                if (connState.masterKeyOpen) {
                    try {
                        await request.batch(`
                            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                            BEGIN
                                CLOSE MASTER KEY;
                            END
                        `);
                        connState.masterKeyOpen = false;
                    } catch (error) {
                        keyManagerLogger.error('Master key kapatma hatası:', error);
                    }
                }
                
                // Açık anahtar kalmadıysa durumu temizle
                if (connState.openKeys.size === 0 && !connState.masterKeyOpen) {
                    this.connectionKeyStates.delete(connId);
                }
            }
            
            return connId;
        } catch (error) {
            // Logla ve yeniden fırlat
            keyManagerLogger.error('Anahtar işlemi başarısız:', error);
            throw error;
        } finally {
            // Her zaman mutex'i serbest bırak
            if (release) {
                release();
            }
        }
    }
    
    /**
     * Bir bağlantı için kaynakları temizler
     */
    public cleanupConnection(pool: mssql.ConnectionPool, connectionId?: string): void {
        // Belirli bir connectionId sağlanmışsa, sadece onu kaldır
        if (connectionId && this.connectionKeyStates.has(connectionId)) {
            this.connectionKeyStates.delete(connectionId);
            // Veritabanında anahtarları kapat
            this.cleanupKeysInDatabase(pool).catch(err => {
                keyManagerLogger.error('Bağlantı anahtarlarını kapatma hatası:', err);
            });
            return;
        }
        
        // Aksi halde tüm havuz bağlantılarını kaldır
        const toRemove: string[] = [];
        for (const connId of this.connectionKeyStates.keys()) {
            if (connId.startsWith('pool_')) {
                toRemove.push(connId);
            }
        }
        
        for (const connId of toRemove) {
            this.connectionKeyStates.delete(connId);
        }
        
        // Havuz bağlantıları için veritabanı anahtarlarını kapat
        if (toRemove.length > 0) {
            this.cleanupKeysInDatabase(pool).catch(err => {
                keyManagerLogger.error('Havuz anahtarlarını toplu kapatma hatası:', err);
            });
        }
    }
    
    /**
     * Veritabanında anahtarları kapatmak için yardımcı metod - SQL Server master key kurallarına uyar
     */
    private async cleanupKeysInDatabase(pool: mssql.ConnectionPool, transaction?: mssql.Transaction): Promise<void> {
        try {
            const request = transaction ? new mssql.Request(transaction) : pool.request();
            
            // Sadece özel simetrik anahtarları kapat, sistem master key'lerini kapatmayı deneme
            if (config.database.symmetricKeyName) {
                await request.batch(`
                    IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                    BEGIN
                        CLOSE SYMMETRIC KEY ${config.database.symmetricKeyName};
                    END
                `);
                keyManagerLogger.debug(`Simetrik anahtar kapatıldı: ${config.database.symmetricKeyName}`);
            }
            
            // Önemli: Master key'i kapatmayı deneme - MS SQL Server'da "Global temporary keys are not allowed" hatası verir
            // SQL Server bu anahtarların oturum süresince açık kalmasına izin verir ve kendi yönetir
        } catch (error) {
            keyManagerLogger.debug('Veritabanında anahtar temizleme sırasında beklenen hata (yok sayılıyor):', error);
            // Hata fırlatma - bu hataları yönetmek için üst seviye metodları kullanıyoruz
        }
    }

    /**
     * Bir işlem için kaynakları temizler
     */
    public cleanupTransaction(pool: mssql.ConnectionPool, transaction: mssql.Transaction, connectionId?: string): void {
        // Belirli bir connectionId sağlanmışsa, sadece onu kaldır
        if (connectionId && this.connectionKeyStates.has(connectionId)) {
            this.connectionKeyStates.delete(connectionId);
            // Veritabanında anahtarları kapat
            this.cleanupKeysInDatabase(pool, transaction).catch(err => {
                keyManagerLogger.error('İşlem anahtarlarını kapatma hatası:', err);
            });
            return;
        }
        
        // Aksi halde tüm işlem bağlantılarını kaldır
        const toRemove: string[] = [];
        for (const connId of this.connectionKeyStates.keys()) {
            if (connId.startsWith('tx_')) {
                toRemove.push(connId);
            }
        }
        
        for (const connId of toRemove) {
            this.connectionKeyStates.delete(connId);
        }
        
        // Veritabanında anahtarları kapat
        this.cleanupKeysInDatabase(pool, transaction).catch(err => {
            keyManagerLogger.error('İşlem anahtarlarını toplu kapatma hatası:', err);
        });
    }
    
    /**
     * Sistemde açık anahtarları durumunu kontrol eder
     * @param pool Veritabanı bağlantı havuzu
     * @param printToLogs Sonuçları loga yazsın mı
     * @returns Sistemdeki açık anahtar listesi
     */
    public async checkOpenKeys(pool: mssql.ConnectionPool, printToLogs: boolean = true): Promise<unknown[]> {
        try {
            const request = pool.request();
            const result = await request.query(`
                SELECT * FROM sys.openkeys
            `);
            
            if (printToLogs) {
                if (result.recordset.length === 0) {
                    keyManagerLogger.info('Sistemde açık anahtar bulunmamaktadır');
                } else {
                    keyManagerLogger.info(`Sistemde ${result.recordset.length} açık anahtar bulundu:`);
                    for (const key of result.recordset) {
                        keyManagerLogger.info(`  - Anahtar: ${key.key_name}, ID: ${key.key_id}`);
                    }
                }
            }
            
            return result.recordset;
        } catch (error) {
            keyManagerLogger.error('Açık anahtarları kontrol etme hatası:', error);
            return [];
        }
    }
    
    /**
     * Anahtar yönetim servisini kapatır
     */
    public shutdown(): void {
        this.closed = true;
        
        if (this.autoCloseIntervalId) {
            clearInterval(this.autoCloseIntervalId);
            this.autoCloseIntervalId = undefined;
        }
        
        this.connectionKeyStates.clear();
    }
}

// Singleton örneğini ihraç et
export const keyManagerService = KeyManagerService.getInstance();
