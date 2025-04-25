/**
 * Asenkron işlemler için mutex implementasyonu
 */
export class AsyncMutex {
    private locked = false;
    private waitQueue: Array<{
        resolve: (release: () => void) => void;
        reject: (err: Error) => void;
        timeoutId?: NodeJS.Timeout;
    }> = [];

    /**
     * Mutex'i belirli bir timeout ile edinir
     * @param timeoutMs Kilit bekleme süresi (ms)
     * @returns Kilidin serbest bırakılması için çağrılacak fonksiyon
     */
    async acquire(timeoutMs = 30000): Promise<() => void> {
        // Release fonksiyonu oluştur
        const release = () => {
            // Sonraki bekleyeni al
            if (this.waitQueue.length > 0) {
                const waiter = this.waitQueue.shift()!;
                if (waiter.timeoutId) {
                    clearTimeout(waiter.timeoutId);
                }
                waiter.resolve(release);
            } else {
                this.locked = false;
            }
        };
        
        // Kilitli değilse hemen al
        if (!this.locked) {
            this.locked = true;
            return release;
        }
        
        // Kilitli ise bekleme sırasına gir
        return new Promise<() => void>((resolve, reject) => {
            // Waiter nesnesinin tipi ile sınıf tipi aynı olmalı
            const waiter: {
                resolve: (release: () => void) => void;
                reject: (err: Error) => void;
                timeoutId?: NodeJS.Timeout;
            } = { 
                resolve: (release: () => void) => resolve(release), 
                reject 
            };
            
            // Timeout ayarla (deadlock önleme)
            if (timeoutMs > 0) {
                waiter.timeoutId = setTimeout(() => {
                    // Kuyruktan çıkar
                    const index = this.waitQueue.indexOf(waiter);
                    if (index !== -1) {
                        this.waitQueue.splice(index, 1);
                    }
                    reject(new Error(`Mutex ${timeoutMs}ms sonra zaman aşımına uğradı`));
                }, timeoutMs);
            }
            
            this.waitQueue.push(waiter);
        });
    }
}
