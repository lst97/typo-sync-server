import { Router } from "../deps.ts";
import { AnalysisController } from "../controllers/analysis-controller.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { CacheService } from "../services/cache-service.ts";
import { QueueService } from "../services/queue-service.ts";
import { databaseManager } from "../services/database-manager.ts";
import { processManager } from "../services/process-manager.ts";
import { createTaskManager } from "../services/task-manager.ts";

// Create router
export const analysisRouter = new Router();

// Initialize services and controller using singleton database manager
const db = await databaseManager.getDatabase();
const cacheService = new CacheService(db);
const queueService = new QueueService(db);
const analysisService = new AnalysisService(db, cacheService, queueService);
const analysisController = new AnalysisController(analysisService);

// Register services with process manager for cleanup
// Note: We need to get the PythonIPCService instance from the AnalysisService
// and the RedisTaskManager from the task manager factory
const taskManager = await createTaskManager();
if (taskManager && "forceDisconnect" in taskManager) {
	processManager.registerTaskManager(
		taskManager as import("../services/task-manager.ts").RedisTaskManager
	);
}

// Register Python IPC service from the analysis service
const pythonIPCService = analysisService.getPythonIPCService();
processManager.registerPythonIPCService(pythonIPCService);

// Define routes with /v2 prefix for enhanced version
analysisRouter
	.post("/v2/analyze", (ctx) => analysisController.analyzeAudio(ctx))
	.get("/v2/results/:taskId", (ctx) => analysisController.getResults(ctx))
	.get("/v2/stream/:taskId", (ctx) => analysisController.streamResults(ctx))
	.get("/v2/health", (ctx) => analysisController.getHealth(ctx));

// Export for use in main application
export {
	analysisService as enhancedAnalysisService,
	cacheService,
	queueService,
};
