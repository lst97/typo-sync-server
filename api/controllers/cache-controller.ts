import { Context } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { CacheService } from "../services/cache-service.ts";

export class CacheController {
  constructor(private cacheService: CacheService) {}

  /**
   * Get cache statistics
   * GET /cache/stats
   */
  async getCacheStats(ctx: Context): Promise<void> {
    try {
      const stats = await this.cacheService.getStats();
      const memoryUsage = await this.cacheService.getMemoryUsage();
      
      ctx.response.body = {
        total_cached_results: memoryUsage.l1ItemCount + memoryUsage.l2ItemCount,
        cache_hit_rate: stats.totalHitRate,
        total_cache_size_mb: Math.round((memoryUsage.l1SizeBytes + memoryUsage.l2SizeBytes) / (1024 * 1024) * 100) / 100,
        l1_cache: {
          hit_count: stats.l1HitCount,
          miss_count: stats.l1MissCount,
          hit_rate: stats.l1HitRate,
          item_count: memoryUsage.l1ItemCount,
          size_mb: Math.round(memoryUsage.l1SizeBytes / (1024 * 1024) * 100) / 100
        },
        l2_cache: {
          hit_count: stats.l2HitCount,
          miss_count: stats.l2MissCount,
          hit_rate: stats.l2HitRate,
          item_count: memoryUsage.l2ItemCount,
          size_mb: Math.round(memoryUsage.l2SizeBytes / (1024 * 1024) * 100) / 100
        },
        l3_cache: {
          hit_count: stats.l3HitCount,
          miss_count: stats.l3MissCount,
          hit_rate: stats.l3HitRate
        }
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to get cache stats", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Get cached result by audio hash
   * GET /cache/:audioHash
   */
  async getCachedResult(ctx: Context & { params: { audioHash: string } }): Promise<void> {
    try {
      const audioHash = ctx.params.audioHash;
      
      if (!audioHash) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Audio hash is required" };
        return;
      }
      
      const result = await this.cacheService.get(audioHash);
      
      if (!result) {
        ctx.response.status = 404;
        ctx.response.body = { error: "Cached result not found" };
        return;
      }
      
      ctx.response.body = {
        audio_hash: audioHash,
        result: result,
        cached_at: new Date().toISOString()
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to get cached result", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Invalidate cache entry
   * DELETE /cache/:audioHash
   */
  async invalidateCache(ctx: Context & { params: { audioHash: string } }): Promise<void> {
    try {
      const audioHash = ctx.params.audioHash;
      
      if (!audioHash) {
        ctx.response.status = 400;
        ctx.response.body = { error: "Audio hash is required" };
        return;
      }
      
      await this.cacheService.invalidate(audioHash);
      
      ctx.response.body = {
        message: "Cache entry invalidated successfully",
        audio_hash: audioHash
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to invalidate cache", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Clear all cache levels
   * DELETE /cache/all
   */
  async clearAllCache(ctx: Context): Promise<void> {
    try {
      await this.cacheService.clearL1Cache();
      await this.cacheService.clearL2Cache();
      
      ctx.response.body = {
        message: "All cache levels cleared successfully"
      };
      
      ctx.response.status = 200;
    } catch (error) {
      logger.error("Failed to clear cache", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Warm cache with frequently accessed items
   * POST /cache/warm
   */
  async warmCache(ctx: Context): Promise<void> {
    try {
      await this.cacheService.warmCache();
      
      ctx.response.body = {
        message: "Cache warming initiated successfully"
      };
      
      ctx.response.status = 202; // Accepted
    } catch (error) {
      logger.error("Failed to warm cache", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }

  /**
   * Get cache health status
   * GET /cache/health
   */
  async getCacheHealth(ctx: Context): Promise<void> {
    try {
      const stats = await this.cacheService.getStats();
      const memoryUsage = await this.cacheService.getMemoryUsage();
      
      const isHealthy = stats.totalHitRate > 0.1 && memoryUsage.l1SizeBytes < 100 * 1024 * 1024; // 100MB limit
      
      ctx.response.body = {
        healthy: isHealthy,
        hit_rate: stats.totalHitRate,
        memory_usage_mb: Math.round((memoryUsage.l1SizeBytes + memoryUsage.l2SizeBytes) / (1024 * 1024) * 100) / 100,
        total_items: memoryUsage.l1ItemCount + memoryUsage.l2ItemCount
      };
      
      ctx.response.status = isHealthy ? 200 : 503;
    } catch (error) {
      logger.error("Failed to get cache health", error instanceof Error ? error : new Error(String(error)));
      ctx.response.status = 500;
      ctx.response.body = { error: "Internal server error" };
    }
  }
}