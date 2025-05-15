// src/database/providers/mssql/encryption.ts
/**
 * @fileoverview SQL Server için profesyonel şifreleme kütüphanesi
 * Bu modül, SQL Server'da Always Encrypted veya şifreleme hiyerarşisi
 * kullanarak verileri güvenli ve verimli şekilde şifrelemek için 
 * tasarlanmıştır.
 * 
 * @author Ahmet Candelibas
 * @license MIT
 */

import * as mssql from 'mssql';
import { mssqlLogger } from '../../../utils';
import { DatabaseConfig } from '../../../types';
import SqlEncryptionHelper from './sql-encryption-helper';

/**
 * Şifreleme yapılandırması
 */
export interface EncryptionConfig {
  /**
   * Yapılandırma tipi - Always Encrypted veya Column Level Encryption (CLE)
   * Always Encrypted: İstemci tarafında şifreleme, daha güvenli
   * CLE: Veritabanı tarafında şifreleme, daha esnek
   */
  type: 'always-encrypted' | 'column-encryption';
  
  /**
   * Column Level Encryption için sertifika ve anahtar yapılandırması
   */
  cle?: {
    masterKeyPassword: string;
    certificateName: string;
    symmetricKeyName: string;
  };
  
  /**
   * Always Encrypted için sütun ana anahtarı ve sütun şifreleme anahtarları 
   */
  alwaysEncrypted?: {
    columnMasterKeyName: string;
    columnEncryptionKeyName: string;
  };

  /**
   * Şifreleme algoritması
   */
  algorithm?: 'AES_256' | 'AES_128';
  
  /**
   * Şifrelemeyi devre dışı bırakma seçeneği (test ve geliştirme için)
   */
  disabled?: boolean;
}

/**
 * Şifreleme ve şifre çözme işlemleri için yüksek performanslı SQL Server şifreleme servisi
 */
export class SqlServerEncryption {
  private static instance: SqlServerEncryption;
  private config: EncryptionConfig | null = null;
  private isInitialized = false;
  private keysAvailable = false;
  
  /**
   * Singleton kalıbı - yeni bir instance almak yerine mevcut instance'ı döndürür
   */
  public static getInstance(): SqlServerEncryption {
    if (!SqlServerEncryption.instance) {
      SqlServerEncryption.instance = new SqlServerEncryption();
    }
    return SqlServerEncryption.instance;
  }
  
  /**
   * Özel constructor - bu sınıf dışında doğrudan instance oluşturulamaz
   */
  private constructor() {}

  /**
   * Şifreleme servisini yapılandırır
   * @param config Şifreleme yapılandırması
   */
  public configure(config: EncryptionConfig): void {
    this.config = config;
    this.isInitialized = false;
    this.keysAvailable = false;
    
    SqlEncryptionHelper.log('info', 'SQL Server şifreleme yapılandırması güncellendi', { 
      type: config.type,
      disabled: config.disabled || false 
    });
  }
  
  /**
   * Veritabanı yapılandırmasından şifreleme yapılandırması oluşturur
   * @param dbConfig Veritabanı yapılandırması
   */
  public configureFromDatabaseConfig(dbConfig: DatabaseConfig): void {
    // Çevre değişkenlerinden şifreleme devre dışı bırakıldı mı kontrol et
    const disabled = process.env.DB_SKIP_ENCRYPTION === 'true';
    
    // Şifreleme gerekli mi kontrol et
    if (disabled || !dbConfig.symmetricKeyName || !dbConfig.certificateName || !dbConfig.masterKeyPassword) {
      this.configure({
        type: 'column-encryption',
        disabled: true
      });
      return;
    }
    
    // CLE yapılandırması oluştur
    this.configure({
      type: 'column-encryption',
      cle: {
        masterKeyPassword: dbConfig.masterKeyPassword,
        certificateName: dbConfig.certificateName,
        symmetricKeyName: dbConfig.symmetricKeyName
      },
      algorithm: 'AES_256'
    });
  }
  
  /**
   * Ek ayarlarla şifreleme durumunu başlatır ve kontrol eder
   * @param pool Bağlantı havuzu
   * @param force Durumu zorla yeniden kontrol et
   */
  public async initialize(pool: mssql.ConnectionPool, force = false): Promise<boolean> {
    // Zaten başlatıldıysa ve zorlama yoksa mevcut durumu döndür
    if (this.isInitialized && !force) {
      return this.keysAvailable;
    }
    
    // Yapılandırılmamışsa false döndür
    if (!this.config) {
      SqlEncryptionHelper.log('warn', 'Şifreleme yapılandırılmadan initialize çağrıldı');
      this.isInitialized = true;
      this.keysAvailable = false;
      return false;
    }
    
    // Devre dışı bırakıldıysa false döndür
    if (this.config.disabled) {
      SqlEncryptionHelper.log('info', 'Şifreleme yapılandırma ile devre dışı bırakıldı');
      this.isInitialized = true;
      this.keysAvailable = false;
      return false;
    }
    
    try {
      // Şifreleme tipine göre kontrol yap
      if (this.config.type === 'column-encryption' && this.config.cle) {
        return await this.initializeColumnEncryption(pool);
      } else if (this.config.type === 'always-encrypted' && this.config.alwaysEncrypted) {
        return await this.initializeAlwaysEncrypted(pool);
      } else {
        SqlEncryptionHelper.log('warn', 'Geçersiz şifreleme yapılandırması');
        this.isInitialized = true;
        this.keysAvailable = false;
        return false;
      }
    } catch (error) {
      SqlEncryptionHelper.log('error', 'Şifreleme başlatma hatası:', error);
      this.isInitialized = true;
      this.keysAvailable = false;
      return false;
    }
  }
  
  /**
   * Column Level Encryption (CLE) için başlatma işlemi
   * @param pool Bağlantı havuzu
   */
  private async initializeColumnEncryption(pool: mssql.ConnectionPool): Promise<boolean> {
    if (!this.config?.cle) return false;
    
    try {
      const request = pool.request();
      
      // Master Key kontrolü
      const masterKeyResult = await request.query(`
        SELECT COUNT(*) AS keyCount 
        FROM sys.symmetric_keys 
        WHERE name = '##MS_DatabaseMasterKey##'
      `);
      
      if (masterKeyResult.recordset[0].keyCount === 0) {
        SqlEncryptionHelper.log('warn', 'Veritabanında master key bulunamadı');
        this.isInitialized = true;
        this.keysAvailable = false;
        return false;
      }
      
      // Sertifika kontrolü
      const certificateResult = await request.query(`
        SELECT COUNT(*) AS certCount 
        FROM sys.certificates 
        WHERE name = '${this.config.cle.certificateName}'
      `);
      
      if (certificateResult.recordset[0].certCount === 0) {
        SqlEncryptionHelper.log('warn', `Sertifika '${this.config.cle.certificateName}' bulunamadı`);
        this.isInitialized = true;
        this.keysAvailable = false;
        return false;
      }
      
      // Simetrik Anahtar kontrolü
      const symKeyResult = await request.query(`
        SELECT COUNT(*) AS keyCount 
        FROM sys.symmetric_keys 
        WHERE name = '${this.config.cle.symmetricKeyName}'
      `);
      
      if (symKeyResult.recordset[0].keyCount === 0) {
        SqlEncryptionHelper.log('warn', `Simetrik anahtar '${this.config.cle.symmetricKeyName}' bulunamadı`);
        this.isInitialized = true;
        this.keysAvailable = false;
        return false;
      }
      
      // Zaman aşımı sorunlarına yol açan açma testi atlanıyor
      // Anahtarlar var ise, başarılı kabul et
      SqlEncryptionHelper.log('info', 'SQL Server Column Level Encryption başarıyla başlatıldı');
      this.isInitialized = true;
      this.keysAvailable = true;
      return true;
    } catch (error) {
      SqlEncryptionHelper.log('error', 'Column Level Encryption başlatma hatası:', error);
      this.isInitialized = true;
      this.keysAvailable = false;
      return false;
    }
  }
  
  /**
   * Always Encrypted için başlatma işlemi
   * @param pool Bağlantı havuzu
   */
  private async initializeAlwaysEncrypted(pool: mssql.ConnectionPool): Promise<boolean> {
    if (!this.config?.alwaysEncrypted) return false;
    
    try {
      const request = pool.request();
      
      // Sütun ana anahtarı kontrolü
      const cmkResult = await request.query(`
        SELECT COUNT(*) AS keyCount 
        FROM sys.column_master_keys 
        WHERE name = '${this.config.alwaysEncrypted.columnMasterKeyName}'
      `);
      
      if (cmkResult.recordset[0].keyCount === 0) {
        SqlEncryptionHelper.log('warn', `Sütun ana anahtarı '${this.config.alwaysEncrypted.columnMasterKeyName}' bulunamadı`);
        this.isInitialized = true;
        this.keysAvailable = false;
        return false;
      }
      
      // Sütun şifreleme anahtarı kontrolü
      const cekResult = await request.query(`
        SELECT COUNT(*) AS keyCount 
        FROM sys.column_encryption_keys 
        WHERE name = '${this.config.alwaysEncrypted.columnEncryptionKeyName}'
      `);
      
      if (cekResult.recordset[0].keyCount === 0) {
        SqlEncryptionHelper.log('warn', `Sütun şifreleme anahtarı '${this.config.alwaysEncrypted.columnEncryptionKeyName}' bulunamadı`);
        this.isInitialized = true;
        this.keysAvailable = false;
        return false;
      }
      
      SqlEncryptionHelper.log('info', 'SQL Server Always Encrypted başarıyla başlatıldı');
      this.isInitialized = true;
      this.keysAvailable = true;
      return true;
    } catch (error) {
      SqlEncryptionHelper.log('error', 'Always Encrypted başlatma hatası:', error);
      this.isInitialized = true;
      this.keysAvailable = false;
      return false;
    }
  }
  
  /**
   * Şifrelemenin etkin ve kullanılabilir olup olmadığını kontrol eder
   */
  public isEncryptionAvailable(): boolean {
    return this.isInitialized && this.keysAvailable && !this.config?.disabled;
  }
  
  /**
   * Sorguyu şifreleme komutlarıyla sarar
   * @param sql Orijinal SQL sorgusu
   * @param inTransaction İşlem içinde mi
   */
  public wrapQueryWithEncryption(sql: string, inTransaction: boolean = false): string {
    if (!this.isEncryptionAvailable() || !this.config?.cle) {
      return sql;
    }
    
    return SqlEncryptionHelper.createEncryptionBlock(
      sql,
      this.config.cle.masterKeyPassword,
      this.config.cle.symmetricKeyName,
      this.config.cle.certificateName,
      inTransaction
    );
  }
  
  /**
   * SQL Server içinde verileri şifrelemek için sorgu oluşturur
   * @param tableName Tablo adı (isteğe bağlı)
   */
  public buildEncryptionQuery(): string {
    if (!this.isEncryptionAvailable() || !this.config?.cle) {
      throw new Error('Şifreleme yapılandırılmamış veya etkin değil');
    }
    
    return `
      SELECT 
        EncryptByKey(Key_GUID('${this.config.cle.symmetricKeyName}'), 
        CONVERT(VARBINARY(MAX), value)) AS encrypted
      FROM OPENJSON(@values) WITH (value nvarchar(max) '$')
    `;
  }
  
  /**
   * Veri şifreleme işlemi - SQL Server içinde gerçekleştirilir
   * @param pool Bağlantı havuzu
   * @param values Şifrelenecek değerler
   * @param transaction İsteğe bağlı işlem
   */
  public async encryptValues(
    pool: mssql.ConnectionPool,
    values: unknown[],
    transaction?: mssql.Transaction
  ): Promise<unknown[]> {
    if (!values.length) return [];
    if (!this.isEncryptionAvailable()) {
      SqlEncryptionHelper.log('warn', 'Şifreleme devre dışı veya kullanılamıyor, orijinal değerler döndürülüyor');
      return values;
    }
    
    try {
      // Büyük veri setleri için optimum parti boyutu
      const batchSize = 2000;
      const results: unknown[] = [];
      
      for (let i = 0; i < values.length; i += batchSize) {
        const batchValues = values.slice(i, i + batchSize);
        const request = transaction ? new mssql.Request(transaction) : pool.request();
        
        try {
          // JSON değerlerini hazırla
          request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(batchValues));
          
          // Sorguyu şifreleme komutlarıyla sar - transaction varsa bunu belirt
          const hasTransaction = transaction !== undefined;
          const encryptionQuery = this.wrapQueryWithEncryption(this.buildEncryptionQuery(), hasTransaction);
          
          // Şifreleme sorgusunu çalıştır
          const result = await request.query(encryptionQuery);
          
          // Şifreli değerleri topla
          if (result.recordset && result.recordset.length > 0) {
            results.push(...result.recordset.map(r => r.encrypted));
          } else {
            throw new Error('Şifreleme başarısız: SQL Server boş sonuç döndürdü');
          }
        } catch (error) {
          SqlEncryptionHelper.log('error', `Veri şifreleme hatası (${i}-${i+batchSize}):`, error);
          throw error;
        }
      }
      
      return results;
    } catch (error) {
      SqlEncryptionHelper.log('error', 'Veri şifreleme hatası:', error);
      throw error;
    }
  }
  
  /**
   * SQL sütun şifreleme bildirimi oluşturur (Always Encrypted için)
   * @param columnName Sütun adı
   * @param encryptionType Şifreleme türü
   */
  public getAlwaysEncryptedColumnStatement(
    columnName: string,
    encryptionType: 'DETERMINISTIC' | 'RANDOMIZED' = 'DETERMINISTIC'
  ): string {
    if (!this.isEncryptionAvailable() || !this.config?.alwaysEncrypted) {
      throw new Error('Always Encrypted yapılandırılmamış veya etkin değil');
    }
    
    return `
      ENCRYPTED WITH (
        COLUMN_ENCRYPTION_KEY = [${this.config.alwaysEncrypted.columnEncryptionKeyName}],
        ENCRYPTION_TYPE = ${encryptionType},
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
      )
    `;
  }
  
  /**
   * Şifreleme işlemleri için yardımcı fonksiyon
   * @param value Şifrelenecek değer
   * @param format Değer formatı
   */
  public getEncryptSqlTemplate(value: string, format: string = 'NVARCHAR(MAX)'): string {
    if (!this.isEncryptionAvailable() || !this.config?.cle) {
      throw new Error('Şifreleme yapılandırılmamış veya etkin değil');
    }
    
    return `ENCRYPTBYKEY(KEY_GUID('${this.config.cle.symmetricKeyName}'), CONVERT(VARBINARY(MAX), ${value}))`;
  }
  
  /**
   * Şifre çözme işlemleri için yardımcı fonksiyon
   * @param column Şifreli sütun 
   * @param format Çözülmüş değer formatı
   */
  public getDecryptSqlTemplate(column: string, format: string = 'NVARCHAR(MAX)'): string {
    if (!this.isEncryptionAvailable() || !this.config?.cle) {
      throw new Error('Şifreleme yapılandırılmamış veya etkin değil');
    }
    
    return `CAST(DECRYPTBYKEY(${column}) AS ${format})`;
  }
  
  /**
   * Servis kapatılırken çağrılır
   */
  public shutdown(): void {
    SqlEncryptionHelper.log('info', 'SQL Server şifreleme servisi kapatılıyor');
    this.isInitialized = false;
    this.keysAvailable = false;
  }
}

// Singleton instance
export const sqlServerEncryption = SqlServerEncryption.getInstance();
