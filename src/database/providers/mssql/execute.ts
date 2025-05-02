// src/database/providers/mssql/execute.ts
import { Row, ColumnType, EncryptionOptions, mssql } from '../../../types';
import { config } from '../../../config';
import { keyManagerService } from './key-manager';
import { mssqlLogger } from '../../../utils';

/**
 * Verileri toplu olarak şifreler
 * @param pool Veritabanı bağlantı havuzu
 * @param values Şifrelenecek değerler
 * @param transaction İsteğe bağlı işlem
 * @param connectionId Anahtar yönetici bağlantı ID'si
 * @returns Şifrelenmiş değerler dizisi
 */
export const bulkEncrypt = async (
    pool: mssql.ConnectionPool, 
    values: unknown[], 
    transaction?: mssql.Transaction,
    connectionId?: string
): Promise<unknown[]> => {
    if (!values.length) return [];
    
    // Aynı anahtar oturumunu yeniden kullanmak için bağlantı ID'sini sakla
    let keyConnId = connectionId;
    
    try {
        // Şifrelemeden önce AES anahtarının açık olduğundan emin ol
        keyConnId = await keyManagerService.manageKey(
            pool, 
            { aes: true, masterkey: true }, 
            transaction,
            keyConnId
        );
        
        // Simetrik anahtar yapılandırmasını kontrol et
        if (!config.database.symmetricKeyName) {
            throw new Error('Simetrik anahtar adı yapılandırılmamış');
        }
        
        // Bellek sorunlarını önlemek için küçük partiler halinde işle
        const batchSize = 500; // Bellek baskısını azaltmak için daha küçük parti boyutu
        const results: unknown[] = [];
        
        for (let i = 0; i < values.length; i += batchSize) {
            const batchValues = values.slice(i, i + batchSize);
            const request = transaction ? new mssql.Request(transaction) : new mssql.Request(pool);
            
            try {
                // Daha iyi güvenlik için parametreli sorgu kullan
                request.input('values', mssql.NVarChar(mssql.MAX), JSON.stringify(batchValues));
                
                const result = await request.query(`
                    SELECT 
                        EncryptByKey(Key_GUID('${config.database.symmetricKeyName}'), 
                        CONVERT(VARBINARY(MAX), value)) AS encrypted 
                    FROM OPENJSON(@values) WITH (value nvarchar(max) '$')
                `);
                
                // Parti sonuçlarını genel sonuçlara ekle
                if (result.recordset && result.recordset.length > 0) {
                    results.push(...result.recordset.map(r => r.encrypted));
                } else {
                    throw new Error('Şifreleme başarısız: Sonuç dönmedi');
                }
            } catch (error) {
                mssqlLogger.error(`${i}-${i+batchSize} partisinde şifreleme hatası:`, error);
                throw new Error(`Parti şifreleme başarısız: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        
        return results;
    } catch (error) {
        mssqlLogger.error('Toplu şifreleme hatası:', error);
        throw error;
    }
};

/**
 * Daha iyi hata işleme ve bellek yönetimi ile geliştirilmiş toplu işleme
 */
export const bulkProcess = async (
    pool: mssql.ConnectionPool,
    tableName: string,
    data: Row[],
    columns: ColumnType[],
    encryption?: EncryptionOptions,
    batchSize = 500, // Daha küçük varsayılan parti boyutu
    existingTransaction?: mssql.Transaction
): Promise<void> => {
    if (!data.length) return;

    const transaction = existingTransaction || new mssql.Transaction(pool);
    let needsTransactionManagement = !existingTransaction;
    let keyConnId: string | undefined;

    try {
        if (needsTransactionManagement) {
            await transaction.begin();
        }

        // Gerekirse şifreleme anahtarlarını yönet - bunu bir kez yap
        if (encryption?.open) {
            keyConnId = await keyManagerService.manageKey(
                pool, 
                encryption.open as any, 
                transaction
            );
        }

        // Şifrelenmesi gereken sütunları al
        const encryptedColumns = new Set(encryption?.data || []);
        
        // Daha iyi bellek verimliliği için verileri sütun bazında işle
        const processedData: unknown[][] = [];
        
        // Önce sütun yapılandırmasını doğrula
        // Sütunları ve tiplerini logla
        mssqlLogger.debug(`Toplu işlem için sütunlar: ${JSON.stringify(columns.map(([name, type]) => ({ name, type: type ? typeof type : 'undefined' })))}`);

        const validColumns = columns.filter(([name, type]) => {
            // Ad boş olmayan bir string olmalı
            if (typeof name !== 'string' || !name.trim()) {
                mssqlLogger.warn(`Boş veya string olmayan ada sahip geçersiz sütun atlanıyor`);
                return false;
            }
            
            // Tip kontrolünü daha esnek yap - null veya undefined olmamalı
            if (type === null || type === undefined) {
                mssqlLogger.warn(`"${name}" sütunu için geçersiz tip: ${type}`);
                return false;
            }
            
            return true;
        });
        
        // Daha detaylı hata mesajı
        if (validColumns.length === 0) {
            const columnInfo = columns.map(([name, type]) => 
                `${name}: ${type ? (typeof type === 'object' ? 'object' : String(type)) : 'undefined'}`
            ).join(', ');
            
            throw new Error(`Toplu işlem için geçerli sütun tanımlanmamış. Gelen sütunlar: [${columnInfo}]`);
        }
        
        for (let colIndex = 0; colIndex < validColumns.length; colIndex++) {
            const [colName] = validColumns[colIndex];
            
            try {
                // Bu sütun için tüm değerleri çıkar
                const colValues = data.map(row => {
                    // Tanımsız veya eksik değerleri işle
                    return row[colName] !== undefined ? row[colName] : null;
                });
                
                // Sütunu işle (gerekirse şifrele)
                if (encryptedColumns.has(colName)) {
                    processedData[colIndex] = await bulkEncrypt(
                        pool, 
                        colValues, 
                        transaction, 
                        keyConnId
                    );
                } else {
                    processedData[colIndex] = colValues;
                }
            } catch (error) {
                mssqlLogger.error(`"${colName}" sütununu işleme hatası:`, error);
                throw new Error(`"${colName}" sütunu işlenirken hata: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        // Toplu ekleme için tablo oluştur
        const table = new mssql.Table(tableName);
        
        // Tabloya sütunları ekle
        validColumns.forEach(([name, type, options]) => {
            if (typeof type === 'string') {
                mssqlLogger.warn(`"${name}" sütunu string tip içeriyor ve toplu işlemde atlanıyor`);
                return;
            }
            
            table.columns.add(name, type, { nullable: true, ...options });
        });

        // Daha küçük partilerde işle
        for (let i = 0; i < data.length; i += batchSize) {
            try {
                const batchEnd = Math.min(i + batchSize, data.length);
                
                // Önceki satırları temizle
                table.rows.length = 0;
                
                // Bu parti için satırları ekle
                for (let rowIndex = i; rowIndex < batchEnd; rowIndex++) {
                    const rowValues = validColumns.map((_, colIndex) => {
                        const value = processedData[colIndex][rowIndex - i];
                        return value !== undefined ? (value as any) : null;
                    });
                    
                    table.rows.add(...rowValues);
                }
                
                // Toplu işlemi gerçekleştir
                const request = new mssql.Request(transaction);
                await request.bulk(table);
            } catch (error) {
                mssqlLogger.error(`${i}-${i+batchSize} partisinde toplu ekleme hatası:`, error);
                throw new Error(`Parti için toplu ekleme başarısız: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (needsTransactionManagement) {
            await transaction.commit();
            
            // İşlemi biz oluşturduysak anahtarları temizle
            if (keyConnId) {
                keyManagerService.cleanupTransaction(pool, transaction, keyConnId);
            }
        }
    } catch (error) {
        // Biz oluşturduysak işlemi geri al
        if (needsTransactionManagement) {
            try {
                await transaction.rollback();
                
                // İşlemi biz oluşturduysak anahtarları temizle
                if (keyConnId) {
                    keyManagerService.cleanupTransaction(pool, transaction, keyConnId);
                }
            } catch (rollbackError) {
                mssqlLogger.error('İşlem geri alma sırasında hata:', rollbackError);
            }
        }
        
        throw error;
    }
};

/**
 * İyileştirilmiş şifreleme desteği ve hata işleme ile SQL sorgularını çalıştırır
 */
export const executeSql = async <T = any>(
    pool: mssql.ConnectionPool,
    input: {
        sql: string;
        parameters?: unknown[];
        bulk?: { columns?: ColumnType[]; batchSize?: number };
        encryption?: EncryptionOptions;
        transaction?: mssql.Transaction;
    }
): Promise<T[]> => {
    if (!pool) throw new Error('Veritabanı havuzu başlatılmamış');
    
    let keyConnId: string | undefined;

    try {
        // Şifreleme anahtarlarını aç (gerekirse)
        if (input.encryption?.open) {
            keyConnId = await keyManagerService.manageKey(
                pool, 
                input.encryption.open as any, 
                input.transaction
            );
        }

        // Normal sorgu çalıştırma
        if (!input.bulk) {
            const request = input.transaction ? new mssql.Request(input.transaction) : pool.request();

            // Parametre işleme
            if (input.parameters?.length) {
                input.parameters.forEach((param, idx) => {
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
                        mssqlLogger.error(`${idx} indeksli parametre ayarlama hatası:`, paramError);
                        throw new Error(`${idx} indeksli parametre hatası: ${paramError instanceof Error ? paramError.message : String(paramError)}`);
                    }
                });
            }
            
            // Sorguyu çalıştır
            const result = await Promise.race([
                request.query<T>(input.sql),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error('Sorgu yürütme 60 saniye sonra zaman aşımına uğradı')), 60000);
                })
            ]);
            
            // Veriyi çıkar ve döndür
            const data: any = (result?.recordsets?.length === 1 ? result.recordset : result.recordsets) || [];
            return data;
        }

        // Toplu işlemler
        if (input.bulk?.columns) {
            // SQL'den tablo adını çıkar
            let tableName: string;
            const sqlLower = input.sql.toLowerCase().trim();
            
            if (sqlLower.startsWith('insert into') || sqlLower.startsWith('update')) {
                // SQL'den tablo adını al
                tableName = input.sql.split(/\s+/)[2].replace(/[[\]"`']/g, '');
            } else {
                // SQL'in sadece tablo adı olduğunu varsay
                tableName = input.sql.trim().replace(/[[\]"`']/g, '');
            }
            
            await bulkProcess(
                pool, 
                tableName, 
                input.parameters as Row[], 
                input.bulk.columns, 
                input.encryption, 
                input.bulk.batchSize, 
                input.transaction
            );
        }

        return [];
    } catch (error) {
        mssqlLogger.error('SQL yürütme hatası:', error);
        throw error;
    } finally {
        // Her durumda anahtarları güvenli bir şekilde kapat
        if (keyConnId) {
            try {
                // Ana işlemde anahtarları kapat - sadece simetrik anahtarları kapat
                await keyManagerService.manageKey(
                    pool, 
                    { aes: false, masterkey: false }, // master key'i kapatma
                    input.transaction, 
                    keyConnId
                );
                
                // Performans için yüksek seviyeli debug loglama
                if (process.env.DEBUG_KEYS === 'true') {
                    mssqlLogger.debug(`${input.sql?.substring(0, 30)}... sorgusu için anahtarlar temizlendi`);
                }
            } catch (cleanupError) {
                // Hata durumunda sadece debug log - bu beklenen bir durum olabilir
                mssqlLogger.debug('Anahtarları temizleme sırasında beklenen hata:', cleanupError);
            }
        }
    }
};
