import { logger } from "../utils/logger.ts";
import { databaseManager } from "./database-manager.ts";

/**
 * Graceful shutdown manager that handles cleanup while preserving data
 */
export class ShutdownManager {
  private static instance: ShutdownManager | null = null;
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private isShuttingDown = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): ShutdownManager {
    if (!ShutdownManager.instance) {
      ShutdownManager.instance = new ShutdownManager();
    }
    return ShutdownManager.instance;
  }

  /**
   * Register a shutdown handler
   */
  registerShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Execute graceful shutdown
   */
  async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn("Shutdown already in progress");
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    try {
      // Execute all registered shutdown handlers
      for (const handler of this.shutdownHandlers) {
        try {
          await handler();
        } catch (error) {
          logger.error("Error in shutdown handler", error instanceof Error ? error : new Error(String(error)));
        }
      }

      // Close database connections and clean up temporary files
      await databaseManager.shutdown();

      // Additional cleanup tasks
      await this.performFinalCleanup();

      logger.info("Graceful shutdown completed successfully");
    } catch (error) {
      logger.error("Error during graceful shutdown", error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Force exit after cleanup
      Deno.exit(0);
    }
  }

  /**
   * Perform final cleanup tasks
   */
  private async performFinalCleanup(): Promise<void> {
    try {
      // Clear any remaining temporary files in the current directory
      const tempPatterns = [
        ".tmp*",
        "*.tmp",
        "core.*", // Core dump files
        "*.log.tmp" // Temporary log files
      ];

      for (const pattern of tempPatterns) {
        try {
          // Note: This is a simple cleanup - in a real app you might want more sophisticated temp file handling
          for await (const entry of Deno.readDir(".")) {
            if (entry.isFile && this.matchesPattern(entry.name, pattern)) {
              await Deno.remove(entry.name);
              logger.info(`Cleaned up temporary file: ${entry.name}`);
            }
          }
        } catch {
          // Directory might not exist or no permissions, continue with cleanup
        }
      }

      logger.info("Final cleanup completed");
    } catch (error) {
      logger.warn("Could not complete final cleanup", error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Simple pattern matching for file cleanup
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(filename);
    }
    return filename === pattern;
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers(): void {
    // Handle SIGINT (Ctrl+C)
    try {
      Deno.addSignalListener("SIGINT", () => {
        this.shutdown("SIGINT");
      });
    } catch (error) {
      logger.warn("Could not setup SIGINT handler", error instanceof Error ? error : new Error(String(error)));
    }

    // Handle SIGTERM (kill command)
    try {
      Deno.addSignalListener("SIGTERM", () => {
        this.shutdown("SIGTERM");
      });
    } catch (error) {
      logger.warn("Could not setup SIGTERM handler", error instanceof Error ? error : new Error(String(error)));
    }

    // Handle unhandled promise rejections
    globalThis.addEventListener("unhandledrejection", (event) => {
      const error = event.reason;
      
      if (error instanceof Error && error.message.includes("stream controller")) {
        logger.warn("Unhandled stream controller error during shutdown", error);
        event.preventDefault();
        return;
      }
      
      logger.error("Unhandled rejection during shutdown", error instanceof Error ? error : new Error(String(error)));
      
      // If we're not already shutting down, initiate shutdown
      if (!this.isShuttingDown) {
        this.shutdown("UNHANDLED_REJECTION");
      }
    });
  }
}

// Export singleton instance
export const shutdownManager = ShutdownManager.getInstance();