import { assertEquals, assertExists } from "../deps.ts";
import { CacheService } from "../services/cache-service.ts";
import { DatabaseService } from "../services/database-service.ts";
import { AudioFingerprint } from "../types/domain.ts";
import { AnalysisResult } from "../types/schemas.ts";

async function createTestDatabase(): Promise<DatabaseService> {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();
	return db;
}

function createTestAnalysisResult(): AnalysisResult {
	return {
		bpm: 120.0,
		beat_timestamps: [0.0, 0.5, 1.0, 1.5, 2.0],
		melody_map: [
			{ pitch: "C4", start_time: 0.0, duration: 0.5 },
			{ pitch: "D4", start_time: 0.5, duration: 0.5 },
			{ pitch: "E4", start_time: 1.0, duration: 0.5 },
		],
		analysis_info: {
			total_beats: 4,
			total_subdivisions: 8,
			consolidated_notes: 3,
			filtered_notes: 3,
			min_note_duration: 0.05,
			subdivision_factor: 2,
		},
	};
}

async function cleanupResources(
	db: DatabaseService,
	cache: CacheService
): Promise<void> {
	try {
		await cache.close();
	} catch (error) {
		console.warn("Error closing cache service:", error);
	}
	try {
		await db.close();
	} catch (error) {
		console.warn("Error closing database:", error);
	}
	// Give time for all async operations to complete
	await new Promise((resolve) => setTimeout(resolve, 100));
}

Deno.test("CacheService - basic functionality (L1 cache)", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" }); // No Redis for tests

	const testHash = "test_content_hash_123";
	const testResult = createTestAnalysisResult();

	// Initially should be cache miss
	const miss = await cacheService.get(testHash);
	assertEquals(miss, null);

	// Set cache
	await cacheService.set(testHash, testResult);

	// Should now be cache hit
	const hit = await cacheService.get(testHash);
	assertExists(hit);
	assertEquals(hit.bpm, testResult.bpm);
	assertEquals(hit.melody_map.length, testResult.melody_map.length);

	// Should be L1 cache hit with proper stats
	const stats = await cacheService.getStats();
	assertEquals(stats.l1HitCount, 1);
	assertEquals(stats.l1MissCount, 1);
	assertEquals(stats.l1HitRate, 0.5);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - L2 cache (Redis) - graceful fallback", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" }); // Don't try to connect to Redis

	const testHash = "test_redis_hash_456";
	const testResult = createTestAnalysisResult();

	// Set cache (will use L1 since Redis is disabled)
	await cacheService.set(testHash, testResult);

	// Should get result from L1
	const hit = await cacheService.get(testHash);
	assertExists(hit);
	assertEquals(hit.bpm, testResult.bpm);

	// Check that cache is working
	const stats = await cacheService.getStats();
	assertEquals(stats.totalHitCount >= 1, true);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - L3 cache (Database)", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" });

	// Create audio fingerprint first
	const fingerprint = new AudioFingerprint({
		contentHash: "test_db_hash_789",
		perceptualHash: "test_perceptual_hash",
		metadataHash: "test_metadata_hash",
		fileSize: 1024,
		durationSeconds: 30.0,
		format: "mp3",
	});

	const savedFingerprint = await db.audioRepository.save(fingerprint);
	const testResult = createTestAnalysisResult();

	// Clear L1 cache to test L3
	await cacheService.clearL1Cache();

	// Set in database directly
	await cacheService.setL3(savedFingerprint.id!, testResult);

	// Should hit L3 cache
	const hit = await cacheService.get(savedFingerprint.contentHash);
	assertExists(hit);
	assertEquals(hit.bpm, testResult.bpm);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - cache hierarchy", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" });

	// Create audio fingerprint
	const fingerprint = new AudioFingerprint({
		contentHash: "test_hierarchy_hash",
		perceptualHash: "test_perceptual_hash",
		metadataHash: "test_metadata_hash",
		fileSize: 1024,
		durationSeconds: 30.0,
		format: "mp3",
	});

	const savedFingerprint = await db.audioRepository.save(fingerprint);
	const testResult = createTestAnalysisResult();

	// Set in database (L3) first
	await cacheService.setL3(savedFingerprint.id!, testResult);

	// First get should hit L3 and populate L1
	const hit1 = await cacheService.get(savedFingerprint.contentHash);
	assertExists(hit1);

	// Second get should hit L1 (fastest)
	const hit2 = await cacheService.get(savedFingerprint.contentHash);
	assertExists(hit2);

	// Check that we got the same result both times
	assertEquals(hit1.bpm, hit2.bpm);
	assertEquals(hit1.melody_map.length, hit2.melody_map.length);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - TTL expiration", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { l1TtlMs: 100, redisUrl: "" }); // 100ms TTL

	const testHash = "test_ttl_hash";
	const testResult = createTestAnalysisResult();

	// Set cache directly to L1 only (avoid L2/L3)
	await cacheService.set(testHash, testResult);

	// Should be available immediately
	const hit1 = await cacheService.get(testHash);
	assertExists(hit1);

	// Clear L2/L3 to ensure we're only testing L1 TTL
	await cacheService.clearL2Cache();

	// Wait for TTL expiration
	await new Promise((resolve) => setTimeout(resolve, 150));

	// Should now be expired from L1
	const hit2 = await cacheService.get(testHash);
	// Since there's no L2/L3 for this hash, should be null
	assertEquals(hit2, null);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - LRU eviction", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { l1MaxSize: 2, redisUrl: "" }); // Max 2 items

	const testResult = createTestAnalysisResult();

	// Fill cache to capacity
	await cacheService.set("hash1", testResult);
	const usage1 = await cacheService.getMemoryUsage();
	console.log(`After set hash1: L1 size = ${usage1.l1ItemCount}`);

	// Add delay to ensure different timestamps
	await new Promise((resolve) => setTimeout(resolve, 5));

	await cacheService.set("hash2", testResult);
	const usage2 = await cacheService.getMemoryUsage();
	console.log(`After set hash2: L1 size = ${usage2.l1ItemCount}`);

	// Add delay to ensure different timestamps
	await new Promise((resolve) => setTimeout(resolve, 5));

	// Access hash1 to make it recently used
	const hash1First = await cacheService.get("hash1");
	assertExists(hash1First);
	const usage3 = await cacheService.getMemoryUsage();
	console.log(`After get hash1: L1 size = ${usage3.l1ItemCount}`);

	// Add a longer delay to ensure timestamps are different
	await new Promise((resolve) => setTimeout(resolve, 10));

	// Add third item, should evict hash2 (least recently used)
	await cacheService.set("hash3", testResult);
	const usage4 = await cacheService.getMemoryUsage();
	console.log(`After set hash3: L1 size = ${usage4.l1ItemCount}`);

	// hash1 should still be available
	const hit1 = await cacheService.get("hash1");

	assertExists(hit1);

	// Check memory usage is within limits
	const memoryUsage = await cacheService.getMemoryUsage();
	console.log(`Final L1 size = ${memoryUsage.l1ItemCount}, should be <= 2`);
	assertEquals(memoryUsage.l1ItemCount <= 2, true);

	// hash3 should be available
	const hit3 = await cacheService.get("hash3");
	assertExists(hit3);

	// hash2 should be evicted
	const hit2 = await cacheService.get("hash2");
	assertEquals(hit2, null);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - cache statistics", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" });

	const testResult = createTestAnalysisResult();

	// Initial stats
	const initialStats = await cacheService.getStats();
	assertEquals(initialStats.l1HitCount, 0);
	assertEquals(initialStats.l1MissCount, 0);

	// Cache miss
	await cacheService.get("nonexistent_hash");

	// Cache set and hit
	await cacheService.set("test_hash", testResult);
	await cacheService.get("test_hash");

	// Check updated stats
	const finalStats = await cacheService.getStats();
	assertEquals(finalStats.l1HitCount, 1);
	assertEquals(finalStats.l1MissCount, 1);
	assertEquals(finalStats.l1HitRate, 0.5);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - cache warming", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" });

	// Create multiple fingerprints with cached results
	const fingerprints = [];
	for (let i = 0; i < 3; i++) {
		const fingerprint = new AudioFingerprint({
			contentHash: `hash_${i}`,
			perceptualHash: `perceptual_${i}`,
			metadataHash: `metadata_${i}`,
			fileSize: 1024,
			durationSeconds: 30.0,
			format: "mp3",
		});

		const saved = await db.audioRepository.save(fingerprint);
		fingerprints.push(saved);

		// Store in L3 cache
		await cacheService.setL3(saved.id!, createTestAnalysisResult());
	}

	// Clear L1 cache to test warming
	await cacheService.clearL1Cache();

	// Warm the cache by accessing items (simulating warming)
	for (const fingerprint of fingerprints) {
		const result = await cacheService.get(fingerprint.contentHash);
		assertExists(result);
	}

	const stats = await cacheService.getStats();
	assertEquals(stats.l3HitCount, 3); // Should hit L3 cache first

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - cache invalidation", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" });

	const testHash = "test_invalidation_hash";
	const testResult = createTestAnalysisResult();

	// Set cache
	await cacheService.set(testHash, testResult);

	// Should be available
	const hit1 = await cacheService.get(testHash);
	assertExists(hit1);

	// Invalidate
	await cacheService.invalidate(testHash);

	// Should no longer be available
	const hit2 = await cacheService.get(testHash);
	assertEquals(hit2, null);

	await cleanupResources(db, cacheService);
});

Deno.test("CacheService - memory management", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" });

	const testResult = createTestAnalysisResult();

	// Fill cache with multiple items
	for (let i = 0; i < 10; i++) {
		await cacheService.set(`hash_${i}`, testResult);
	}

	// Check memory usage
	const memoryUsage = await cacheService.getMemoryUsage();
	assertEquals(memoryUsage.l1SizeBytes > 0, true);
	assertEquals(memoryUsage.l1ItemCount, 10);

	// Clean up memory
	await cacheService.cleanup();

	// Should still have items but within reasonable limits
	const postCleanupMemory = await cacheService.getMemoryUsage();
	assertEquals(postCleanupMemory.l1ItemCount <= 10, true);

	await cleanupResources(db, cacheService);
});
