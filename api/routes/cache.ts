import { Router } from "../deps.ts";
import { CacheController } from "../controllers/cache-controller.ts";
import { CacheService } from "../services/cache-service.ts";
import { databaseManager } from "../services/database-manager.ts";

// Create router
export const cacheRouter = new Router();

// Initialize services and controller using singleton database manager
const db = await databaseManager.getDatabase();
const cacheService = new CacheService(db);
const cacheController = new CacheController(cacheService);

// Define routes
cacheRouter
  .get("/cache/stats", (ctx) => cacheController.getCacheStats(ctx))
  .get("/cache/health", (ctx) => cacheController.getCacheHealth(ctx))
  .get("/cache/:audioHash", (ctx) => cacheController.getCachedResult(ctx))
  .delete("/cache/:audioHash", (ctx) => cacheController.invalidateCache(ctx))
  .delete("/cache/all", (ctx) => cacheController.clearAllCache(ctx))
  .post("/cache/warm", (ctx) => cacheController.warmCache(ctx));

// Export for use in main application
export { cacheService };