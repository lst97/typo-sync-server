import { ulid, connectRedis, type Redis } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import type { TaskResultResponse, AnalysisResult } from "../types/schemas.ts";

export interface TaskManager {
  createTask(): string;
  setTaskStatus(taskId: string, status: TaskResultResponse): Promise<void>;
  getTaskStatus(taskId: string): Promise<TaskResultResponse | null>;
  deleteTask(taskId: string): Promise<void>;
}

export class InMemoryTaskManager implements TaskManager {
  private tasks = new Map<string, TaskResultResponse>();

  createTask(): string {
    const taskId = ulid();
    this.tasks.set(taskId, {
      state: "PENDING",
      status: "Processing...",
    });
    logger.debug("Created in-memory task", { taskId });
    return taskId;
  }

  async setTaskStatus(taskId: string, status: TaskResultResponse): Promise<void> {
    this.tasks.set(taskId, status);
    logger.debug("Updated task status", { taskId, state: status.state });
  }

  async getTaskStatus(taskId: string): Promise<TaskResultResponse | null> {
    const status = this.tasks.get(taskId) || null;
    logger.debug("Retrieved task status", { taskId, found: !!status });
    return status;
  }

  async deleteTask(taskId: string): Promise<void> {
    const deleted = this.tasks.delete(taskId);
    logger.debug("Deleted task", { taskId, deleted });
  }
}

export class RedisTaskManager implements TaskManager {
  private redis: Redis | null = null;
  private readonly keyPrefix = "typosync:task:";
  private readonly ttl = 3600; // 1 hour TTL

  async connect(): Promise<void> {
    if (!config.config.redis_url) {
      throw new Error("Redis URL not configured");
    }

    try {
      const url = this.parseRedisUrl();
      this.redis = await connectRedis({
        hostname: url.hostname,
        port: url.port,
        db: url.db,
      });
      logger.info("Connected to Redis");
    } catch (error) {
      logger.error("Failed to connect to Redis", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private parseRedisUrl() {
    const url = new URL(config.config.redis_url!);
    return {
      hostname: url.hostname,
      port: parseInt(url.port) || 6379,
      db: parseInt(url.pathname.slice(1)) || 0,
    };
  }

  private getKey(taskId: string): string {
    return `${this.keyPrefix}${taskId}`;
  }

  createTask(): string {
    const taskId = ulid();
    // Note: We'll set the initial status in the first setTaskStatus call
    logger.debug("Created Redis task", { taskId });
    return taskId;
  }

  async setTaskStatus(taskId: string, status: TaskResultResponse): Promise<void> {
    if (!this.redis) {
      throw new Error("Redis not connected");
    }

    const key = this.getKey(taskId);
    const value = JSON.stringify(status);
    
    await this.redis.setex(key, this.ttl, value);
    logger.debug("Updated Redis task status", { taskId, state: status.state });
  }

  async getTaskStatus(taskId: string): Promise<TaskResultResponse | null> {
    if (!this.redis) {
      throw new Error("Redis not connected");
    }

    const key = this.getKey(taskId);
    const value = await this.redis.get(key);
    
    if (!value) {
      logger.debug("Task not found in Redis", { taskId });
      return null;
    }

    try {
      const status = JSON.parse(value) as TaskResultResponse;
      logger.debug("Retrieved Redis task status", { taskId, state: status.state });
      return status;
    } catch (error) {
      logger.error("Failed to parse task status from Redis", error instanceof Error ? error : new Error(String(error)), { taskId });
      return null;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    if (!this.redis) {
      throw new Error("Redis not connected");
    }

    const key = this.getKey(taskId);
    const deleted = await this.redis.del(key);
    logger.debug("Deleted Redis task", { taskId, deleted: deleted > 0 });
  }

  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      logger.info("Disconnected from Redis");
    }
  }
}

// Task manager factory
export async function createTaskManager(): Promise<TaskManager> {
  if (config.redisEnabled) {
    const redisManager = new RedisTaskManager();
    await redisManager.connect();
    return redisManager;
  } else {
    return new InMemoryTaskManager();
  }
}