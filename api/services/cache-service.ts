import { connectRedis, Redis } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import { DatabaseService } from "./database-service.ts";
import {
	AudioFingerprint,
	AnalysisCache,
	CacheHitEvent,
} from "../types/domain.ts";
import { AnalysisInfo, AnalysisResult } from "../types/schemas.ts";

import { DomainEvent } from "../types/domain.ts";

type CacheEvent = DomainEvent;

export interface CacheServiceOptions {
	l1MaxSize?: number;
	l1TtlMs?: number;
	l2TtlMs?: number;
	l3TtlMs?: number;
	redisUrl?: string;
}

export interface CacheStats {
	l1HitCount: number;
	l1MissCount: number;
	l1HitRate: number;
	l2HitCount: number;
	l2MissCount: number;
	l2HitRate: number;
	l3HitCount: number;
	l3MissCount: number;
	l3HitRate: number;
	totalHitCount: number;
	totalMissCount: number;
	totalHitRate: number;
}

export interface CacheMemoryUsage {
	l1SizeBytes: number;
	l1ItemCount: number;
	l2SizeBytes: number;
	l2ItemCount: number;
}

interface CacheEntry {
	data: AnalysisResult;
	timestamp: number;
	accessCount: number;
	lastAccessed: number;
}

export class CacheService {
	private db: DatabaseService;
	private options: Required<CacheServiceOptions>;
	private l1Cache: Map<string, CacheEntry> = new Map();
	private l2Redis: Redis | null = null;
	private stats: CacheStats = {
		l1HitCount: 0,
		l1MissCount: 0,
		l1HitRate: 0,
		l2HitCount: 0,
		l2MissCount: 0,
		l2HitRate: 0,
		l3HitCount: 0,
		l3MissCount: 0,
		l3HitRate: 0,
		totalHitCount: 0,
		totalMissCount: 0,
		totalHitRate: 0,
	};
	private eventHandlers: Map<string, ((event: CacheEvent) => void)[]> =
		new Map();

	constructor(db: DatabaseService, options: CacheServiceOptions = {}) {
		this.db = db;
		this.options = {
			l1MaxSize: options.l1MaxSize ?? 1000,
			l1TtlMs: options.l1TtlMs ?? 15 * 60 * 1000, // 15 minutes
			l2TtlMs: options.l2TtlMs ?? 60 * 60 * 1000, // 1 hour
			l3TtlMs: options.l3TtlMs ?? 24 * 60 * 60 * 1000, // 24 hours
			redisUrl: options.redisUrl ?? config.config.redis_url ?? "",
		};

		this.initializeRedis();
	}

	private async initializeRedis(): Promise<void> {
		if (this.options.redisUrl) {
			try {
				this.l2Redis = connectRedis({
					url: this.options.redisUrl,
				});
				await this.l2Redis.connect();
				logger.info("L2 Redis cache initialized");
			} catch (error) {
				logger.error(
					"Failed to initialize Redis cache",
					error instanceof Error ? error : new Error(String(error))
				);
			}
		}
	}

	/**
	 * Get cached analysis result with multi-tier lookup
	 */
	async get(audioHash: string): Promise<AnalysisResult | null> {
		try {
			// L1 Cache (In-memory)
			const l1Result = this.getL1(audioHash);
			if (l1Result && this.isValidAnalysisResult(l1Result)) {
				this.stats.l1HitCount++;
				this.updateStats();
				await this.emitCacheHit(audioHash, "L1");
				return l1Result;
			}
			if (l1Result && !this.isValidAnalysisResult(l1Result)) {
				logger.warn("Invalid L1 cache result, removing from cache", undefined, {
					audioHash: audioHash.substring(0, 8) + "...",
				});
				this.l1Cache.delete(audioHash);
			}
			this.stats.l1MissCount++;

			// L2 Cache (Redis)
			const l2Result = await this.getL2(audioHash);
			if (l2Result && this.isValidAnalysisResult(l2Result)) {
				this.stats.l2HitCount++;
				this.updateStats();

				// Populate L1 cache
				await this.setL1(audioHash, l2Result);
				await this.emitCacheHit(audioHash, "L2");
				return l2Result;
			}
			if (l2Result && !this.isValidAnalysisResult(l2Result)) {
				logger.warn("Invalid L2 cache result, removing from cache", undefined, {
					audioHash: audioHash.substring(0, 8) + "...",
				});
				if (this.l2Redis) {
					const key = `typosync:cache:l2:${audioHash}`;
					await this.l2Redis.del(key);
				}
			}
			this.stats.l2MissCount++;

			// L3 Cache (Database)
			const l3Result = await this.getL3(audioHash);
			if (l3Result && this.isValidAnalysisResult(l3Result)) {
				this.stats.l3HitCount++;
				this.updateStats();

				// Populate L1 and L2 caches
				await this.setL1(audioHash, l3Result);
				await this.setL2(audioHash, l3Result);
				await this.emitCacheHit(audioHash, "DB");
				return l3Result;
			}
			if (l3Result && !this.isValidAnalysisResult(l3Result)) {
				logger.warn(
					"Invalid L3 cache result, cache may be corrupted",
					undefined,
					{ audioHash: audioHash.substring(0, 8) + "..." }
				);
				// Note: We could implement L3 cache invalidation here if needed
			}
			this.stats.l3MissCount++;

			this.updateStats();
			return null;
		} catch (error) {
			logger.error(
				"Cache get failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioHash }
			);
			return null;
		}
	}

	/**
	 * Set cached analysis result in all tiers
	 */
	async set(audioHash: string, result: AnalysisResult): Promise<void> {
		try {
			// Validate the result before caching
			if (!this.isValidAnalysisResult(result)) {
				logger.error(
					"Attempted to cache invalid analysis result",
					new Error("Invalid analysis result"),
					{
						audioHash: audioHash.substring(0, 8) + "...",
						result: {
							bpm: result.bpm,
							beat_timestamps_length: result.beat_timestamps?.length,
							melody_map_length: result.melody_map?.length,
							analysis_info: result.analysis_info,
						},
					}
				);
				return;
			}

			// Set in all cache tiers
			await this.setL1(audioHash, result);
			await this.setL2(audioHash, result);

			// For L3, we need to find the audio fingerprint first
			const fingerprint = await this.findFingerprintByHash(audioHash);
			if (fingerprint) {
				await this.setL3(fingerprint.id!, result);
			}

			logger.debug("Cache set successful", {
				audioHash: audioHash.substring(0, 8) + "...",
			});
		} catch (error) {
			logger.error(
				"Cache set failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioHash }
			);
		}
	}

	/**
	 * L1 Cache operations (In-memory)
	 */
	private getL1(audioHash: string): AnalysisResult | null {
		const entry = this.l1Cache.get(audioHash);
		if (!entry) return null;

		// Check TTL
		if (Date.now() - entry.timestamp > this.options.l1TtlMs) {
			this.l1Cache.delete(audioHash);
			return null;
		}

		// Update access statistics
		entry.accessCount++;
		entry.lastAccessed = Date.now();

		return entry.data;
	}

	private setL1(audioHash: string, result: AnalysisResult): void {
		// Check if cache is full and evict LRU item
		if (this.l1Cache.size >= this.options.l1MaxSize) {
			this.evictLRU();
		}

		const entry: CacheEntry = {
			data: result,
			timestamp: Date.now(),
			accessCount: 1,
			lastAccessed: Date.now(),
		};

		this.l1Cache.set(audioHash, entry);
	}

	/**
	 * L2 Cache operations (Redis)
	 */
	private async getL2(audioHash: string): Promise<AnalysisResult | null> {
		if (!this.l2Redis) return null;

		try {
			const key = `typosync:cache:l2:${audioHash}`;
			const value = await this.l2Redis.get(key);

			if (value) {
				return JSON.parse(value);
			}

			return null;
		} catch (error) {
			logger.error(
				"L2 cache get failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioHash }
			);
			return null;
		}
	}

	async setL2(audioHash: string, result: AnalysisResult): Promise<void> {
		if (!this.l2Redis) return;

		try {
			const key = `typosync:cache:l2:${audioHash}`;
			const value = JSON.stringify(result);
			const ttlSeconds = Math.floor(this.options.l2TtlMs / 1000);

			await this.l2Redis.setEx(key, ttlSeconds, value);
		} catch (error) {
			logger.error(
				"L2 cache set failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioHash }
			);
		}
	}

	/**
	 * L3 Cache operations (Database)
	 */
	private async getL3(audioHash: string): Promise<AnalysisResult | null> {
		try {
			const fingerprint = await this.findFingerprintByHash(audioHash);
			if (!fingerprint) return null;

			const cache = await this.db.cacheRepository.findByFingerprint(
				fingerprint.id!
			);
			if (!cache) return null;

			// Check TTL
			if (cache.isExpired(this.options.l3TtlMs / (24 * 60 * 60 * 1000))) {
				return null;
			}

			// Update access statistics
			await this.db.cacheRepository.updateAccessStats(cache.id!);

			return {
				bpm: cache.bpm,
				beat_timestamps: cache.beatTimestamps,
				melody_map: cache.melodyMap,
				analysis_info: cache.analysisInfo,
			};
		} catch (error) {
			logger.error(
				"L3 cache get failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioHash }
			);
			return null;
		}
	}

	async setL3(
		audioFingerprintId: string,
		result: AnalysisResult
	): Promise<void> {
		try {
			// Validate the result has required fields
			if (!this.isValidAnalysisResult(result)) {
				logger.error(
					"Invalid analysis result for L3 cache",
					new Error("Invalid analysis result for L3 cache"),
					{
						audioFingerprintId,
						result: {
							bpm: result.bpm,
							beat_timestamps_length: result.beat_timestamps?.length,
							melody_map_length: result.melody_map?.length,
							analysis_info: result.analysis_info,
						},
					}
				);
				return;
			}

			const cache = new AnalysisCache({
				audioFingerprintId,
				bpm: result.bpm,
				beatTimestamps: result.beat_timestamps,
				melodyMap: result.melody_map,
				analysisInfo: result.analysis_info,
				algorithmVersion: "1.0",
			});

			await this.db.cacheRepository.save(cache);
		} catch (error) {
			logger.error(
				"L3 cache set failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioFingerprintId }
			);
		}
	}

	/**
	 * Cache management operations
	 */
	async invalidate(audioHash: string): Promise<void> {
		try {
			// Remove from L1
			this.l1Cache.delete(audioHash);

			// Remove from L2
			if (this.l2Redis) {
				const key = `typosync:cache:l2:${audioHash}`;
				await this.l2Redis.del(key);
			}

			// Remove from L3 (find and delete)
			const fingerprint = await this.findFingerprintByHash(audioHash);
			if (fingerprint) {
				const cache = await this.db.cacheRepository.findByFingerprint(
					fingerprint.id!
				);
				if (cache) {
					// Note: In a real implementation, you'd add a delete method to the repository
					logger.debug("L3 cache invalidation requested", { audioHash });
				}
			}

			logger.debug("Cache invalidated", { audioHash });
		} catch (error) {
			logger.error(
				"Cache invalidation failed",
				error instanceof Error ? error : new Error(String(error)),
				{ audioHash }
			);
		}
	}

	clearL1Cache(): void {
		this.l1Cache.clear();
		logger.debug("L1 cache cleared");
	}

	async clearL2Cache(): Promise<void> {
		if (this.l2Redis) {
			try {
				const keys = await this.l2Redis.keys("typosync:cache:l2:*");
				if (keys.length > 0) {
					for (const key of keys) {
						await this.l2Redis.del(key);
					}
				}
				logger.debug("L2 cache cleared");
			} catch (error) {
				logger.error(
					"L2 cache clear failed",
					error instanceof Error ? error : new Error(String(error))
				);
			}
		}
	}

	/**
	 * Cache warming - preload frequently accessed items
	 */
	async warmCache(): Promise<void> {
		try {
			// Get most frequently accessed items from L3
			const cutoffDate = new Date(Date.now() - this.options.l3TtlMs);
			const recentCaches = await this.db.cacheRepository.cleanupExpired(
				cutoffDate
			);

			// This would need a method to get recent/frequent items
			// For now, we'll just log the warming attempt
			logger.info("Cache warming initiated", { recentCaches });
		} catch (error) {
			logger.error(
				"Cache warming failed",
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}

	/**
	 * Cache cleanup and memory management
	 */
	async cleanup(): Promise<void> {
		try {
			// Clean up expired L1 entries
			const now = Date.now();
			for (const [key, entry] of this.l1Cache.entries()) {
				if (now - entry.timestamp > this.options.l1TtlMs) {
					this.l1Cache.delete(key);
				}
			}

			// Clean up expired L3 entries
			const cutoffDate = new Date(Date.now() - this.options.l3TtlMs);
			const deletedCount = await this.db.cacheRepository.cleanupExpired(
				cutoffDate
			);

			logger.debug("Cache cleanup completed", {
				l1Size: this.l1Cache.size,
				l3Deleted: deletedCount,
			});
		} catch (error) {
			logger.error(
				"Cache cleanup failed",
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}

	/**
	 * Statistics and monitoring
	 */
	getStats(): CacheStats {
		return { ...this.stats };
	}

	async getMemoryUsage(): Promise<CacheMemoryUsage> {
		try {
			// Calculate L1 memory usage
			const l1SizeBytes = this.estimateL1Size();

			// L2 memory usage would need Redis INFO command
			let l2SizeBytes = 0;
			let l2ItemCount = 0;

			if (this.l2Redis) {
				try {
					const keys = await this.l2Redis.keys("typosync:cache:l2:*");
					l2ItemCount = keys.length;
					l2SizeBytes = keys.length * 1024; // Rough estimate
				} catch (error) {
					logger.error(
						"Failed to get L2 memory usage",
						error instanceof Error ? error : new Error(String(error))
					);
				}
			}

			return {
				l1SizeBytes,
				l1ItemCount: this.l1Cache.size,
				l2SizeBytes,
				l2ItemCount,
			};
		} catch (error) {
			logger.error(
				"Failed to get memory usage",
				error instanceof Error ? error : new Error(String(error))
			);
			return {
				l1SizeBytes: 0,
				l1ItemCount: 0,
				l2SizeBytes: 0,
				l2ItemCount: 0,
			};
		}
	}

	/**
	 * Helper methods
	 */
	private isValidAnalysisResult(result: AnalysisResult): boolean {
		// Check required fields exist and are valid
		if (!result || typeof result !== "object") {
			return false;
		}

		// BPM must be a positive number
		if (
			typeof result.bpm !== "number" ||
			result.bpm <= 0 ||
			!isFinite(result.bpm)
		) {
			return false;
		}

		// Beat timestamps must be an array of numbers
		if (
			!Array.isArray(result.beat_timestamps) ||
			result.beat_timestamps.length === 0
		) {
			return false;
		}

		// All beat timestamps must be valid numbers
		if (
			!result.beat_timestamps.every(
				(ts) => typeof ts === "number" && isFinite(ts)
			)
		) {
			return false;
		}

		// Melody map must be an array
		if (!Array.isArray(result.melody_map)) {
			return false;
		}

		// Each melody note must have required fields
		for (const note of result.melody_map) {
			if (
				!note ||
				typeof note !== "object" ||
				typeof note.pitch !== "string" ||
				typeof note.start_time !== "number" ||
				typeof note.duration !== "number" ||
				!isFinite(note.start_time) ||
				!isFinite(note.duration)
			) {
				return false;
			}
		}

		// Analysis info must be present and valid
		if (!result.analysis_info || typeof result.analysis_info !== "object") {
			return false;
		}

		const info = result.analysis_info as AnalysisInfo;
		const requiredFields = [
			"total_beats",
			"total_subdivisions",
			"consolidated_notes",
			"filtered_notes",
			"min_note_duration",
			"subdivision_factor",
		];

		for (const field of requiredFields) {
			if (
				typeof info[field as keyof AnalysisInfo] !== "number" ||
				!isFinite(info[field as keyof AnalysisInfo])
			) {
				return false;
			}
		}

		return true;
	}

	private evictLRU(): void {
		if (this.l1Cache.size === 0) return;

		let lruKey = "";
		let lruTime = Date.now();

		for (const [key, entry] of this.l1Cache.entries()) {
			if (entry.lastAccessed < lruTime) {
				lruTime = entry.lastAccessed;
				lruKey = key;
			}
		}

		if (lruKey) {
			this.l1Cache.delete(lruKey);
			logger.debug("Evicted LRU cache entry", {
				key: lruKey.substring(0, 8) + "...",
			});
		}
	}

	private estimateL1Size(): number {
		// Rough estimate of memory usage
		let totalSize = 0;
		for (const [key, entry] of this.l1Cache.entries()) {
			totalSize += key.length * 2; // UTF-16 characters
			totalSize += JSON.stringify(entry.data).length * 2;
			totalSize += 64; // Overhead for entry metadata
		}
		return totalSize;
	}

	private async findFingerprintByHash(
		audioHash: string
	): Promise<AudioFingerprint | null> {
		return await this.db.audioRepository.findByContentHash(audioHash);
	}

	private updateStats(): void {
		this.stats.totalHitCount =
			this.stats.l1HitCount + this.stats.l2HitCount + this.stats.l3HitCount;
		this.stats.totalMissCount =
			this.stats.l1MissCount + this.stats.l2MissCount + this.stats.l3MissCount;

		const totalRequests = this.stats.totalHitCount + this.stats.totalMissCount;
		this.stats.totalHitRate =
			totalRequests > 0 ? this.stats.totalHitCount / totalRequests : 0;

		const l1Requests = this.stats.l1HitCount + this.stats.l1MissCount;
		this.stats.l1HitRate =
			l1Requests > 0 ? this.stats.l1HitCount / l1Requests : 0;

		const l2Requests = this.stats.l2HitCount + this.stats.l2MissCount;
		this.stats.l2HitRate =
			l2Requests > 0 ? this.stats.l2HitCount / l2Requests : 0;

		const l3Requests = this.stats.l3HitCount + this.stats.l3MissCount;
		this.stats.l3HitRate =
			l3Requests > 0 ? this.stats.l3HitCount / l3Requests : 0;
	}

	private async emitCacheHit(
		audioHash: string,
		level: "L1" | "L2" | "DB"
	): Promise<void> {
		const event = new CacheHitEvent({
			audioHash,
			cacheLevel: level,
		});

		await this.emitEvent(event);
	}

	private async emitEvent(event: CacheEvent): Promise<void> {
		const handlers = this.eventHandlers.get(event.type);
		if (handlers) {
			for (const handler of handlers) {
				try {
					await handler(event);
				} catch (error) {
					logger.error(
						"Cache event handler failed",
						error instanceof Error ? error : new Error(String(error)),
						{
							eventType: event.type,
						}
					);
				}
			}
		}
	}

	addEventListener(
		eventType: string,
		handler: (event: CacheEvent) => void
	): void {
		if (!this.eventHandlers.has(eventType)) {
			this.eventHandlers.set(eventType, []);
		}
		this.eventHandlers.get(eventType)!.push(handler);
	}

	removeEventListener(
		eventType: string,
		handler: (event: CacheEvent) => void
	): void {
		const handlers = this.eventHandlers.get(eventType);
		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index >= 0) {
				handlers.splice(index, 1);
			}
		}
	}

	async close(): Promise<void> {
		if (this.l2Redis) {
			try {
				await this.l2Redis.quit();
			} catch (error) {
				logger.warn(
					"Error closing Redis connection",
					error instanceof Error ? error : new Error(String(error))
				);
			}
			this.l2Redis = null;
		}

		this.clearL1Cache();
		logger.info("Cache service closed");
	}
}
