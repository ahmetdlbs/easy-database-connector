import { Logger } from '../../../src/utils/logger';

describe('Logger', () => {
  let originalDebug: jest.Mock;
  let originalInfo: jest.Mock;
  let originalWarn: jest.Mock;
  let originalError: jest.Mock;
  
  beforeEach(() => {
    // Console methodları mock olarak ayarlandı
    originalDebug = console.debug as jest.Mock;
    originalInfo = console.info as jest.Mock;
    originalWarn = console.warn as jest.Mock;
    originalError = console.error as jest.Mock;
    
    // Her test öncesinde mockları temizle
    jest.clearAllMocks();
  });
  
  it('should create a logger with context', () => {
    const logger = new Logger('TestContext');
    expect(logger).toBeInstanceOf(Logger);
  });
  
  it('should log debug messages only when log level is debug', () => {
    Logger.setLogLevel('info');
    const logger = new Logger('TestContext');
    
    logger.debug('Debug message');
    expect(originalDebug).not.toHaveBeenCalled();
    
    Logger.setLogLevel('debug');
    logger.debug('Debug message');
    expect(originalDebug).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Debug message/));
  });
  
  it('should log info messages when log level is info or debug', () => {
    Logger.setLogLevel('warn');
    const logger = new Logger('TestContext');
    
    logger.info('Info message');
    expect(originalInfo).not.toHaveBeenCalled();
    
    Logger.setLogLevel('info');
    logger.info('Info message');
    expect(originalInfo).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Info message/));
    
    originalInfo.mockClear();
    Logger.setLogLevel('debug');
    logger.info('Info message');
    expect(originalInfo).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Info message/));
  });
  
  it('should log warning messages when log level is warn, info, or debug', () => {
    Logger.setLogLevel('error');
    const logger = new Logger('TestContext');
    
    logger.warn('Warning message');
    expect(originalWarn).not.toHaveBeenCalled();
    
    Logger.setLogLevel('warn');
    logger.warn('Warning message');
    expect(originalWarn).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Warning message/));
    
    originalWarn.mockClear();
    Logger.setLogLevel('info');
    logger.warn('Warning message');
    expect(originalWarn).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Warning message/));
    
    originalWarn.mockClear();
    Logger.setLogLevel('debug');
    logger.warn('Warning message');
    expect(originalWarn).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Warning message/));
  });
  
  it('should always log error messages regardless of log level', () => {
    const logger = new Logger('TestContext');
    const levels = ['error', 'warn', 'info', 'debug'];
    
    for (const level of levels) {
      originalError.mockClear();
      Logger.setLogLevel(level as any);
      
      logger.error('Error message');
      expect(originalError).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[TestContext\] Error message/));
    }
  });
  
  it('should format messages with timestamp and context', () => {
    Logger.setLogLevel('debug');
    const logger = new Logger('TestContext');
    
    logger.debug('Message with params', { foo: 'bar' });
    expect(originalDebug).toHaveBeenCalledWith(
      expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] \[TestContext\] Message with params/),
      { foo: 'bar' }
    );
  });
});
