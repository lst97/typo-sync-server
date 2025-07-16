import { assertEquals, assertExists } from "../deps.ts";
import { CacheService } from "../services/cache-service.ts";
import { DatabaseService } from "../services/database-service.ts";
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

Deno.test("CacheService - basic functionality", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "" }); // No Redis for tests

	const testHash = "test_hash_123";
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

	// Check stats
	const stats = await cacheService.getStats();
	assertEquals(stats.l1HitCount, 1);
	assertEquals(stats.l1MissCount, 1);
	assertEquals(stats.l1HitRate, 0.5);

	await db.close();
});

Deno.test("CacheService - memory management", async () => {
	const db = await createTestDatabase();
	const cacheService = new CacheService(db, { redisUrl: "", l1MaxSize: 5 });

	const testResult = createTestAnalysisResult();

	// Fill cache
	for (let i = 0; i < 5; i++) {
		await cacheService.set(`hash_${i}`, testResult);
	}

	// Check memory usage
	const memoryUsage = await cacheService.getMemoryUsage();
	assertEquals(memoryUsage.l1ItemCount, 5);
	assertEquals(memoryUsage.l1SizeBytes > 0, true);

	await db.close();
});

Deno.test("CacheService - invalidation", async () => {
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

	await db.close();
});
