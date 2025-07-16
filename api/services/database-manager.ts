import { DatabaseService } from "./database-service.ts";
import { logger } from "../utils/logger.ts";

/**
 * Singleton DatabaseManager to prevent multiple database instances
 * and ensure proper initialization/migration sequencing
 */
export class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private static isInitializing = false;
  private databaseService: DatabaseService | null = null;
  private initialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Initialize database service with singleton pattern
   */
  async getDatabase(dataDir?: string): Promise<DatabaseService> {
    // Return existing instance if already initialized
    if (this.databaseService && this.initialized) {
      return this.databaseService;
    }

    // Wait if another initialization is in progress
    if (DatabaseManager.isInitializing) {
      return await this.waitForInitialization();
    }

    // Start initialization
    DatabaseManager.isInitializing = true;
    
    try {
      if (!this.databaseService) {
        this.databaseService = new DatabaseService(dataDir);
      }

      if (!this.initialized) {
        logger.info("Initializing database service...");
        await this.databaseService.initialize();
        await this.databaseService.migrate();
        this.initialized = true;
        logger.info("Database service initialized successfully");
      }

      return this.databaseService;
    } catch (error) {
      logger.error("Failed to initialize database service", error instanceof Error ? error : new Error(String(error)));
      // Reset state on failure
      this.databaseService = null;
      this.initialized = false;
      throw error;
    } finally {
      DatabaseManager.isInitializing = false;
    }
  }

  /**
   * Wait for ongoing initialization to complete
   */
  private async waitForInitialization(): Promise<DatabaseService> {
    const maxWait = 30000; // 30 seconds timeout
    const checkInterval = 100; // Check every 100ms
    let waited = 0;

    while (DatabaseManager.isInitializing && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    if (DatabaseManager.isInitializing) {
      throw new Error("Database initialization timeout");
    }

    if (!this.databaseService || !this.initialized) {
      throw new Error("Database initialization failed");
    }

    return this.databaseService;
  }

  /**
   * Get database service without initialization (for testing)
   */
  getDatabaseService(): DatabaseService | null {
    return this.databaseService;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset manager state (for testing)
   */
  async reset(): Promise<void> {
    if (this.databaseService) {
      await this.databaseService.close();
    }
    this.databaseService = null;
    this.initialized = false;
    DatabaseManager.isInitializing = false;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.databaseService) {
      await this.databaseService.close();
      this.databaseService = null;
      this.initialized = false;
    }
  }

  /**
   * Graceful shutdown with cleanup while preserving data
   */
  async shutdown(): Promise<void> {
    try {
      logger.info("Starting database shutdown...");
      
      if (this.databaseService) {
        // First, properly close the database connection
        await this.databaseService.close();
        
        // Then clean up temporary files while preserving data
        await this.cleanupTemporaryFiles();
        
        this.databaseService = null;
        this.initialized = false;
        
        logger.info("Database shutdown completed successfully");
      }
    } catch (error) {
      logger.error("Error during database shutdown", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Clean up temporary files while preserving data
   */
  private async cleanupTemporaryFiles(): Promise<void> {
    if (!this.databaseService) return;
    
    const dataDir = this.databaseService.getDataDir();
    if (dataDir === ":memory:") return;
    
    try {
      const filesToCleanup = [
        `${dataDir}/postmaster.pid`,
        `${dataDir}/.s.PGSQL.5432.lock.out`,
        `${dataDir}/pg_stat_tmp` // Temporary statistics directory
      ];
      
      for (const file of filesToCleanup) {
        try {
          const stat = await Deno.stat(file);
          if (stat.isFile) {
            await Deno.remove(file);
            logger.info(`Cleaned up temporary file: ${file}`);
          } else if (stat.isDirectory) {
            await Deno.remove(file, { recursive: true });
            logger.info(`Cleaned up temporary directory: ${file}`);
          }
        } catch {
          // File/directory doesn't exist, which is fine
        }
      }
      
      logger.info("Temporary files cleanup completed");
    } catch (error) {
      logger.warn("Could not clean up some temporary files", error instanceof Error ? error : new Error(String(error)));
    }
  }
}

// Export singleton instance
export const databaseManager = DatabaseManager.getInstance();