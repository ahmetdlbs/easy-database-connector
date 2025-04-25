// Jest test ortamı için genel kurulum

// Test ortamı değişkenlerini ayarla
process.env.NODE_ENV = 'test';
process.env.DB_SKIP_ENCRYPTION = 'true'; // Test ortamında şifrelemeyi atla

// Jest zaman aşımı süresini artır
jest.setTimeout(30000);

// Jest için console mockları
const originalConsole = global.console;

// Tüm testlerden önce console fonksiyonlarını mockla
beforeAll(() => {
  global.console = {
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
});

// Tüm testlerden sonra orijinal console'u geri yükle
afterAll(() => {
  global.console = originalConsole;
});

// Her testten sonra mockları temizle
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});
