import { mssql } from '../../../types';
import { config } from '../../../config';
import { keyManagerLogger } from '../../../utils';

/**
 * Daha basit ve güvenilir MSSQL anahtar yönetimi
 * - Sürekli açma/kapatma işlemlerini önler
 * - Veritabanı seviyesinde şifreleme yapar
 * - Paralel işlemlerde güvenilir çalışır
 */
export class KeyManager {
    private static instance: KeyManager;
    
    // Şifreleme yapılandırması
    private isEncryptionEnabled = false;
    private keysInitialized = false;
    
    // Singleton pattern
    private constructor() {}
    
    public static getInstance(): KeyManager {
        if (!KeyManager.instance) {
            KeyManager.instance = new KeyManager();
        }
        return KeyManager.instance;
    }
    
    /**
     * Veritabanı başlangıcında şifreleme yapılandırmasını kontrol eder
     */
    public async initialize(pool: mssql.ConnectionPool): Promise<boolean> {
        if (this.keysInitialized) {
            return this.isEncryptionEnabled;
        }
        
        // Şifreleme devre dışı bırakıldı mı kontrol et
        if (process.env.DB_SKIP_ENCRYPTION === 'true') {
            keyManagerLogger.info('Şifreleme yapılandırma tarafından devre dışı bırakılmıştır');
            this.isEncryptionEnabled = false;
            this.keysInitialized = true;
            return false;
        }
        
        // Şifreleme için gerekli yapılandırmaları kontrol et
        if (!config.database.symmetricKeyName || 
            !config.database.certificateName || 
            !config.database.masterKeyPassword) {
            keyManagerLogger.warn('Şifreleme için gerekli yapılandırmalar eksik - devre dışı bırakılıyor');
            this.isEncryptionEnabled = false;
            this.keysInitialized = true;
            return false;
        }
        
        try {
            // Gerekli anahtarların mevcut olup olmadığını kontrol et
            const request = pool.request();
            
            // Master Key kontrolü
            const masterKeyCheck = await request.query(`
                SELECT COUNT(*) AS count 
                FROM sys.symmetric_keys 
                WHERE name = '##MS_DatabaseMasterKey##'
            `);
            
            if (masterKeyCheck.recordset[0].count === 0) {
                keyManagerLogger.warn('Veritabanında Master Key bulunamadı - şifreleme devre dışı');
                this.isEncryptionEnabled = false;
                this.keysInitialized = true;
                return false;
            }
            
            // Simetrik anahtar kontrolü
            const symKeyCheck = await request.query(`
                SELECT COUNT(*) AS count 
                FROM sys.symmetric_keys 
                WHERE name = '${config.database.symmetricKeyName}'
            `);
            
            if (symKeyCheck.recordset[0].count === 0) {
                keyManagerLogger.warn(`'${config.database.symmetricKeyName}' simetrik anahtarı bulunamadı - şifreleme devre dışı`);
                this.isEncryptionEnabled = false;
                this.keysInitialized = true;
                return false;
            }
            
            // Sertifika kontrolü
            const certCheck = await request.query(`
                SELECT COUNT(*) AS count 
                FROM sys.certificates 
                WHERE name = '${config.database.certificateName}'
            `);
            
            if (certCheck.recordset[0].count === 0) {
                keyManagerLogger.warn(`'${config.database.certificateName}' sertifikası bulunamadı - şifreleme devre dışı`);
                this.isEncryptionEnabled = false;
                this.keysInitialized = true;
                return false;
            }
            
            // Tüm kontroller başarılı, şifreleme etkin
            keyManagerLogger.info('Şifreleme anahtarları doğrulandı ve etkinleştirildi');
            this.isEncryptionEnabled = true;
            this.keysInitialized = true;
            return true;
        } catch (error) {
            keyManagerLogger.error('Şifreleme anahtarlarını kontrol ederken hata:', error);
            this.isEncryptionEnabled = false;
            this.keysInitialized = true;
            return false;
        }
    }
    
    /**
     * Bu sorgu için şifreleme gerekip gerekmediğini kontrol eder
     */
    public isEncryptionRequired(encryption?: any): boolean {
        if (!this.isEncryptionEnabled) return false;
        if (!encryption) return false;
        
        // İçi boş obje kontrolü
        if (typeof encryption === 'object' && Object.keys(encryption).length === 0) {
            return false;
        }
        
        // Boolean kontrolü
        if (typeof encryption === 'boolean') {
            return encryption;
        }
        
        // Obje kontrolü
        if (typeof encryption === 'object') {
            return encryption.aes === true || encryption.masterkey === true;
        }
        
        return false;
    }
    
    /**
     * Şifreleme için SQL sorgusu oluşturur - her sorgu kendi şifreleme ortamını yaratır
     * @param sql Orijinal SQL sorgusu
     * @returns Şifreleme için hazırlanmış SQL sorgusu
     */
    public wrapQueryWithEncryption(sql: string): string {
        if (!this.isEncryptionEnabled) return sql;
        
        // SQL'i şifreleme açma/kapama komutlarıyla sar
        return `
            -- Şifreleme başlangıcı
            BEGIN TRY
                -- Master key'i aç
                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                BEGIN
                    OPEN MASTER KEY DECRYPTION BY PASSWORD = '${config.database.masterKeyPassword}';
                END
                
                -- Simetrik anahtarı aç
                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                BEGIN
                    OPEN SYMMETRIC KEY ${config.database.symmetricKeyName} 
                    DECRYPTION BY CERTIFICATE ${config.database.certificateName};
                END
                
                -- Ana sorguyu çalıştır
                ${sql}
                
                -- Simetrik anahtarı kapat (master key'i açık bırak)
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                BEGIN
                    CLOSE SYMMETRIC KEY ${config.database.symmetricKeyName};
                END
            END TRY
            BEGIN CATCH
                -- Hata durumunda temizlik yap
                IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${config.database.symmetricKeyName}')
                BEGIN
                    CLOSE SYMMETRIC KEY ${config.database.symmetricKeyName};
                END
                
                -- Hatayı yeniden fırlat
                THROW;
            END CATCH
        `;
    }
    
    /**
     * Verileri SQL Server tarafında şifrelemek için sorgu oluşturur
     * @param values Şifrelenecek değerler
     * @returns Şifreleme SQL sorgusu
     */
    public buildEncryptionQuery(values: any[]): string {
        if (!this.isEncryptionEnabled) {
            throw new Error('Şifreleme etkin değil');
        }
        
        // JSON verilerini SQL Server'da şifrelemek için sorgu
        return `
            SELECT 
                EncryptByKey(Key_GUID('${config.database.symmetricKeyName}'), 
                CONVERT(VARBINARY(MAX), value)) AS encrypted 
            FROM OPENJSON(@values) WITH (value nvarchar(max) '$')
        `;
    }
    
    /**
     * Servis düzgünce kapatıldığında çağrılır
     */
    public shutdown(): void {
        keyManagerLogger.info('Anahtar yöneticisi kapatılıyor');
        this.isEncryptionEnabled = false;
    }
}

// Singleton örneği
export const keyManager = KeyManager.getInstance();
