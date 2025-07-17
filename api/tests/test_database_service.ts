import { assertEquals, assertExists } from "../deps.ts";
import { DatabaseService } from "../services/database-service.ts";
import { AudioFingerprint, AnalysisCache, QueueItem } from "../types/domain.ts";

Deno.test("DatabaseService - initialization", async () => {
  const db = new DatabaseService(":memory:");
  await db.initialize();
  
  const isHealthy = await db.healthCheck();
  assertEquals(isHealthy, true);
  
  await db.close();
});

Deno.test("DatabaseService - schema migration", async () => {
  const db = new DatabaseService(":memory:");
  await db.initialize();
  await db.migrate();
  
  // Verify tables exist
  const tables = await db.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);
  
  const tableNames = tables.map((row: any) => row.table_name);
  assertEquals(tableNames.includes("audio_fingerprints"), true);
  assertEquals(tableNames.includes("analysis_cache"), true);
  assertEquals(tableNames.includes("processing_queue"), true);
  
  await db.close();
});

Deno.test("AudioFingerprint - CRUD operations", async () => {
  const db = new DatabaseService(":memory:");
  await db.initialize();
  await db.migrate();
  
  const fingerprint = new AudioFingerprint({
    contentHash: "sha256_test_hash",
    perceptualHash: "perceptual_test_hash",
    metadataHash: "metadata_test_hash",
    fileSize: 1024,
    durationSeconds: 30.5,
    format: "mp3"
  });
  
  // Test create
  const saved = await db.audioRepository.save(fingerprint);
  assertExists(saved.id);
  
  // Test read
  const found = await db.audioRepository.findByContentHash("sha256_test_hash");
  assertExists(found);
  assertEquals(found.contentHash, "sha256_test_hash");
  
  // Test perceptual hash search
  const perceptualResults = await db.audioRepository.findByPerceptualHash("perceptual_test_hash");
  assertEquals(perceptualResults.length, 1);
  assertEquals(perceptualResults[0].contentHash, "sha256_test_hash");
  
  await db.close();
});

Deno.test("AnalysisCache - CRUD operations", async () => {
  const db = new DatabaseService(":memory:");
  await db.initialize();
  await db.migrate();
  
  // Create fingerprint first
  const fingerprint = new AudioFingerprint({
    contentHash: "cache_test_hash",
    perceptualHash: "cache_perceptual_hash",
    metadataHash: "cache_metadata_hash",
    fileSize: 2048,
    durationSeconds: 45.0,
    format: "wav"
  });
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  
  // Create cache entry
  const cacheEntry = new AnalysisCache({
    audioFingerprintId: savedFingerprint.id!,
    bpm: 120.5,
    beatTimestamps: [0.0, 0.5, 1.0, 1.5],
    melodyMap: [
      { pitch: "C4", start_time: 0.0, duration: 0.5 },
      { pitch: "D4", start_time: 0.5, duration: 0.5 }
    ],
    analysisInfo: {
      total_beats: 4,
      total_subdivisions: 8,
      consolidated_notes: 2,
      filtered_notes: 2,
      min_note_duration: 0.05,
      subdivision_factor: 2
    },
    algorithmVersion: "1.0"
  });
  
  // Test create
  const savedCache = await db.cacheRepository.save(cacheEntry);
  assertExists(savedCache.id);
  
  // Test read
  const foundCache = await db.cacheRepository.findByFingerprint(savedFingerprint.id!);
  assertExists(foundCache);
  assertEquals(foundCache.bpm, 120.5);
  
  // Test access stats update
  await db.cacheRepository.updateAccessStats(savedCache.id!);
  const updatedCache = await db.cacheRepository.findByFingerprint(savedFingerprint.id!);
  assertEquals(updatedCache!.accessCount, 2);
  
  await db.close();
});

Deno.test("ProcessingQueue - CRUD operations", async () => {
  const db = new DatabaseService(":memory:");
  await db.initialize();
  await db.migrate();
  
  // Create fingerprint first
  const fingerprint = new AudioFingerprint({
    contentHash: "queue_test_hash",
    perceptualHash: "queue_perceptual_hash",
    metadataHash: "queue_metadata_hash",
    fileSize: 3072,
    durationSeconds: 60.0,
    format: "mp3"
  });
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  
  // Create queue item
  const queueItem = new QueueItem({
    taskId: "test_task_id_123",
    audioFingerprintId: savedFingerprint.id!,
    priority: 1,
    status: "QUEUED"
  });
  
  // Test enqueue
  await db.queueRepository.enqueue(queueItem);
  
  // Test find by task ID
  const foundItem = await db.queueRepository.findByTaskId("test_task_id_123");
  assertExists(foundItem);
  assertEquals(foundItem.taskId, "test_task_id_123");
  assertEquals(foundItem.status, "QUEUED");
  
  // Test dequeue
  const dequeued = await db.queueRepository.dequeue(1);
  assertEquals(dequeued.length, 1);
  assertEquals(dequeued[0].taskId, "test_task_id_123");
  
  // Test update status
  await db.queueRepository.updateStatus("test_task_id_123", "PROCESSING");
  const updatedItem = await db.queueRepository.findByTaskId("test_task_id_123");
  assertEquals(updatedItem!.status, "PROCESSING");
  
  // Test queue stats
  const stats = await db.queueRepository.getQueueStats();
  assertExists(stats);
  assertEquals(typeof stats.totalQueued, "number");
  assertEquals(typeof stats.currentlyProcessing, "number");
  
  await db.close();
});