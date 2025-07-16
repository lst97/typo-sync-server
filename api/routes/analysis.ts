import { Router } from "../deps.ts";
import { EnhancedAnalysisController } from "../controllers/analysis-controller.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { CacheService } from "../services/cache-service.ts";
import { QueueService } from "../services/queue-service.ts";
import { databaseManager } from "../services/database-manager.ts";

// Create router
export const analysisRouter = new Router();

// Initialize services and controller using singleton database manager
const db = await databaseManager.getDatabase();
const cacheService = new CacheService(db);
const queueService = new QueueService(db);
const enhancedAnalysisService = new AnalysisService(
	db,
	cacheService,
	queueService
);
const enhancedAnalysisController = new EnhancedAnalysisController(
	enhancedAnalysisService
);

// Define routes with /v2 prefix for enhanced version
analysisRouter
	.post("/v2/analyze", (ctx) => enhancedAnalysisController.analyzeAudio(ctx))
	.get("/v2/results/:taskId", (ctx) =>
		enhancedAnalysisController.getResults(ctx)
	)
	.get("/v2/stream/:taskId", (ctx) =>
		enhancedAnalysisController.streamResults(ctx)
	)
	.get("/v2/health", (ctx) => enhancedAnalysisController.getHealth(ctx));

// Export for use in main application
export { enhancedAnalysisService, cacheService, queueService };
