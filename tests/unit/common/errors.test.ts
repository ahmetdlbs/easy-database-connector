import { DatabaseError, ErrorCode } from '../../../src/common/errors';

describe('Error Classes', () => {
  describe('DatabaseError', () => {
    it('should create an error with the given code and message', () => {
      const error = new DatabaseError(ErrorCode.DB_CONNECTION_ERROR, 'Connection failed');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error.name).toBe('DatabaseError');
      expect(error.code).toBe(ErrorCode.DB_CONNECTION_ERROR);
      expect(error.message).toBe('Connection failed');
    });
    
    it('should accept optional details', () => {
      const details = { host: 'localhost', port: 1433 };
      const error = new DatabaseError(ErrorCode.DB_CONNECTION_ERROR, 'Connection failed', details);
      
      expect(error.details).toEqual(details);
    });
    
    it('should convert to JSON with all properties', () => {
      const details = { host: 'localhost', port: 1433 };
      const error = new DatabaseError(ErrorCode.DB_CONNECTION_ERROR, 'Connection failed', details);
      
      const json = error.toJSON();
      
      expect(json).toHaveProperty('name', 'DatabaseError');
      expect(json).toHaveProperty('code', ErrorCode.DB_CONNECTION_ERROR);
      expect(json).toHaveProperty('message', 'Connection failed');
      expect(json).toHaveProperty('details', details);
      expect(json).toHaveProperty('stack');
    });
    
    it('should preserve the prototype chain', () => {
      const error = new DatabaseError(ErrorCode.DB_CONNECTION_ERROR, 'Connection failed');
      
      expect(Object.getPrototypeOf(error)).toBe(DatabaseError.prototype);
      expect(error instanceof Error).toBe(true);
      expect(error instanceof DatabaseError).toBe(true);
    });
  });
  
  describe('ErrorCode', () => {
    it('should have all the required error codes', () => {
      // Genel hatalar
      expect(ErrorCode.UNKNOWN_ERROR).toBeDefined();
      expect(ErrorCode.INVALID_PARAMETER).toBeDefined();
      
      // Veritabanı hataları
      expect(ErrorCode.DB_CONNECTION_ERROR).toBeDefined();
      expect(ErrorCode.DB_QUERY_ERROR).toBeDefined();
      expect(ErrorCode.DB_TRANSACTION_ERROR).toBeDefined();
      expect(ErrorCode.DB_EXECUTION_ERROR).toBeDefined();
      
      // Şifreleme hataları
      expect(ErrorCode.ENCRYPTION_ERROR).toBeDefined();
      expect(ErrorCode.KEY_MANAGEMENT_ERROR).toBeDefined();
      
      // Redis hataları
      expect(ErrorCode.REDIS_CONNECTION_ERROR).toBeDefined();
      expect(ErrorCode.REDIS_OPERATION_ERROR).toBeDefined();
      expect(ErrorCode.CACHE_ERROR).toBeDefined();
    });
  });
});
