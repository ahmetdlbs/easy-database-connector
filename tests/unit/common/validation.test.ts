// Önce DatabaseError ve ErrorCode'u import edelim
import { DatabaseError, ErrorCode } from '../../../src/common/errors';

// Sonra validation fonksiyonlarını import edelim
import { validateQueryParameters, validatePaginationParameters, validateCacheParameters } from '../../../src/common/validation';

describe('Validation Functions', () => {
  describe('validateQueryParameters', () => {
    it('should not throw error for valid parameters', () => {
      expect(() => validateQueryParameters('SELECT * FROM users')).not.toThrow();
      expect(() => validateQueryParameters('SELECT * FROM users', [])).not.toThrow();
      expect(() => validateQueryParameters('SELECT * FROM users', [1, 'test'])).not.toThrow();
    });
    
    it('should throw error for missing or empty SQL', () => {
      expect(() => validateQueryParameters(undefined)).toThrow(DatabaseError);
      expect(() => validateQueryParameters('')).toThrow(DatabaseError);
      expect(() => validateQueryParameters('   ')).toThrow(DatabaseError);
      
      try {
        validateQueryParameters('');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
        expect((error as DatabaseError).message).toMatch(/Geçerli bir SQL sorgusu sağlanmalıdır/);
      }
    });
    
    it('should throw error for non-array parameters', () => {
      expect(() => validateQueryParameters('SELECT * FROM users', 'not an array' as any)).toThrow(DatabaseError);
      expect(() => validateQueryParameters('SELECT * FROM users', {} as any)).toThrow(DatabaseError);
      expect(() => validateQueryParameters('SELECT * FROM users', 123 as any)).toThrow(DatabaseError);
      
      try {
        validateQueryParameters('SELECT * FROM users', 'not an array' as any);
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
        expect((error as DatabaseError).message).toMatch(/Parametreler bir dizi olmalıdır/);
      }
    });
  });
  
  describe('validatePaginationParameters', () => {
    it('should return default values for undefined parameters', () => {
      const result = validatePaginationParameters();
      expect(result).toEqual({ page: 1, pageSize: 10 });
    });
    
    it('should parse string values to numbers', () => {
      const result = validatePaginationParameters('2', '20');
      expect(result).toEqual({ page: 2, pageSize: 20 });
    });
    
    it('should throw error for invalid page number', () => {
      try {
        validatePaginationParameters(0);
        // Jest'in fail fonksiyonu yerine aşağıdaki durumu kullanalım
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
      }
      
      try {
        validatePaginationParameters(-1);
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
      
      try {
        validatePaginationParameters('abc');
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
    });
    
    it('should throw error for invalid page size', () => {
      try {
        validatePaginationParameters(1, 0);
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
      }
      
      try {
        validatePaginationParameters(1, -10);
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
      
      try {
        validatePaginationParameters(1, 1001);
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
      
      try {
        validatePaginationParameters(1, 'xyz');
        expect(true).toBe(false); // Buraya gelmemeli, hata fırlatmış olmalı
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      }
    });
  });
  
  describe('validateCacheParameters', () => {
    it('should not throw error for valid parameters', () => {
      expect(() => validateCacheParameters('users:list', 300)).not.toThrow();
      expect(() => validateCacheParameters('users:list')).not.toThrow();
      expect(() => validateCacheParameters(undefined, undefined)).not.toThrow();
    });
    
    it('should throw error for empty cache key if provided', () => {
      expect(() => validateCacheParameters('')).toThrow(DatabaseError);
      expect(() => validateCacheParameters('   ')).toThrow(DatabaseError);
      
      try {
        validateCacheParameters('');
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
        expect((error as DatabaseError).message).toMatch(/Geçerli bir önbellek anahtarı sağlanmalıdır/);
      }
    });
    
    it('should throw error for negative TTL', () => {
      expect(() => validateCacheParameters('users:list', -1)).toThrow(DatabaseError);
      
      try {
        validateCacheParameters('users:list', -100);
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
        expect((error as DatabaseError).message).toMatch(/TTL değeri sıfır veya pozitif bir sayı olmalıdır/);
      }
    });
    
    it('should throw error for non-number TTL', () => {
      expect(() => validateCacheParameters('users:list', 'abc' as any)).toThrow(DatabaseError);
      expect(() => validateCacheParameters('users:list', {} as any)).toThrow(DatabaseError);
      
      try {
        validateCacheParameters('users:list', 'abc' as any);
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
        expect((error as DatabaseError).code).toBe(ErrorCode.INVALID_PARAMETER);
        expect((error as DatabaseError).message).toMatch(/TTL değeri sıfır veya pozitif bir sayı olmalıdır/);
      }
    });
  });
});
