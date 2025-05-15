import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { redisLogger } from '../utils';

/**
 * Redis önbellek servisi
 */
class RedisService {
    private static instance: RedisService;
    private client: RedisClientType | null = null;
    private connectionPromise: Promise<RedisClientType> | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;
    
    // Singleton pattern için private constructor
    private constructor() {
        // Kapatma işleyicilerini kaydet
        process.once('SIGINT', () => this.cleanup('SIGINT'));
        process.once('SIGTERM', () => this.cleanup('SIGTERM'));
    }
    
    /**
     * Singleton RedisService örneği döndürür
     */
    public static getInstance(): RedisService {
        if (!RedisService.instance) {
            RedisService.instance = new RedisService();
        }
        return RedisService.instance;
    }
    
    /**
     * Redis bağlantısı oluşturur veya mevcut bağlantıyı döndürür
     */
    public async getConnection(): Promise<RedisClientType> {
        // Kapatma sürecindeyse, yeni bağlantı oluşturma
        if (this.isShuttingDown) {
            throw new Error('Redis servisi kapanıyor');
        }
        
        // Bağlantı oluşturma sürecindeyse, mevcut promise'i döndür
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        
        // Açık bağlantı varsa döndür
        if (this.client?.isOpen) {
            return this.client;
        }
        
        // Yeni bağlantı oluştur
        this.connectionPromise = (async () => {
            try {
                if (!config.redis.enabled) {
                    throw new Error('Redis yapılandırmada etkin değil');
                }
                
                if (!this.client || !this.client.isOpen) {
                    // Bağlantı girişimini logla
                    redisLogger.info(`Redis bağlantısı kuruluyor: ${config.redis.host}:${config.redis.port}`);
                    
                    this.client = createClient({
                        socket: {
                            host: config.redis.host,
                            port: config.redis.port,
                            connectTimeout: 20000,
                            reconnectStrategy: (retries) => {
                                // Özel exponential backoff
                                if (retries > this.maxReconnectAttempts) {
                                    redisLogger.error(`Redis yeniden bağlantı limiti aşıldı (${this.maxReconnectAttempts})`);
                                    return new Error('Redis yeniden bağlantı limiti aşıldı');
                                }
                                const delay = Math.min(Math.pow(2, retries) * 1000, 30000);
                                redisLogger.info(`Redis yeniden bağlantı denemesi ${retries}, ${delay}ms sonra`);
                                return delay;
                            },
                            keepAlive: 30000
                        },
                        password: config.redis.password,
                        commandsQueueMaxLength: 5000, // Kuyruktaki komutlar için makul limit
                    });

                    // Hata işleyici
                    this.client.on('error', (err) => {
                        redisLogger.error('Redis Hatası:', err);
                        
                        // Ölümcül hatalarda bağlantı promise'ini sıfırla
                        if (err.message.includes('ECONNREFUSED') || 
                            err.message.includes('Connection timeout')) {
                            this.connectionPromise = null;
                        }
                    });
                    
                    // Yeniden bağlantı işleyici
                    this.client.on('reconnecting', () => {
                        this.reconnectAttempts++;
                        redisLogger.info(`Redis yeniden bağlanıyor (deneme ${this.reconnectAttempts})`);
                    });
                    
                    // Bağlantı işleyici
                    this.client.on('connect', () => {
                        redisLogger.info('Redis bağlantısı kuruldu');
                        this.reconnectAttempts = 0;
                    });
                    
                    // Redis'e bağlan
                    await this.client.connect();
                }
                
                return this.client;
            } catch (err) {
                // Bağlantı promise'ini sıfırla
                this.connectionPromise = null;
                
                redisLogger.error('Redis bağlantı hatası:', err);
                
                // Hatada client'ı temizle
                if (this.client) {
                    try {
                        await this.client.quit().catch(e => redisLogger.error('Redis client kapatma hatası:', e));
                    } catch (quitErr) {
                        redisLogger.error('Redis client kapatma hatası:', quitErr);
                    }
                    this.client = null;
                }
                
                throw err;
            }
        })();

        return this.connectionPromise;
    }
    
    /**
     * Redis bağlantısını temizler
     */
    public async cleanup(reason?: string): Promise<void> {
        if (this.isShuttingDown) {
            return; // Zaten temizleniyor
        }
        
        this.isShuttingDown = true;
        redisLogger.info(`Redis bağlantısı kapatılıyor${reason ? ` (${reason})` : ''}`);
        
        // Yeniden bağlantı zamanlayıcısını iptal et
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        // Client'ı temizle
        if (this.client?.isOpen) {
            try {
                await this.client.quit();
                redisLogger.info('Redis bağlantısı başarıyla kapatıldı');
            } catch (err) {
                redisLogger.error('Redis bağlantısı kapatma hatası:', err);
            }
        }
        
        this.client = null;
        this.connectionPromise = null;
    }
    
    /**
     * Redis'ten değer alır
     * @param key Anahtar
     * @returns Değer veya null
     */
    public async get<T>(key: string): Promise<T | null> {
        if (!config.redis.enabled) {
            return null;
        }
        
        try {
            const redis = await this.getConnection();
            const data = await redis.get(key);
            
            // null/undefined kontrolü
            if (data === null || data === undefined) {
                return null;
            }
            
            // JSON parse
            try {
                return JSON.parse(data);
            } catch (parseError) {
                redisLogger.error(`Redis ayrıştırma hatası - Anahtar: "${key}":`, parseError);
                return null;
            }
        } catch (err) {
            redisLogger.error(`Redis get hatası - Anahtar: "${key}":`, err);
            // Hata durumunda null döndür
            return null;
        }
    }
    
    /**
     * Redis'e değer kaydeder
     * @param key Anahtar
     * @param value Değer
     * @param ttl TTL (saniye)
     * @returns İşlem başarısı
     */
    public async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
        if (!config.redis.enabled) {
            return false;
        }
        
        try {
            const redis = await this.getConnection();
            
            // TTL doğrulama
            const effectiveTtl = ttl && ttl > 0 ? ttl : config.redis.ttl;
            
            // null/undefined değer kontrolü
            if (value === null || value === undefined) {
                redisLogger.warn(`"${key}" anahtarı için null/undefined değer önbelleğe alınmaya çalışıldı`);
                return false;
            }
            
            // Değeri dönüştür
            const serialized = JSON.stringify(value);
            
            // TTL ile kaydet
            await redis.setEx(key, effectiveTtl, serialized);
            return true;
        } catch (err) {
            redisLogger.error(`Redis set hatası - Anahtar: "${key}":`, err);
            return false;
        }
    }
    
    /**
     * Redis'ten desenle eşleşen anahtarları siler
     * @param patterns Desen veya desenler
     * @returns Silinen anahtar sayısı
     */
    public async del(patterns: string | string[]): Promise<number> {
        if (!config.redis.enabled) {
            return 0;
        }
        
        try {
            const redis = await this.getConnection();
            
            // Tek deseni diziye dönüştür
            const patternArray = Array.isArray(patterns) ? patterns : [patterns];
            
            // Desenlerle eşleşen anahtarları bul
            const keyArrays = await Promise.all(
                patternArray.map(pattern => redis.keys(pattern))
            );
            
            // Diziyi düzleştir
            const allKeys = keyArrays.flat();
            
            // Anahtarları sil
            if (allKeys?.length) {
                const deleted = await redis.del(allKeys);
                return deleted;
            }
            
            return 0;
        } catch (err) {
            redisLogger.error('Redis delete hatası:', err);
            return 0;
        }
    }
}

// Singleton örneğini ihraç et
export const redisService = RedisService.getInstance();
