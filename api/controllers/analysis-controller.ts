import { Context, Status } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { ValidationError, FileUploadError, NotFoundError } from "../middleware/error-handler.ts";
import { SUPPORTED_AUDIO_TYPES } from "../types/schemas.ts";

export class AnalysisController {
  constructor(private analysisService: AnalysisService) {}

  async analyzeAudio(ctx: Context) {
    logger.info("Received audio analysis request");

    try {
      const body = ctx.request.body;
      const bodyType = await body.type();
      
      if (bodyType !== "form-data") {
        throw new ValidationError("Request must be multipart/form-data");
      }

      let formData: FormData;
      try {
        // Use a timeout for form data parsing to prevent hanging
        const formDataPromise = body.formData();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Form data parsing timeout")), 30000);
        });
        
        formData = await Promise.race([formDataPromise, timeoutPromise]) as FormData;
      } catch (error) {
        logger.error("Failed to parse form data", error instanceof Error ? error : new Error(String(error)));
        
        // Check if it's a stream controller error
        if (error instanceof Error && error.message.includes("stream controller")) {
          throw new ValidationError("Upload interrupted - please try again with a smaller file or better connection");
        }
        
        throw new ValidationError("Invalid or corrupted form data");
      }

      const fileField = formData.get("file");

      if (!fileField || !(fileField instanceof File)) {
        throw new ValidationError("No valid file field found in form data");
      }

      // Validate file type
      const contentType = fileField.type;
      if (!contentType || !SUPPORTED_AUDIO_TYPES.includes(contentType as any)) {
        throw new FileUploadError(
          `Invalid file type: ${contentType}. Supported types: ${SUPPORTED_AUDIO_TYPES.join(", ")}`
        );
      }

      // Validate file size
      if (fileField.size > config.config.max_file_size) {
        throw new FileUploadError(
          `File too large. Maximum size: ${config.config.max_file_size} bytes`
        );
      }

      // Convert file to buffer with error handling
      let fileBuffer: Uint8Array;
      try {
        fileBuffer = new Uint8Array(await fileField.arrayBuffer());
      } catch (error) {
        logger.error("Failed to read file data", error instanceof Error ? error : new Error(String(error)));
        throw new FileUploadError("Failed to read uploaded file data");
      }

      // Submit for analysis
      const taskId = await this.analysisService.submitAnalysis(fileBuffer, fileField.name || "audio_file");

      ctx.response.status = Status.OK;
      ctx.response.body = {
        task_id: taskId,
        backend: config.backend,
      };

      logger.info("Analysis request accepted", { taskId, backend: config.backend });
    } catch (error) {
      // Re-throw known errors
      if (error instanceof ValidationError || error instanceof FileUploadError) {
        throw error;
      }
      
      // Log and wrap unexpected errors
      logger.error("Unexpected error in analyzeAudio", error instanceof Error ? error : new Error(String(error)));
      throw new ValidationError("Failed to process audio upload request");
    }
  }

  async getResults(ctx: Context & { params: { taskId: string } }) {
    const taskId = ctx.params.taskId;
    
    if (!taskId) {
      throw new ValidationError("Task ID is required");
    }

    const result = await this.analysisService.getTaskStatus(taskId);
    
    if (result.state === "NOT_FOUND") {
      throw new NotFoundError("Task not found");
    }

    ctx.response.status = Status.OK;
    ctx.response.body = result;

    logger.debug("Task status retrieved", { taskId, state: result.state });
  }

  async streamResults(ctx: Context & { params: { taskId: string } }) {
    const taskId = ctx.params.taskId;
    
    if (!taskId) {
      throw new ValidationError("Task ID is required");
    }

    logger.info("Starting SSE stream", { taskId });

    // Set SSE headers
    ctx.response.headers.set("Content-Type", "text/event-stream");
    ctx.response.headers.set("Cache-Control", "no-cache");
    ctx.response.headers.set("Connection", "keep-alive");
    ctx.response.headers.set("Access-Control-Allow-Origin", "*");
    ctx.response.headers.set("Access-Control-Allow-Headers", "Cache-Control");

    ctx.response.status = Status.OK;

    // Create the SSE stream
    const analysisService = this.analysisService;
    const body = new ReadableStream({
      start(controller) {
        let closed = false;
        
        const closeController = () => {
          if (!closed) {
            try {
              controller.close();
              closed = true;
              logger.info("SSE stream closed", { taskId });
            } catch (error) {
              // Stream already closed or in invalid state
              logger.debug("Stream controller already closed", { taskId });
            }
          }
        };

        (async () => {
          try {
            for await (const status of analysisService.streamTaskStatus(taskId)) {
              if (closed) break;
              
              try {
                const eventData = `data: ${JSON.stringify(status)}\n\n`;
                controller.enqueue(new TextEncoder().encode(eventData));
              } catch (error) {
                // Stream was closed or controller is in invalid state
                logger.debug("Failed to enqueue data, stream likely closed", { taskId });
                break;
              }

              // Exit conditions
              if (status.state === "SUCCESS" || 
                  status.state === "FAILURE" || 
                  status.state === "NOT_FOUND" ||
                  status.state === "ERROR") {
                break;
              }
            }
          } catch (error) {
            if (!closed) {
              logger.error("SSE stream error", error instanceof Error ? error : new Error(String(error)), { taskId });
              try {
                const errorEvent = `data: ${JSON.stringify({
                  state: "ERROR",
                  status: `Stream error: ${error instanceof Error ? error.message : String(error)}`
                })}\n\n`;
                controller.enqueue(new TextEncoder().encode(errorEvent));
              } catch (enqueueError) {
                // Stream is already closed or in invalid state
                logger.debug("Failed to enqueue error event", { taskId });
              }
            }
          } finally {
            closeController();
          }
        })();
      },
      cancel() {
        logger.info("SSE stream cancelled by client", { taskId });
      }
    });

    ctx.response.body = body;
  }

  async healthCheck(ctx: Context) {
    const health = await this.analysisService.healthCheck();
    
    ctx.response.status = health.healthy ? Status.OK : Status.ServiceUnavailable;
    ctx.response.body = {
      status: health.healthy ? "Rhythm Analysis Engine is running" : "Service unavailable",
      backend: config.backend,
      python_check: health,
    };

    logger.debug("Health check performed", { healthy: health.healthy });
  }
}