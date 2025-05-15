// src/database/providers/mssql/execute.ts
import { Row, ColumnType, EncryptionOptions, mssql, SqlValue } from '../../../types';
import { config } from '../../../config';
import { sqlServerEncryption } from './encryption';
import { mssqlLogger } from '../../../utils';

/**
 * SQL sorgusu çalıştırmak için profesyonel yardımcı sınıf
 */
export class SqlExecutor {
  /**
   * Verileri toplu olarak şifreler (SQL Server içinde)
   * @param pool Veritabanı bağlantı havuzu
   * @param values Şifrelenecek değerler
   * @param transaction İsteğe bağlı işlem
   */
  public static async encryptValues(
    pool: mssql.ConnectionPool,
    values: unknown[],
    transaction?: mssql.Transaction
  ): Promise<unknown[]> {
    if (!values || !values.length) return [];
    
    // Şifreleme servisini başlat ve şifrele
    await sqlServerEncryption.initialize(pool);
    return sqlServerEncryption.encryptValues(pool, values, transaction);
  }
  
  /**
   * Toplu ekleme işlemi için verileri hazırlar ve işlemi gerçekleştirir
   * @param pool Veritabanı bağlantı havuzu 
   * @param tableName Tablo adı
   * @param data Eklenecek veriler
   * @param columns Tablo sütunları ve tipleri
   * @param encryption Şifreleme seçenekleri
   * @param batchSize Parti boyutu
   * @param existingTransaction Mevcut işlem
   */
  public static async bulkInsert(
    pool: mssql.ConnectionPool,
    tableName: string,
    data: Row[],
    columns: ColumnType[],
    encryption?: EncryptionOptions,
    batchSize = 2000,
    existingTransaction?: mssql.Transaction
  ): Promise<void> {
    if (!data || !data.length) return;
    
    // Şifreleme servisini başlat
    await sqlServerEncryption.initialize(pool);
    
    // İşlem yönetimi
    const transaction = existingTransaction || await pool.transaction();
    let needsTransactionManagement = !existingTransaction;
    
    try {
      if (needsTransactionManagement) {
        await transaction.begin();
      }
      
      // Şifrelenecek sütunları belirle
      const encryptedColumns = new Set(encryption?.data || []);
      const encryptionEnabled = sqlServerEncryption.isEncryptionAvailable() && encryption?.open;
      
      // Geçerli sütunları filtrele
      const validColumns = columns.filter(([name, type]) => {
        return typeof name === 'string' && name.trim() && type != null;
      });
      
      if (!validColumns.length) {
        throw new Error('Toplu işlem için geçerli sütun bulunamadı');
      }
      
      // Her sütun için veriyi hazırla (gerekirse şifrele)
      const processedData: unknown[][] = Array(validColumns.length).fill(0).map(() => []);
      
      for (let colIndex = 0; colIndex < validColumns.length; colIndex++) {
        const [colName] = validColumns[colIndex];
        
        // Bu sütun için tüm değerleri topla
        const colValues = data.map(row => row[colName] !== undefined ? row[colName] : null);
        
        // Sütun şifrelenecek mi?
        if (encryptionEnabled && encryptedColumns.has(colName)) {
          try {
            // SQL tarafında şifrele
            processedData[colIndex] = await SqlExecutor.encryptValues(pool, colValues, transaction);
          } catch (error) {
            mssqlLogger.error(`Sütun şifreleme hatası (${colName}):`, error);
            throw error;
          }
        } else {
          processedData[colIndex] = colValues;
        }
      }
      
      // SQL Server bulk insert için tablo oluştur
      const table = new mssql.Table(tableName);
      validColumns.forEach(([name, type, options]) => {
        // ISqlType tipine dönüştür
        const sqlType = typeof type === 'string' ? 
          mssql.TYPES.NVarChar : type;
        
        table.columns.add(name, sqlType, { nullable: true, ...(options || {}) });
      });
      
      // Verileri partiler halinde ekle
      for (let i = 0; i < data.length; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, data.length);
        
        // Tablo satırlarını temizle
        table.rows.length = 0;
        
        // Bu parti için satırları ekle
        for (let rowIndex = i; rowIndex < batchEnd; rowIndex++) {
          // mssql.Table veri tipi uyumluluğu için dönüşüm
          const rowValues: any[] = validColumns.map((_, colIndex) => {
            const value = processedData[colIndex][rowIndex - i];
            
            // null değerler için kontrol
            if (value === null || value === undefined) {
              return null;
            }
            
            // Nesne kontrolü ve stringification
            if (typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer)) {
              return JSON.stringify(value);
            }
            
            return value;
          });
          
          // Satırı ekle
          table.rows.add(...rowValues);
        }
        
        // Toplu ekleme yap
        const request = new mssql.Request(transaction);
        await request.bulk(table);
      }
      
      // İşlemi onaylama
      if (needsTransactionManagement) {
        await transaction.commit();
      }
    } catch (error) {
      // Hata durumunda geri alma
      if (needsTransactionManagement && transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackError) {
          mssqlLogger.error('İşlem geri alma hatası:', rollbackError);
        }
      }
      
      mssqlLogger.error('Toplu ekleme hatası:', error);
      throw error;
    }
  }
  
  /**
   * SQL sorgularını şifreleme destekli olarak çalıştırır
   * @param pool Veritabanı bağlantı havuzu
   * @param options Sorgu seçenekleri 
   */
  public static async executeQuery<T = any>(
    pool: mssql.ConnectionPool,
    options: {
      sql: string;
      parameters?: unknown[];
      bulk?: { 
        columns?: ColumnType[]; 
        batchSize?: number;
      };
      encryption?: EncryptionOptions;
      transaction?: mssql.Transaction;
      timeout?: number;
    }
  ): Promise<T[]> {
    if (!pool) throw new Error('Veritabanı bağlantısı sağlanmadı');
    
    // Şifreleme servisini başlat
    await sqlServerEncryption.initialize(pool);
    
    // Toplu işlem mi?
    if (options.bulk?.columns && options.parameters && Array.isArray(options.parameters)) {
      // Tablo adını belirle
      let tableName: string;
      const sqlLower = options.sql.toLowerCase().trim();
      
      if (sqlLower.startsWith('insert into') || sqlLower.startsWith('update')) {
        // SQL'den tablo adını al
        tableName = options.sql.split(/\s+/)[2].replace(/[[\]"`']/g, '');
      } else {
        // SQL'in kendisi tablo adı
        tableName = options.sql.trim().replace(/[[\]"`']/g, '');
      }
      
      await SqlExecutor.bulkInsert(
        pool,
        tableName,
        options.parameters as Row[],
        options.bulk.columns,
        options.encryption,
        options.bulk.batchSize,
        options.transaction
      );
      
      return [] as T[];
    }
    
    // Normal sorgu çalıştırma
    try {
      const request = options.transaction ? 
        new mssql.Request(options.transaction) : 
        pool.request();
      
      // Zaman aşımı ayarla (eğer mssql.Request'te timeout özelliği varsa)
      if (options.timeout && 'timeout' in request) {
        (request as any).timeout = options.timeout;
      }
      
      // Parametreleri ekle
      if (options.parameters?.length) {
        options.parameters.forEach((param, idx) => {
          try {
            if (param === null || param === undefined) {
              request.input(`p${idx}`, null);
            } else if (param instanceof Date) {
              request.input(`p${idx}`, mssql.DateTime, param);
            } else if (Buffer.isBuffer(param)) {
              request.input(`p${idx}`, mssql.VarBinary, param);
            } else {
              request.input(`p${idx}`, param);
            }
          } catch (paramError) {
            mssqlLogger.error(`Parametre hatası (${idx}):`, paramError);
            throw new Error(`Parametre hatası: ${paramError instanceof Error ? paramError.message : String(paramError)}`);
          }
        });
      }
      
      // Şifreleme gerekiyorsa sorguyu sar
      let finalSql = options.sql;
      const encryptionEnabled = sqlServerEncryption.isEncryptionAvailable() && options.encryption?.open;
      
      if (encryptionEnabled) {
        // Transaction varsa bunu belirt - bu işlem içindeyse anahtarları kapatmamak için
        const inTransaction = options.transaction !== undefined;
        finalSql = sqlServerEncryption.wrapQueryWithEncryption(options.sql, inTransaction);
      }
      
      // Sorguyu çalıştır (timeout korumalı)
      const result = await Promise.race([
        request.query<T>(finalSql),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Sorgu zaman aşımı (60s)')), 
            options.timeout || 60000
          );
        })
      ]);
      
      // Sonucu döndür ve tipe dönüştür
      let data: T[];
      
      if (result.recordsets && result.recordsets.length === 1) {
        data = result.recordset as unknown as T[];
      } else if (result.recordsets && result.recordsets.length > 1) {
        data = result.recordsets as unknown as T[];
      } else {
        data = [] as T[];
      }
      
      return data;
    } catch (error) {
      mssqlLogger.error('Sorgu çalıştırma hatası:', error);
      throw error;
    }
  }
}

/**
 * Basitleştirme için eski API ile uyumlu fonksiyon
 */
export async function executeSql<T = any>(
  pool: mssql.ConnectionPool,
  options: {
    sql: string;
    parameters?: unknown[];
    bulk?: { 
      columns?: ColumnType[]; 
      batchSize?: number;
    };
    encryption?: EncryptionOptions;
    transaction?: mssql.Transaction;
  }
): Promise<T[]> {
  return SqlExecutor.executeQuery<T>(pool, options);
}
