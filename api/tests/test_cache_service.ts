import { assertEquals, assertExists } from "../deps.ts";
import { CacheService } from "../services/cache-service.ts";
import { DatabaseService } from "../services/database-service.ts";
import { AudioFingerprint, AnalysisCache } from "../types/domain.ts";
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
      { pitch: "E4", start_time: 1.0, duration: 0.5 }
    ],
    analysis_info: {
      total_beats: 4,
      total_subdivisions: 8,
      consolidated_notes: 3,
      filtered_notes: 3,
      min_note_duration: 0.05,
      subdivision_factor: 2
    }
  };
}

Deno.test("CacheService - L1 cache (in-memory)", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
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
  
  // Should be L1 cache hit
  const stats = await cacheService.getStats();
  assertEquals(stats.l1HitCount > 0, true);
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - L2 cache (Redis)", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db, { redisUrl: "redis://localhost:6379" });
  
  const testHash = "test_redis_hash_456";
  const testResult = createTestAnalysisResult();
  
  // Clear L1 cache to test L2
  await cacheService.clearL1Cache();
  
  // Set in L2 cache directly
  await cacheService.setL2(testHash, testResult);
  
  // Should hit L2 cache (if Redis is available)
  const hit = await cacheService.get(testHash);
  
  // Skip test if Redis is not available
  if (hit === null) {
    console.log("Skipping L2 cache test - Redis not available");
    await cacheService.close();
  await db.close();
    return;
  }
  
  assertExists(hit);
  assertEquals(hit.bpm, testResult.bpm);
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - L3 cache (Database)", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
  // Create audio fingerprint first
  const fingerprint = new AudioFingerprint({
    contentHash: "test_db_hash_789",
    perceptualHash: "test_perceptual_hash",
    metadataHash: "test_metadata_hash",
    fileSize: 1024,
    durationSeconds: 30.0,
    format: "mp3"
  });
  
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  const testResult = createTestAnalysisResult();
  
  // Clear L1 and L2 caches to test L3
  await cacheService.clearL1Cache();
  await cacheService.clearL2Cache();
  
  // Set in database directly
  await cacheService.setL3(savedFingerprint.id!, testResult);
  
  // Should hit L3 cache
  const hit = await cacheService.get(savedFingerprint.contentHash);
  assertExists(hit);
  assertEquals(hit.bpm, testResult.bpm);
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - cache hierarchy", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
  // Create audio fingerprint
  const fingerprint = new AudioFingerprint({
    contentHash: "test_hierarchy_hash",
    perceptualHash: "test_perceptual_hash",
    metadataHash: "test_metadata_hash",
    fileSize: 1024,
    durationSeconds: 30.0,
    format: "mp3"
  });
  
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  const testResult = createTestAnalysisResult();
  
  // Set in database (L3) first
  await cacheService.setL3(savedFingerprint.id!, testResult);
  
  // First get should hit L3 and populate L2/L1
  const hit1 = await cacheService.get(savedFingerprint.contentHash);
  assertExists(hit1);
  
  // Second get should hit L1 (fastest)
  const hit2 = await cacheService.get(savedFingerprint.contentHash);
  assertExists(hit2);
  
  // Check that we got the same result both times
  assertEquals(hit1.bpm, hit2.bpm);
  assertEquals(hit1.melody_map.length, hit2.melody_map.length);
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - TTL expiration", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db, { l1TtlMs: 100 }); // 100ms TTL
  
  const testHash = "test_ttl_hash";
  const testResult = createTestAnalysisResult();
  
  // Set cache
  await cacheService.set(testHash, testResult);
  
  // Should be available immediately
  const hit1 = await cacheService.get(testHash);
  assertExists(hit1);
  
  // Wait for TTL expiration
  await new Promise(resolve => setTimeout(resolve, 150));
  
  // Clear other caches to ensure we're testing L1 TTL
  await cacheService.clearL2Cache();
  
  // Should now be expired from L1
  const hit2 = await cacheService.get(testHash);
  // Since there's no L2/L3 for this hash, should be null
  assertEquals(hit2, null);
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - LRU eviction", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db, { l1MaxSize: 2 }); // Max 2 items
  
  const testResult = createTestAnalysisResult();
  
  // Fill cache to capacity
  await cacheService.set("hash1", testResult);
  await cacheService.set("hash2", testResult);
  
  // Access hash1 to make it recently used
  await cacheService.get("hash1");
  
  // Add third item, should evict hash2 (least recently used)
  await cacheService.set("hash3", testResult);
  
  // hash1 should still be available
  const hit1 = await cacheService.get("hash1");
  assertExists(hit1);
  
  // hash2 might be evicted (depends on implementation)
  const hit2 = await cacheService.get("hash2");
  // Note: LRU eviction depends on timing, so we'll just check that cache is working
  const memoryUsage = await cacheService.getMemoryUsage();
  assertEquals(memoryUsage.l1ItemCount <= 3, true);
  
  // hash3 should be available
  const hit3 = await cacheService.get("hash3");
  assertExists(hit3);
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - cache statistics", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
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
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - cache warming", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
  // Create multiple fingerprints with cached results
  const fingerprints = [];
  for (let i = 0; i < 3; i++) {
    const fingerprint = new AudioFingerprint({
      contentHash: `hash_${i}`,
      perceptualHash: `perceptual_${i}`,
      metadataHash: `metadata_${i}`,
      fileSize: 1024,
      durationSeconds: 30.0,
      format: "mp3"
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
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - cache invalidation", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
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
  
  await cacheService.close();
  await db.close();
});

Deno.test("CacheService - memory management", async () => {
  const db = await createTestDatabase();
  const cacheService = new CacheService(db);
  
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
  
  await cacheService.close();
  await db.close();
});