// src/database/providers/mssql/index.ts
import * as mssql from 'mssql';
import { QueryOptions, ExecuteOptions, PaginationOptions, QueryWithPaginationOptions } from '../../../types';
import { DatabaseProvider, PaginationResult } from '../../../types';
import { config } from '../../../config';
import { executeSql } from './execute';
import { poolManager } from './pool-manager';
import { sqlServerEncryption } from './encryption';
import { mssqlLogger } from '../../../utils';

/**
 * SQL Server veritabanı sağlayıcısı
 * Bu sınıf, SQL Server ile etkileşim için yüksek performanslı ve güvenli bir arayüz sağlar.
 */
export class MSSQLProvider implements DatabaseProvider {
  /**
   * Bağlantı havuzunu alır veya oluşturur
   * @returns SQL Server bağlantı havuzu
   */
  private async getConnection(): Promise<mssql.ConnectionPool> {
    try {
      // Havuz al veya oluştur
      const pool = await poolManager.getPool();
      
      // Şifreleme servisini başlat
      await sqlServerEncryption.configureFromDatabaseConfig(config.database);
      await sqlServerEncryption.initialize(pool);
      
      return pool;
    } catch (error) {
      mssqlLogger.error('Veritabanı bağlantısı hatası:', error);
      throw error;
    }
  }
  
  /**
   * SQL sorgusu çalıştırır ve sonuçları döndürür
   * @param options Sorgu seçenekleri
   * @returns Sorgu sonuçları
   */
  public async query<T>(options: QueryOptions): Promise<T[]> {
    try {
      const pool = await this.getConnection();
      
      return await executeSql<T>(pool, {
        sql: options.sql,
        parameters: options.parameters,
        encryption: options.encryption,
        transaction: options.transaction
      });
    } catch (error) {
      mssqlLogger.error('Sorgu hatası:', error);
      throw error;
    }
  }
  
  /**
   * SQL komutu çalıştırır (insert, update, delete vs.)
   * @param options Execute seçenekleri
   * @returns Etkilenen satır sayısı veya dönen sonuçlar
   */
  public async execute(options: ExecuteOptions): Promise<unknown[]> {
    try {
      const pool = await this.getConnection();
      
      return await executeSql(pool, {
        sql: options.sql,
        parameters: options.parameters,
        bulk: options.bulk,
        encryption: options.encryption,
        transaction: options.transaction
      });
    } catch (error) {
      mssqlLogger.error('Execute hatası:', error);
      throw error;
    }
  }
  
  /**
   * Sayfalama destekli SQL sorgusu çalıştırır
   * @param options Sayfalama sorgu seçenekleri
   * @returns Sayfalama sonuçları (veriler ve meta bilgiler)
   */
  public async queryWithPagination<T>(options: QueryWithPaginationOptions): Promise<PaginationResult<T>> {
    try {
      const pool = await this.getConnection();
      
      // Sayfalama değerlerini ayarla
      const page = Number(options.page) || 1;
      const pageSize = options.pageSize || 20;
      const orderBy = options.orderBy || 'id';
      
      // OFFSET-FETCH NEXT kullanarak sayfalama uygula
      const offset = (page - 1) * pageSize;
      
      // Toplam kayıt sayısını almak için COUNT sorgusu
      const countQuery = `
        SELECT COUNT(*) AS totalCount 
        FROM (${options.sql}) AS CountSubquery
      `;
      
      // Ana veri sorgusu (sayfalama ile)
      const dataQuery = `
        SELECT * FROM (${options.sql}) AS PagedQuery
        ORDER BY ${orderBy}
        OFFSET ${offset} ROWS
        FETCH NEXT ${pageSize} ROWS ONLY
      `;
      
      // İki sorguyu paralel çalıştır
      const [countResult, dataResult] = await Promise.all([
        executeSql<{ totalCount: number }>(pool, {
          sql: countQuery,
          parameters: options.parameters,
          encryption: options.encryption,
          transaction: options.transaction
        }),
        executeSql<T>(pool, {
          sql: dataQuery,
          parameters: options.parameters,
          encryption: options.encryption,
          transaction: options.transaction
        })
      ]);
      
      // Toplam sayfa sayısını hesapla
      const totalCount = countResult[0]?.totalCount || 0;
      const pageCount = Math.ceil(totalCount / pageSize);
      
      // Sayfalama sonucunu oluştur
      return {
        detail: dataResult,
        totalCount,
        pageCount,
        page: page.toString(),
        pageSize
      };
    } catch (error) {
      mssqlLogger.error('Sayfalama sorgusu hatası:', error);
      throw error;
    }
  }
  
  /**
   * İşlem (transaction) içinde kodları çalıştırır
   * @param callback İşlem içinde çalıştırılacak fonksiyon
   * @returns İşlem sonucu
   */
  public async transaction<T>(callback: (transaction: mssql.Transaction) => Promise<T>): Promise<T> {
    const pool = await this.getConnection();
    const transaction = new mssql.Transaction(pool);
    
    try {
      // İşlemi başlat
      await transaction.begin();
      
      // Callback fonksiyonu çalıştır
      const result = await callback(transaction);
      
      // İşlemi onayla
      await transaction.commit();
      
      return result;
    } catch (error) {
      // Hata durumunda işlemi geri al
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        mssqlLogger.error('İşlem geri alma hatası:', rollbackError);
      }
      
      mssqlLogger.error('İşlem hatası:', error);
      throw error;
    }
  }
  
  /**
   * Veritabanı bağlantısını kapatır
   */
  public async close(): Promise<void> {
    try {
      // Şifreleme servisini kapat
      sqlServerEncryption.shutdown();
      
      // Havuzu kapat
      await poolManager.shutdown();
      
      mssqlLogger.info('Veritabanı bağlantısı başarıyla kapatıldı');
    } catch (error) {
      mssqlLogger.error('Veritabanı kapatma hatası:', error);
      throw error;
    }
  }
  
  /**
   * Veritabanında şifreleme anahtarlarını kurar (veritabanı ilk kurulumunda)
   * @param masterKeyPassword Ana anahtar şifresi
   * @param certificateName Sertifika adı
   * @param symmetricKeyName Simetrik anahtar adı
   * @returns Kurulum sonucu
   */
  public async setupEncryptionKeys(
    masterKeyPassword: string,
    certificateName: string,
    symmetricKeyName: string
  ): Promise<boolean> {
    try {
      const pool = await this.getConnection();
      const request = pool.request();
      
      // Ana anahtar var mı kontrol et
      const masterKeyCheck = await request.query(`
        SELECT COUNT(*) AS keyCount 
        FROM sys.symmetric_keys 
        WHERE name = '##MS_DatabaseMasterKey##'
      `);
      
      const masterKeyExists = masterKeyCheck.recordset[0].keyCount > 0;
      
      // Ana anahtar yoksa oluştur
      if (!masterKeyExists) {
        mssqlLogger.info('Veritabanında master key oluşturuluyor...');
        await request.query(`
          CREATE MASTER KEY ENCRYPTION BY PASSWORD = '${masterKeyPassword}'
        `);
      }
      
      // Sertifika var mı kontrol et
      const certCheck = await request.query(`
        SELECT COUNT(*) AS certCount 
        FROM sys.certificates 
        WHERE name = '${certificateName}'
      `);
      
      const certExists = certCheck.recordset[0].certCount > 0;
      
      // Sertifika yoksa oluştur
      if (!certExists) {
        mssqlLogger.info(`'${certificateName}' sertifikası oluşturuluyor...`);
        await request.query(`
          CREATE CERTIFICATE ${certificateName}
          WITH SUBJECT = 'SQL Server Encryption Certificate'
        `);
      }
      
      // Simetrik anahtar var mı kontrol et
      const symKeyCheck = await request.query(`
        SELECT COUNT(*) AS keyCount 
        FROM sys.symmetric_keys 
        WHERE name = '${symmetricKeyName}'
      `);
      
      const symKeyExists = symKeyCheck.recordset[0].keyCount > 0;
      
      // Simetrik anahtar yoksa oluştur
      if (!symKeyExists) {
        mssqlLogger.info(`'${symmetricKeyName}' simetrik anahtarı oluşturuluyor...`);
        await request.query(`
          CREATE SYMMETRIC KEY ${symmetricKeyName}
          WITH ALGORITHM = AES_256
          ENCRYPTION BY CERTIFICATE ${certificateName}
        `);
      }
      
      mssqlLogger.info('Şifreleme anahtarları başarıyla kuruldu');
      return true;
    } catch (error) {
      mssqlLogger.error('Şifreleme anahtarları kurulum hatası:', error);
      throw error;
    }
  }
}

// MSSQL sağlayıcısı örneği
export const mssqlProvider = new MSSQLProvider();
