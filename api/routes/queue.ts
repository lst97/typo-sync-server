import { Router } from "../deps.ts";
import { QueueController } from "../controllers/queue-controller.ts";
import { QueueService } from "../services/queue-service.ts";
import { databaseManager } from "../services/database-manager.ts";

// Create router
export const queueRouter = new Router();

// Initialize services and controller using singleton database manager
const db = await databaseManager.getDatabase();
const queueService = new QueueService(db);
const queueController = new QueueController(queueService);

// Define routes
queueRouter
  .get("/queue/status", (ctx) => queueController.getQueueStatus(ctx))
  .get("/queue/position/:taskId", (ctx) => queueController.getQueuePosition(ctx))
  .get("/queue/health", (ctx) => queueController.getQueueHealth(ctx))
  .get("/queue/depth", (ctx) => queueController.getQueueDepth(ctx));

// Export for use in main application
export { queueService };