import { mssql } from '../../../types';
import { mssqlLogger } from '../../../utils';

/**
 * SQL Server şifreleme modülü yardımcı fonksiyonlar
 * Bu modül prodüksiyon ortamında minimum loglama yapacak şekilde ayarlanmıştır.
 * @private
 */
const SqlEncryptionHelper = {
  /**
   * Debug modunda mı?
   */
  isDebugMode: process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true',
  
  /**
   * Log seviyesine göre loglama yapar, prod modunda sadece hataları loglar
   * @param level Log seviyesi
   * @param message Mesaj
   * @param data Ek veri
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
    // Prod modunda sadece hata ve uyarıları logla
    if (level === 'error') {
      mssqlLogger.error(message, data);
    } else if (level === 'warn') {
      mssqlLogger.warn(message, data);
    } else if (this.isDebugMode) {
      if (level === 'info') {
        mssqlLogger.info(message, data);
      } else if (level === 'debug') {
        mssqlLogger.debug(message, data);
      }
    }
  },
  
  /**
   * Şifreleme TRY-CATCH bloğu oluşturur
   * Farklı SQL Server sürümlerinde çalışması için RAISERROR kullanır
   * @param sql Orijinal SQL
   * @param masterKeyPassword Master Key şifresi
   * @param symmetricKeyName Simetrik anahtar adı
   * @param certificateName Sertifika adı
   */
  createEncryptionBlock(
    sql: string, 
    masterKeyPassword: string, 
    symmetricKeyName: string, 
    certificateName: string,
    inTransaction: boolean = false
  ): string {
    return `
      BEGIN TRY
        -- Master key'i açma girişimi
        IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
        BEGIN
          OPEN MASTER KEY DECRYPTION BY PASSWORD = '${masterKeyPassword}';
        END

        -- Simetrik anahtarı açma girişimi
        IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${symmetricKeyName}')
        BEGIN
          OPEN SYMMETRIC KEY ${symmetricKeyName} 
          DECRYPTION BY CERTIFICATE ${certificateName};
        END

        -- Ana sorgu
        ${sql}

        -- Transaction içinde değilse anahtarları kapat
        ${!inTransaction ? `
        IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${symmetricKeyName}')
        BEGIN
          CLOSE SYMMETRIC KEY ${symmetricKeyName};
        END` : '-- Transaction içinde olduğu için anahtarlar açık bırakılıyor'}
      END TRY
      BEGIN CATCH
        -- Hata durumunda temizlik
        IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${symmetricKeyName}')
        BEGIN
          CLOSE SYMMETRIC KEY ${symmetricKeyName};
        END
        
        -- RAISERROR kullanımı (SQL Server 2008 ve öncesi için uyumlu)
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
      END CATCH
    `;
  }
};

export default SqlEncryptionHelper;