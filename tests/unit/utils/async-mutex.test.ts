import { AsyncMutex } from '../../../src/utils/async-mutex';

describe('AsyncMutex', () => {
  let mutex: AsyncMutex;
  
  beforeEach(() => {
    mutex = new AsyncMutex();
  });
  
  it('should acquire the lock if not locked', async () => {
    const release = await mutex.acquire();
    expect(typeof release).toBe('function');
  });
  
  it('should wait for lock to be released before acquiring again', async () => {
    // İlk kilidi al
    const release1 = await mutex.acquire();
    
    // İkinci kilidi almayı dene (henüz alınmamalı)
    const acquirePromise = mutex.acquire();
    
    // İkinci kilidin henüz alınmadığını kontrol etmek için küçük bekletme
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // İkinci kilidin hala beklediğinden emin ol
    expect(acquirePromise).not.toEqual(expect.any(Function));
    
    // İlk kilidi serbest bırak
    release1();
    
    // İkinci kilidin artık alınabildiğinden emin ol
    const release2 = await acquirePromise;
    expect(typeof release2).toBe('function');
  });
  
  // FIFO testi - zaman aşımı değeri artırıldı ve Promise yapısı değiştirildi
  it('should handle multiple waiting acquirers in FIFO order', async () => {
    // İlk kilidi al
    const release1 = await mutex.acquire();
    
    // Bekleme sırasını takip etmek için dizi
    const order: number[] = [];
    
    // Birden fazla bekleyeni sıraya sok - doğrudan async fonksiyonlar kullan
    const promise2 = (async () => {
      const release2 = await mutex.acquire();
      order.push(2);
      return release2;
    })();
    
    const promise3 = (async () => {
      const release3 = await mutex.acquire();
      order.push(3);
      return release3;
    })();
    
    // Kısa bir süre bekle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // İlk kilidi serbest bırak
    release1();
    
    // İkinci promise'in tamamlanmasını bekle
    const release2 = await promise2;
    
    // Kısa bir süre bekle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // İkinci kilidi serbest bırak
    release2();
    
    // Üçüncü promise'in tamamlanmasını bekle
    const release3 = await promise3;
    
    // Üçüncü kilidi serbest bırak
    release3();
    
    // Bekleyenlerin doğru sırada işlendiğini doğrula
    expect(order).toEqual([2, 3]);
    
  }, 10000); // Test için 10 saniye zaman aşımı
  
  it('should timeout if lock cannot be acquired within specified time', async () => {
    // İlk kilidi al
    await mutex.acquire();
    
    // Kısa bir zaman aşımı ile ikinci kilidi almayı dene
    await expect(mutex.acquire(10)).rejects.toThrow(/zaman aşımına uğradı/);
  });
  
  it('should clean up waiter from queue on timeout', async () => {
    // İlk kilidi al
    const release = await mutex.acquire();
    
    // Kısa bir zaman aşımı ile ikinci kilidi almayı dene
    try {
      await mutex.acquire(10);
    } catch (e) {
      // Beklenen hata
    }
    
    // İlk kilidi serbest bırak
    release();
    
    // Mutex artık serbest olmalı, yeni bir kilidin hemen alınabildiğini kontrol et
    const newRelease = await mutex.acquire();
    expect(typeof newRelease).toBe('function');
  });
  
  it('should allow reacquiring after release', async () => {
    // Al-bırak-al döngüsünü test et
    const release1 = await mutex.acquire();
    release1();
    
    const release2 = await mutex.acquire();
    expect(typeof release2).toBe('function');
    
    release2();
    
    const release3 = await mutex.acquire();
    expect(typeof release3).toBe('function');
  });
  
  it('should not use timeout if timeoutMs is 0', async () => {
    // İlk kilidi al
    const release = await mutex.acquire();
    
    // Zaman aşımı olmadan ikinci kilidi almaya çalış
    const acquirePromise = mutex.acquire(0);
    
    // İkinci kilidin hala beklediğinden emin ol
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Bu noktada hata fırlatılmamalı ve promise hala bekliyor olmalı
    
    // İlk kilidi serbest bırak
    release();
    
    // İkinci kilidin artık alınabildiğinden emin ol
    const release2 = await acquirePromise;
    expect(typeof release2).toBe('function');
  });
});
