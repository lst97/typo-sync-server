import { ulid } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { DatabaseService } from "./database-service.ts";
import { 
  QueueItem, 
  QueuePosition, 
  QueueStatistics, 
  Priority,
  AudioQueuedEvent,
  ProcessingStartedEvent,
  ProcessingCompletedEvent
} from "../types/domain.ts";

export interface QueueServiceOptions {
  maxConcurrency?: number;
  defaultPriority?: Priority;
  processingTimeoutMs?: number;
}

export type QueuePriority = "high" | "normal" | "batch";

export class QueueService {
  private db: DatabaseService;
  private options: Required<QueueServiceOptions>;
  private eventHandlers: Map<string, ((event: any) => void)[]> = new Map();

  constructor(db: DatabaseService, options: QueueServiceOptions = {}) {
    this.db = db;
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 3,
      defaultPriority: options.defaultPriority ?? 2,
      processingTimeoutMs: options.processingTimeoutMs ?? 300000 // 5 minutes
    };
  }

  /**
   * Enqueue an audio processing task
   */
  async enqueue(audioFingerprintId: string, priority: QueuePriority = "normal"): Promise<string> {
    try {
      const taskId = ulid();
      const priorityValue = this.mapPriorityToValue(priority);
      
      const queueItem = new QueueItem({
        taskId,
        audioFingerprintId,
        priority: priorityValue,
        status: "QUEUED"
      });
      
      await this.db.queueRepository.enqueue(queueItem);
      
      // Get queue position for the event
      const position = await this.getQueuePosition(taskId);
      
      // Emit queued event
      await this.emitEvent(new AudioQueuedEvent({
        taskId,
        audioHash: audioFingerprintId,
        queuePosition: position?.position || 0
      }));
      
      logger.info("Task enqueued successfully", { 
        taskId, 
        priority, 
        audioFingerprintId: audioFingerprintId.substring(0, 8) + "..."
      });
      
      return taskId;
    } catch (error) {
      logger.error("Failed to enqueue task", error instanceof Error ? error : new Error(String(error)));
      throw new Error("Failed to enqueue processing task");
    }
  }

  /**
   * Dequeue tasks for processing
   */
  async dequeue(limit: number = 1): Promise<QueueItem[]> {
    try {
      // Check if we can process more tasks
      const canProcess = await this.canProcessMore();
      if (!canProcess) {
        logger.debug("Cannot process more tasks due to concurrency limit");
        return [];
      }
      
      // Adjust limit based on available capacity
      const currentProcessing = await this.getCurrentProcessingCount();
      const availableSlots = this.options.maxConcurrency - currentProcessing;
      const actualLimit = Math.min(limit, availableSlots);
      
      const items = await this.db.queueRepository.dequeue(actualLimit);
      
      logger.debug("Dequeued tasks", { 
        requested: limit, 
        actual: actualLimit, 
        dequeued: items.length,
        currentProcessing,
        maxConcurrency: this.options.maxConcurrency
      });
      
      return items;
    } catch (error) {
      logger.error("Failed to dequeue tasks", error instanceof Error ? error : new Error(String(error)));
      throw new Error("Failed to dequeue processing tasks");
    }
  }

  /**
   * Get queue position for a task
   */
  async getQueuePosition(taskId: string): Promise<QueuePosition | null> {
    try {
      return await this.db.queueRepository.getQueuePosition(taskId);
    } catch (error) {
      logger.error("Failed to get queue position", error instanceof Error ? error : new Error(String(error)), { taskId });
      return null;
    }
  }

  /**
   * Get current queue statistics
   */
  async getQueueStatistics(): Promise<QueueStatistics> {
    try {
      return await this.db.queueRepository.getQueueStats();
    } catch (error) {
      logger.error("Failed to get queue statistics", error instanceof Error ? error : new Error(String(error)));
      throw new Error("Failed to get queue statistics");
    }
  }

  /**
   * Mark a task as processing started
   */
  async markProcessingStarted(taskId: string): Promise<void> {
    try {
      await this.db.queueRepository.updateStatus(taskId, "PROCESSING");
      
      // Emit processing started event
      await this.emitEvent(new ProcessingStartedEvent({
        taskId,
        startedAt: new Date()
      }));
      
      logger.info("Task processing started", { taskId });
    } catch (error) {
      logger.error("Failed to mark processing started", error instanceof Error ? error : new Error(String(error)), { taskId });
      throw new Error("Failed to update task status");
    }
  }

  /**
   * Mark a task as processing completed
   */
  async markProcessingCompleted(taskId: string): Promise<void> {
    try {
      await this.db.queueRepository.updateStatus(taskId, "COMPLETED");
      
      // Get the queue item to calculate processing time
      const queueItem = await this.db.queueRepository.findByTaskId(taskId);
      const processingTime = queueItem?.getProcessingTimeMs() || 0;
      
      // Emit processing completed event
      await this.emitEvent(new ProcessingCompletedEvent({
        taskId,
        processingTimeMs: processingTime,
        cacheHit: false // This will be determined by the analysis service
      }));
      
      logger.info("Task processing completed", { taskId, processingTimeMs: processingTime });
    } catch (error) {
      logger.error("Failed to mark processing completed", error instanceof Error ? error : new Error(String(error)), { taskId });
      throw new Error("Failed to update task status");
    }
  }

  /**
   * Mark a task as processing failed
   */
  async markProcessingFailed(taskId: string, errorMessage: string): Promise<void> {
    try {
      await this.db.queueRepository.updateStatus(taskId, "FAILED", errorMessage);
      
      logger.error("Task processing failed", undefined, { taskId, errorMessage });
    } catch (error) {
      logger.error("Failed to mark processing failed", error instanceof Error ? error : new Error(String(error)), { taskId });
      throw new Error("Failed to update task status");
    }
  }

  /**
   * Check if more tasks can be processed (concurrency limit)
   */
  async canProcessMore(): Promise<boolean> {
    try {
      const currentProcessing = await this.getCurrentProcessingCount();
      return currentProcessing < this.options.maxConcurrency;
    } catch (error) {
      logger.error("Failed to check processing capacity", error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Get the current number of processing tasks
   */
  async getCurrentProcessingCount(): Promise<number> {
    try {
      const stats = await this.db.queueRepository.getQueueStats();
      return stats.currentlyProcessing;
    } catch (error) {
      logger.error("Failed to get current processing count", error instanceof Error ? error : new Error(String(error)));
      return 0;
    }
  }

  /**
   * Get queue depth by priority
   */
  async getQueueDepthByPriority(): Promise<Record<QueuePriority, number>> {
    try {
      // This would require a more complex query - for now, return a simple implementation
      const stats = await this.db.queueRepository.getQueueStats();
      
      return {
        high: 0,
        normal: stats.totalQueued,
        batch: 0
      };
    } catch (error) {
      logger.error("Failed to get queue depth by priority", error instanceof Error ? error : new Error(String(error)));
      return { high: 0, normal: 0, batch: 0 };
    }
  }

  /**
   * Clean up old completed/failed tasks
   */
  async cleanupOldTasks(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - olderThanMs);
      
      // This would require a cleanup method in the repository
      // For now, return 0 as a placeholder
      logger.info("Cleaning up old tasks", { cutoffDate });
      return 0;
    } catch (error) {
      logger.error("Failed to cleanup old tasks", error instanceof Error ? error : new Error(String(error)));
      return 0;
    }
  }

  /**
   * Get average processing time for capacity planning
   */
  async getAverageProcessingTime(): Promise<number> {
    try {
      const stats = await this.db.queueRepository.getQueueStats();
      return stats.averageProcessingTimeMs;
    } catch (error) {
      logger.error("Failed to get average processing time", error instanceof Error ? error : new Error(String(error)));
      return 30000; // Default to 30 seconds
    }
  }

  /**
   * Register event handler
   */
  addEventListener(eventType: string, handler: (event: any) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Remove event handler
   */
  removeEventListener(eventType: string, handler: (event: any) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit domain event
   */
  private async emitEvent(event: any): Promise<void> {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error) {
          logger.error("Event handler failed", error instanceof Error ? error : new Error(String(error)), { 
            eventType: event.type 
          });
        }
      }
    }
  }

  /**
   * Map priority string to numeric value
   */
  private mapPriorityToValue(priority: QueuePriority): Priority {
    switch (priority) {
      case "high":
        return 1;
      case "normal":
        return 2;
      case "batch":
        return 3;
      default:
        return this.options.defaultPriority;
    }
  }

  /**
   * Map numeric priority to string
   */
  private mapValueToPriority(value: Priority): QueuePriority {
    switch (value) {
      case 1:
        return "high";
      case 2:
        return "normal";
      case 3:
        return "batch";
      default:
        return "normal";
    }
  }

  /**
   * Get system health metrics
   */
  async getHealthMetrics(): Promise<{
    healthy: boolean;
    queueDepth: number;
    processingCapacity: number;
    averageWaitTime: number;
    errorRate: number;
  }> {
    try {
      const stats = await this.getQueueStatistics();
      const canProcess = await this.canProcessMore();
      
      return {
        healthy: canProcess && stats.totalQueued < 100, // Arbitrary threshold
        queueDepth: stats.totalQueued,
        processingCapacity: this.options.maxConcurrency,
        averageWaitTime: stats.averageWaitTimeMs,
        errorRate: 0 // Would need to calculate from historical data
      };
    } catch (error) {
      logger.error("Failed to get health metrics", error instanceof Error ? error : new Error(String(error)));
      return {
        healthy: false,
        queueDepth: 0,
        processingCapacity: this.options.maxConcurrency,
        averageWaitTime: 0,
        errorRate: 1
      };
    }
  }
}