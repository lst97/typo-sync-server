import { Context } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { QueueService } from "../services/queue-service.ts";

export class QueueController {
  constructor(private queueService: QueueService) {}

  /**
   * Get current queue status
   * GET /queue/status
   */
  async getQueueStatus(ctx: Context): Promise<void> {
    try {
      const stats = await this.queueService.getQueueStatistics();
      
      ctx.response.body = {
        total_in_queue: stats.totalQueued,
        currently_processing: stats.currentlyProcessing,
        average_wait_time_minutes: Math.ceil(stats.averageWaitTimeMs / 60000),
        processing_capacity: 3 // This should come from config
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to get queue status", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Get queue position for a specific task
   * GET /queue/position/:taskId
   */
  async getQueuePosition(ctx: Context & { params: { taskId: string } }): Promise<void> {
    try {
      const taskId = ctx.params.taskId;
      
      if (!taskId) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Task ID is required" };
        return;
      }
      
      const position = await this.queueService.getQueuePosition(taskId);
      
      if (!position) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Task not found in queue" };
        return;
      }
      
      ctx.response.body = {
        task_id: taskId,
        position: position.position,
        estimated_wait_time_minutes: position.getEstimatedWaitTimeMinutes(),
        status: "QUEUED"
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to get queue position", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Get queue health metrics
   * GET /queue/health
   */
  async getQueueHealth(ctx: Context): Promise<void> {
    try {
      const health = await this.queueService.getHealthMetrics();
      
      ctx.response.body = {
        healthy: health.healthy,
        queue_depth: health.queueDepth,
        processing_capacity: health.processingCapacity,
        average_wait_time_minutes: Math.ceil(health.averageWaitTime / 60000),
        error_rate: health.errorRate
      };
      
      ctx.response.status = health.healthy ? 200 : 503;
    } catch (error) {
      logger.error("Failed to get queue health", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Get queue depth by priority
   * GET /queue/depth
   */
  async getQueueDepth(ctx: Context): Promise<void> {
    try {
      const depth = await this.queueService.getQueueDepthByPriority();
      
      ctx.response.body = {
        high_priority: depth.high,
        normal_priority: depth.normal,
        batch_priority: depth.batch,
        total: depth.high + depth.normal + depth.batch
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to get queue depth", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }
}