import { Router } from "../deps.ts";
import { AnalysisController } from "../controllers/analysis-controller.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { createTaskManager } from "../services/task-manager.ts";

// Create router
export const analysisRouter = new Router();

// Initialize services and controller
const taskManager = await createTaskManager();
const analysisService = new AnalysisService(taskManager);
const analysisController = new AnalysisController(analysisService);

// Define routes
analysisRouter
  .post("/analyze", (ctx) => analysisController.analyzeAudio(ctx))
  .get("/results/:taskId", (ctx) => analysisController.getResults(ctx))
  .get("/stream/:taskId", (ctx) => analysisController.streamResults(ctx));

// Export for use in main application
export { analysisService };