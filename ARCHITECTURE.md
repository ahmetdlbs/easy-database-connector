# Easy Database Connector - Mimari Dokümantasyonu

Bu doküman, Easy Database Connector projesinin mimari yapısını ve dosya organizasyonunu açıklar.

## Proje Yapısı

```
src/
├── common/          # Ortak yardımcı fonksiyonlar ve tipler
│   ├── errors.ts    # Hata tipleri ve işleme
│   └── validation.ts # Doğrulama yardımcıları
│
├── config/          # Yapılandırma yönetimi
│   └── config.ts    # Uygulama yapılandırması
│
├── database/        # Veritabanı işlemleri
│   ├── index.ts     # Ana veritabanı API'si
│   └── providers/   # Veritabanı sağlayıcıları
│       ├── index.ts # Sağlayıcı fabrikası
│       └── mssql/   # MSSQL sağlayıcısı
│           ├── execute.ts    # Sorgu yürütme
│           ├── index.ts      # MSSQL sağlayıcı API'si
│           ├── key-manager.ts # Şifreleme anahtar yönetimi
│           └── pool-manager.ts # Bağlantı havuzu yönetimi
│
├── services/        # Harici servisler
│   └── redis.service.ts # Redis önbellek servisi
│
├── types/           # Tip tanımlamaları
│   ├── config.types.ts      # Yapılandırma tipleri
│   ├── database.types.ts    # Veritabanı tipleri
│   └── query.types.ts       # Sorgu tipleri
│
├── utils/           # Yardımcı araçlar
│   ├── async-mutex.ts       # Asenkron mutex
│   └── logger.ts            # Loglama aracı
│
└── index.ts         # Paket giriş noktası
```

## Mimari Katmanlar

Bu proje şu mimari katmanlardan oluşur:

### 1. Dış API Katmanı (Public API)
- **Tanım**: Kütüphanenin diğer uygulamalar tarafından kullanılan genel arayüzü
- **Dosya**: `src/index.ts`
- **Sorumluluklar**: Tüm genel fonksiyonları ve tipleri dışa aktarma

### 2. Veritabanı Katmanı (Database Layer)
- **Tanım**: Veritabanı işlemlerinin soyutlanması
- **Dosyalar**: `src/database/index.ts`
- **Sorumluluklar**: 
  - Sorgu, çalıştırma, işlem ve sayfalama işlemleri
  - Önbellek entegrasyonu
  - Hata işleme
  - Doğru sağlayıcıların seçilmesi

### 3. Sağlayıcı Katmanı (Provider Layer)
- **Tanım**: Belirli veritabanları için gerçek implementasyonlar
- **Dosyalar**: `src/database/providers/{mssql,mysql,...}/index.ts`
- **Sorumluluklar**:
  - Veritabanı bağlantılarını yönetme
  - SQL sorgularını çalıştırma
  - İşlemleri yönetme
  - Sayfalama ve toplu işlemleri gerçekleştirme

### 4. Servis Katmanı (Service Layer)
- **Tanım**: Harici servislerle etkileşim
- **Dosyalar**: `src/services/*.ts`
- **Sorumluluklar**:
  - Redis önbellek yönetimi
  - (Gelecekte) Diğer harici servisler

### 5. Ortak Altyapı Katmanı (Common Infrastructure)
- **Tanım**: Yardımcı araçlar ve ortak işlevsellik
- **Dosyalar**: `src/utils/*.ts`, `src/common/*.ts`
- **Sorumluluklar**:
  - Loglama
  - Hata işleme
  - Doğrulama
  - Eşzamanlılık araçları (mutex vb.)

## Anahtar Bileşenler

### Veritabanı Modülü
Veritabanı modülü, kütüphanenin çekirdeğidir. Veritabanı işlemleri için tutarlı bir API sağlar ve tüm veritabanı sağlayıcılarıyla çalışabilir.

### MSSQL Sağlayıcısı
Bu bileşen, Microsoft SQL Server ile etkileşim için gereken tüm işlevleri içerir:
- **PoolManager**: Bağlantı havuzunu yönetir
- **KeyManager**: SQL Server şifreleme anahtarlarını yönetir
- **Execute**: SQL sorgularını çalıştırır ve bulk işlemlerini destekler

### Redis Hizmeti
Önbellek işlemlerini gerçekleştirir ve ana veritabanı yükünü azaltır.

### Konfigürasyon Modülü
.env dosyasını kullanarak uygulama yapılandırmasını yönetir.

## Tasarım Desenleri

Bu projede uygulanan tasarım desenleri:

1. **Singleton**: KeyManager, PoolManager ve RedisService için kullanılır
2. **Factory**: Veritabanı sağlayıcılarını oluşturmak için kullanılır
3. **Facade**: Veritabanı modülü, daha düşük seviyeli karmaşıklığı saklamak için kullanılır
4. **Strategy**: Farklı veritabanı sağlayıcıları için kullanılır
5. **Adapter**: Farklı veritabanı API'lerini ortak bir arayüze uyarlamak için kullanılır

## Eşzamanlılık ve Performans

Bu kütüphane, aşağıdaki şekillerde eşzamanlılığı ve performansı optimize eder:

1. **Bağlantı Havuzu**: Veritabanı bağlantılarının verimli kullanımı
2. **Mutex İmplementasyonu**: Kritik bölümler için güvenli eşzamanlılık
3. **Toplu İşlemler**: Daha iyi bellek ve ağ verimliliği için batch işleme
4. **Önbellekleme**: Sık kullanılan verileri Redis'te önbellekleme
5. **Sayfalama**: Büyük veri kümelerinin verimli işlenmesi

## Hata İşleme ve Güvenlik

1. **Yapılandırılmış Hatalar**: Tüm hatalar için tutarlı bir yapı
2. **İşlemler**: Atomik veritabanı işlemleri için işlem desteği
3. **Şifreleme**: SQL Server tabanlı veri şifreleme
4. **Parametreli Sorgular**: SQL enjeksiyon saldırılarına karşı koruma

## Genişletilebilirlik

Bu mimari, yeni özellikler ve sağlayıcılar ekleyerek kolayca genişletilebilir:

1. **Yeni Veritabanı Sağlayıcıları**: DatabaseProvider arayüzünü uygulayarak 
2. **Yeni Önbellek Mekanizmaları**: Redis servisi yerine başka bir implementasyon kullanılabilir
3. **Ek Özellikler**: Veritabanı katmanında yeni işlevler eklenebilir
