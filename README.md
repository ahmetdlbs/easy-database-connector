# Easy Database Connector

Performans odaklı, güvenli ve esnek bir veritabanı bağlantı servisi. MSSQL desteği, sayfalama, önbellek, şifreleme ve işlem yönetimiyle gelir.

## Özellikler

- 🔒 Hassas veriler için yerleşik şifreleme desteği
- 🚀 Optimal performans için bağlantı havuzu (connection pooling)
- 📄 Önbellekli sayfalama desteği
- 💾 Redis önbellekleme entegrasyonu
- 🔄 İşlem (transaction) desteği
- 🔌 Toplu işlemler (bulk operations)
- 📦 TypeScript desteği
- 🛡️ Tip güvenliği
- 🔧 Eşzamanlı işlem desteği ve paralelleştirilmiş güvenlik

## Kurulum

```bash
npm install easy-database-connector
```

## Hızlı Başlangıç

```typescript
import { query, execute, queryWithPagination, transaction } from 'easy-database-connector';

// Temel sorgu
const users = await query<User>({
    sql: 'SELECT * FROM users WHERE active = @p0',
    parameters: [true]
});

// Önbellekli sayfalama sorgusu
const pagedUsers = await queryWithPagination<User>({
    sql: 'SELECT * FROM users',
    parameters: [],
    page: 1,
    pageSize: 10,
    orderBy: 'name ASC',
    cache: {
        key: 'users:page1',
        ttl: 300 // 5 dakika
    }
});

// Şifrelenmiş veri
await execute({
    sql: 'INSERT INTO secure_data (data) VALUES (@p0)',
    parameters: ['sensitive information'],
    encryption: {
        open: { aes: true, masterkey: true },
        data: ['0']
    }
});

// İşlem (transaction) örneği
await transaction(async (trx) => {
    await execute({
        sql: 'INSERT INTO users (name) VALUES (@p0)',
        parameters: ['John'],
        transaction: trx
    });

    await execute({
        sql: 'INSERT INTO logs (action) VALUES (@p0)',
        parameters: ['user_created'],
        transaction: trx
    });
});
```

## Yapılandırma

`.env` dosyası oluşturun:

```env
# Veritabanı Yapılandırması
DB_TYPE=mssql
DB_HOST=localhost
DB_USER=your_user
DB_PASSWORD=your_password
DB_DATABASE=your_database
DB_PORT=1433
DB_ENCRYPT=true

# Şifrelenmiş Sütunlar İçin
MSSQL_SYNNETRIC_KEY_NAME=your_key_name
MSSQL_CERTIFICATE_NAME=your_cert_name
MASTER_KEY_PASSWORD=your_master_key_password

# Redis Yapılandırması
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
REDIS_TTL=3600
```

## API Referansı

### Sorgu Fonksiyonları

#### `query<T>(input: ExecuteInput): Promise<T[]>`
İsteğe bağlı önbellekleme ile SELECT sorguları çalıştırır.

```typescript
const users = await query<User>({
    sql: 'SELECT * FROM users',
    parameters: [],
    cache: {
        key: 'all-users',
        ttl: 3600
    }
});
```

#### `queryWithPagination<T>(input: ExecuteInput): Promise<QueryResult<T>>`
Toplam sayı ile sayfalanmış bir sorgu çalıştırır.

```typescript
const result = await queryWithPagination<User>({
    sql: 'SELECT * FROM users',
    page: 1,
    pageSize: 10,
    orderBy: 'created_at DESC'
});
```

#### `execute(input: ExecuteInput): Promise<unknown[]>`
INSERT, UPDATE, DELETE sorguları veya toplu işlemler çalıştırır.

```typescript
// Toplu ekleme
await execute({
    sql: 'INSERT INTO users',
    parameters: users,
    bulk: {
        columns: [
            ['name', mssql.NVarChar(100)],
            ['email', mssql.NVarChar(100)]
        ],
        batchSize: 1000
    }
});
```

#### `transaction<T>(callback: (trx: Transaction) => Promise<T>): Promise<T>`
Bir işlem içinde birden fazla sorgu çalıştırır.

```typescript
await transaction(async (trx) => {
    await execute({
        sql: 'DELETE FROM users WHERE id = @p0',
        parameters: [1],
        transaction: trx
    });
});
```

## Tipler

### ExecuteInput
```typescript
interface ExecuteOptions {
    sql: string;
    parameters?: SqlValue[];
    encryption?: {
        open: boolean | { aes?: boolean; masterkey?: boolean };
        data: string[];
    };
    bulk?: {
        columns: ColumnType[];
        batchSize?: number;
    };
    page?: number;
    pageSize?: number;
    orderBy?: string;
    cache?: {
        key: string;
        ttl?: number;
    };
    transaction?: mssql.Transaction;
}
```

### QueryResult
```typescript
interface QueryResult<T> {
    data: T[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}
```

## Paralel İşlemler ve Performans İyileştirmeleri

Bu kütüphanenin son sürümü, özellikle paralel işlemlerde ve AES şifreleme işlemlerinde performans ve güvenilirliği artırmak için önemli iyileştirmeler içermektedir:

1. **İyileştirilmiş Anahtar Yönetimi**: Eşzamanlı işlemler için mutex tabanlı güvenlik ve doğru anahtar izolasyonu
2. **Bağlantı Havuzu Optimizasyonu**: Güvenilir havuz yönetimi ve bağlantı ömrü kontrolü
3. **Hata İzleme ve Günlükleme**: Kapsamlı hata izleme ve tanılama yetenekleri
4. **Önbellek Yönetimi**: Redis bağlantı havuzu ve güvenilir önbellekleme
5. **Hafıza Yönetimi**: Toplu işlemlerde ve AES şifreleme işlemlerinde geliştirilmiş hafıza yönetimi

## En İyi Kullanım Örnekleri

1. Şifrelenmiş verileri işlerken daha küçük toplu işlem boyutları kullanın:
```typescript
await execute({
    sql: 'INSERT INTO secure_data',
    parameters: largeDataset,
    bulk: {
        columns: [
            ['data', mssql.NVarChar(500)],
        ],
        batchSize: 500  // Şifrelenmiş veriler için daha küçük batch boyutu
    },
    encryption: {
        open: { aes: true, masterkey: true },
        data: ['data']
    }
});
```

2. İşlemlerde bağlantı havuzunu verimli kullanmak için:
```typescript
// Uzun süreli büyük işlemler yerine daha küçük, bağımsız işlemler tercih edin
const batchSize = 1000;
for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await transaction(async (trx) => {
        for (const item of batch) {
            await execute({
                sql: 'INSERT INTO items (name) VALUES (@p0)',
                parameters: [item.name],
                transaction: trx
            });
        }
    });
}
```

## Katkıda Bulunma

Katkılarınızı bekliyoruz! Lütfen bir Pull Request göndermekten çekinmeyin.

## Lisans

MIT Lisansı
