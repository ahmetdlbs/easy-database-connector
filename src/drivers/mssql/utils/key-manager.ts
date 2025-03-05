// src/drivers/mssql/utils/key-manager.ts
import { mssql } from '../../../types/database.types';
import { dbConfig } from '../../../config/database.config';

/**
 * Manages encryption key states for database connections
 * Keeps track of open keys to prevent unnecessary operations
 * and properly handles transactions
 */
export class KeyManagerService {
  private static instance: KeyManagerService;
  private connectionKeyMap: Map<string, Set<string>> = new Map();
  private masterKeyOpenMap: Map<string, boolean> = new Map();
  private keyTimeout: Map<string, NodeJS.Timeout> = new Map();
  
  // Private constructor for singleton pattern
  private constructor() {}
  
  /**
   * Get singleton instance of KeyManagerService
   */
  public static getInstance(): KeyManagerService {
    if (!KeyManagerService.instance) {
      KeyManagerService.instance = new KeyManagerService();
    }
    return KeyManagerService.instance;
  }
  
  /**
   * Get a unique identifier for a connection or transaction
   * @param pool The connection pool
   * @param transaction Optional transaction
   * @returns A string identifier
   */
  private getConnectionId(pool: mssql.ConnectionPool, transaction?: mssql.Transaction): string {
    // If we have a transaction, use its ID as it's a separate context
    if (transaction) {
      return `tx_${transaction.isolationLevel}_${Date.now()}`;
    }
    // Use a combination of object ID and timestamp as fallback
    return `pool_${pool.connected ? 'connected' : 'disconnected'}_${Date.now()}`;
  }
  
  /**
   * Manages the encryption keys according to the specified configuration
   * @param pool Database connection pool
   * @param config Configuration specifying which keys to open/close
   * @param transaction Optional transaction to use for key operations
   */
  public async manageKey(
    pool: mssql.ConnectionPool, 
    config: {
      aes?: boolean;
      masterkey?: boolean;
    }, 
    transaction?: mssql.Transaction
  ): Promise<void> {
    const connId = this.getConnectionId(pool, transaction);
    
    // Initialize maps for this connection if needed
    if (!this.connectionKeyMap.has(connId)) {
      this.connectionKeyMap.set(connId, new Set());
    }
    
    const openKeys = this.connectionKeyMap.get(connId)!;
    const request = transaction ? new mssql.Request(transaction) : pool.request();
    
    try {
      if (config.masterkey || config.aes) {
        // Opening keys
        
        // Open master key if needed
        if (config.masterkey && !this.masterKeyOpenMap.get(connId)) {
          try {
            await request.batch(`
              IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
              BEGIN
                OPEN MASTER KEY DECRYPTION BY PASSWORD = '${dbConfig.masterKeyPassword}';
              END
            `);
            this.masterKeyOpenMap.set(connId, true);
          } catch (error) {
            const masterKeyError = error as mssql.RequestError;
            if (masterKeyError.number === 15466) {
              // Key is already open, update our state
              this.masterKeyOpenMap.set(connId, true);
            } else {
              console.error('Master key error:', masterKeyError);
              throw new Error(`Master key operation failed: ${masterKeyError.message}`);
            }
          }
        }
        
        // Open AES key if needed
        if (config.aes && !openKeys.has(dbConfig.symmetricKeyName!)) {
          try {
            // Make sure master key is open before opening symmetric key
            if (!this.masterKeyOpenMap.get(connId) && config.masterkey !== false) {
              await request.batch(`
                IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
                BEGIN
                  OPEN MASTER KEY DECRYPTION BY PASSWORD = '${dbConfig.masterKeyPassword}';
                END
              `);
              this.masterKeyOpenMap.set(connId, true);
            }
            
            await request.batch(`
              IF NOT EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
              BEGIN
                OPEN SYMMETRIC KEY ${dbConfig.symmetricKeyName} 
                DECRYPTION BY CERTIFICATE ${dbConfig.certificateName};
              END
            `);
            openKeys.add(dbConfig.symmetricKeyName!);
            
            // Only set timeout for non-transaction connections
            if (!transaction) {
              this.resetKeyTimeout(connId, pool);
            }
          } catch (error) {
            const symmetricKeyError = error as mssql.RequestError;
            if (symmetricKeyError.number === 15466) {
              // Key is already open, update our state
              openKeys.add(dbConfig.symmetricKeyName!);
            } else {
              console.error('Symmetric key error:', symmetricKeyError);
              throw new Error(`Symmetric key operation failed: ${symmetricKeyError.message}`);
            }
          }
        }
      } else {
        // Closing keys
        
        // Close AES key if open
        if (openKeys.has(dbConfig.symmetricKeyName!)) {
          await request.batch(`
            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = '${dbConfig.symmetricKeyName}')
            BEGIN
              CLOSE SYMMETRIC KEY ${dbConfig.symmetricKeyName};
            END
          `);
          openKeys.delete(dbConfig.symmetricKeyName!);
          
          // Clear any timeout for this connection
          if (this.keyTimeout.has(connId)) {
            clearTimeout(this.keyTimeout.get(connId)!);
            this.keyTimeout.delete(connId);
          }
        }
        
        // Close master key if open
        if (this.masterKeyOpenMap.get(connId)) {
          await request.batch(`
            IF EXISTS (SELECT 1 FROM sys.openkeys WHERE key_name = 'master')
            BEGIN
              CLOSE MASTER KEY;
            END
          `);
          this.masterKeyOpenMap.set(connId, false);
        }
        
        // Clean up the maps if no keys are open
        if (openKeys.size === 0) {
          this.connectionKeyMap.delete(connId);
          this.masterKeyOpenMap.delete(connId);
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('Key operation failed:', error);
      throw new Error(`Key operation failed: ${errMsg}`);
    }
  }
  
  /**
   * Clean up resources when a connection is closed
   * @param pool The connection pool being closed
   */
  public cleanupConnection(pool: mssql.ConnectionPool): void {
    // Clean up all connection keys that start with pool_
    for (const connId of this.connectionKeyMap.keys()) {
      if (connId.startsWith('pool_')) {
        this.connectionKeyMap.delete(connId);
        this.masterKeyOpenMap.delete(connId);
        
        if (this.keyTimeout.has(connId)) {
          clearTimeout(this.keyTimeout.get(connId)!);
          this.keyTimeout.delete(connId);
        }
      }
    }
  }
  
  /**
   * Clean up resources when a transaction completes
   * @param transaction The transaction that completed
   */
  public cleanupTransaction(pool: mssql.ConnectionPool, transaction: mssql.Transaction): void {
    // Clean up all connection keys that start with tx_
    for (const connId of this.connectionKeyMap.keys()) {
      if (connId.startsWith('tx_')) {
        this.connectionKeyMap.delete(connId);
        this.masterKeyOpenMap.delete(connId);
      }
    }
  }
  
  /**
   * Reset the timeout for key auto-closure
   * @param connId The connection ID
   * @param pool The connection pool (needed for closing keys)
   */
  private resetKeyTimeout(connId: string, pool: mssql.ConnectionPool): void {
    // Clear any existing timeout
    if (this.keyTimeout.has(connId)) {
      clearTimeout(this.keyTimeout.get(connId)!);
    }
    
    // Set new timeout (close after 5 minutes of inactivity)
    this.keyTimeout.set(
      connId,
      setTimeout(() => {
        try {
          // Only attempt to close keys if the connection is still open
          if (pool.connected) {
            this.manageKey(pool, { aes: false, masterkey: false }).catch(err => {
              console.error('Error auto-closing keys:', err);
            });
          }
          
          // Clean up the maps
          this.connectionKeyMap.delete(connId);
          this.masterKeyOpenMap.delete(connId);
          this.keyTimeout.delete(connId);
        } catch (error) {
          console.error('Error in key timeout handler:', error);
        }
      }, 5 * 60 * 1000) // 5 minutes
    );
  }
}

// Export singleton instance
export const keyManagerService = KeyManagerService.getInstance();