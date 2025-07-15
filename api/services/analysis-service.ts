import { ensureDir, join } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import { PythonIPCService } from "./python-ipc.ts";
import type { TaskManager } from "./task-manager.ts";
import type { AnalysisResult } from "../types/schemas.ts";

export class AnalysisService {
  private readonly pythonIPC: PythonIPCService;
  private readonly taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.pythonIPC = new PythonIPCService();
    this.taskManager = taskManager;
  }

  async submitAnalysis(fileBuffer: Uint8Array, filename: string): Promise<string> {
    logger.info("Submitting analysis request", { filename });

    // Create task ID
    const taskId = this.taskManager.createTask();

    // Set initial status
    await this.taskManager.setTaskStatus(taskId, {
      state: "PENDING",
      status: "Processing...",
    });

    // Save uploaded file
    const filePath = await this.saveUploadedFile(fileBuffer, filename, taskId);

    // Start background processing
    this.processAnalysisAsync(taskId, filePath);

    logger.info("Analysis task created", { taskId, filename });
    return taskId;
  }

  private async saveUploadedFile(
    fileBuffer: Uint8Array,
    filename: string,
    taskId: string,
  ): Promise<string> {
    const uploadDir = config.config.upload_dir;
    await ensureDir(uploadDir);

    const sanitizedFilename = this.sanitizeFilename(filename);
    const filePath = join(uploadDir, `${taskId}_${sanitizedFilename}`);

    await Deno.writeFile(filePath, fileBuffer);
    logger.debug("File saved", { filePath, size: fileBuffer.length });

    return filePath;
  }

  private sanitizeFilename(filename: string): string {
    // Remove potentially dangerous characters and keep only alphanumeric, dots, hyphens, underscores
    return filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  }

  private async processAnalysisAsync(taskId: string, filePath: string): Promise<void> {
    try {
      logger.info("Starting background analysis", { taskId });

      // Update status to processing
      await this.taskManager.setTaskStatus(taskId, {
        state: "PROCESSING",
        status: "Processing audio file...",
      });

      // Perform the analysis via Python IPC
      const result = await this.pythonIPC.analyzeAudio(filePath);

      if (result.success && result.data) {
        // Analysis succeeded
        await this.taskManager.setTaskStatus(taskId, {
          state: "SUCCESS",
          result: result.data,
        });
        logger.info("Analysis completed successfully", { taskId });
      } else {
        // Analysis failed
        await this.taskManager.setTaskStatus(taskId, {
          state: "FAILURE",
          status: result.error || "Analysis failed with unknown error",
        });
        logger.error("Analysis failed", undefined, { taskId, error: result.error });
      }
    } catch (error) {
      // Unexpected error during processing
      logger.error("Unexpected error during analysis", error instanceof Error ? error : new Error(String(error)), { taskId });
      await this.taskManager.setTaskStatus(taskId, {
        state: "FAILURE",
        status: `Processing error: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      // Clean up the uploaded file
      try {
        await Deno.remove(filePath);
        logger.debug("Cleaned up uploaded file", { filePath });
      } catch (cleanupError) {
        logger.warn("Failed to clean up uploaded file", cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)), { filePath });
      }
    }
  }

  async getTaskStatus(taskId: string) {
    const status = await this.taskManager.getTaskStatus(taskId);
    if (!status) {
      return {
        state: "NOT_FOUND",
        status: "Task not found",
      };
    }
    return status;
  }

  async* streamTaskStatus(taskId: string) {
    logger.info("Starting task status stream", { taskId });
    
    while (true) {
      const status = await this.getTaskStatus(taskId);
      
      yield status;

      // Exit conditions
      if (status.state === "SUCCESS" || 
          status.state === "FAILURE" || 
          status.state === "NOT_FOUND" ||
          status.state === "ERROR") {
        logger.debug("Stream terminating", { taskId, finalState: status.state });
        break;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async healthCheck() {
    return await this.pythonIPC.healthCheck();
  }
}