import { EventEmitter } from 'events';

// Redis client mock fonksiyonları ve sınıfı
interface RedisClientOptions {
  socket?: {
    host?: string;
    port?: number;
    connectTimeout?: number;
    reconnectStrategy?: any;
    keepAlive?: number;
  };
  password?: string;
  commandsQueueMaxLength?: number;
}

// RedisClientType için mock
export class MockRedisClient extends EventEmitter {
  public isOpen = false;
  public connect = jest.fn().mockImplementation(() => {
    this.isOpen = true;
    this.emit('connect');
    return Promise.resolve(this);
  });
  
  public quit = jest.fn().mockImplementation(() => {
    this.isOpen = false;
    return Promise.resolve('OK');
  });
  
  public get = jest.fn().mockResolvedValue(null);
  public set = jest.fn().mockResolvedValue('OK');
  public setEx = jest.fn().mockResolvedValue('OK');
  public del = jest.fn().mockResolvedValue(1);
  public keys = jest.fn().mockResolvedValue([]);
  
  constructor() {
    super();
    this.isOpen = false;
  }
  
  // EventEmitter.on'u override et
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    return this;
  }
}

export const createClient = jest.fn().mockImplementation((_options?: RedisClientOptions) => {
  return new MockRedisClient();
});

export default {
  createClient
};
