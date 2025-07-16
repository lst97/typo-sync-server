import { assertEquals, assertExists } from "../deps.ts";
import { QueueService } from "../services/queue-service.ts";
import { DatabaseService } from "../services/database-service.ts";
import { AudioFingerprint, QueueItem } from "../types/domain.ts";

async function createTestDatabase(): Promise<DatabaseService> {
  const db = new DatabaseService(":memory:");
  await db.initialize();
  await db.migrate();
  return db;
}

Deno.test("QueueService - enqueue audio processing", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db);
  
  // Create test audio fingerprint
  const fingerprint = new AudioFingerprint({
    contentHash: "test_content_hash",
    perceptualHash: "test_perceptual_hash",
    metadataHash: "test_metadata_hash",
    fileSize: 1024,
    durationSeconds: 30.0,
    format: "mp3"
  });
  
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  
  // Enqueue processing
  const taskId = await queueService.enqueue(savedFingerprint.id!, "normal");
  
  assertExists(taskId);
  assertEquals(typeof taskId, "string");
  assertEquals(taskId.length, 26); // ULID length
  
  // Verify it was queued
  const queueItem = await db.queueRepository.findByTaskId(taskId);
  assertExists(queueItem);
  assertEquals(queueItem.status, "QUEUED");
  assertEquals(queueItem.priority, 2); // normal priority
  assertEquals(queueItem.audioFingerprintId, savedFingerprint.id);
  
  await db.close();
});

Deno.test("QueueService - priority handling", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db);
  
  // Create test audio fingerprints
  const fingerprints = await Promise.all([
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash1",
      perceptualHash: "perceptual1",
      metadataHash: "metadata1",
      fileSize: 1024,
      durationSeconds: 30.0,
      format: "mp3"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash2",
      perceptualHash: "perceptual2",
      metadataHash: "metadata2",
      fileSize: 2048,
      durationSeconds: 60.0,
      format: "wav"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash3",
      perceptualHash: "perceptual3",
      metadataHash: "metadata3",
      fileSize: 512,
      durationSeconds: 15.0,
      format: "mp3"
    }))
  ]);
  
  // Enqueue with different priorities
  const taskId1 = await queueService.enqueue(fingerprints[0].id!, "batch");   // priority 3
  const taskId2 = await queueService.enqueue(fingerprints[1].id!, "high");    // priority 1
  const taskId3 = await queueService.enqueue(fingerprints[2].id!, "normal");  // priority 2
  
  // Dequeue should return high priority first
  const nextItems = await queueService.dequeue(3);
  
  assertEquals(nextItems.length, 3);
  assertEquals(nextItems[0].taskId, taskId2); // High priority first
  assertEquals(nextItems[1].taskId, taskId3); // Normal priority second
  assertEquals(nextItems[2].taskId, taskId1); // Batch priority last
  
  await db.close();
});

Deno.test("QueueService - queue position tracking", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db);
  
  // Create and enqueue multiple items
  const fingerprints = await Promise.all([
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash1",
      perceptualHash: "perceptual1",
      metadataHash: "metadata1",
      fileSize: 1024,
      durationSeconds: 30.0,
      format: "mp3"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash2",
      perceptualHash: "perceptual2",
      metadataHash: "metadata2",
      fileSize: 2048,
      durationSeconds: 60.0,
      format: "wav"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash3",
      perceptualHash: "perceptual3",
      metadataHash: "metadata3",
      fileSize: 512,
      durationSeconds: 15.0,
      format: "mp3"
    }))
  ]);
  
  const taskIds = await Promise.all([
    queueService.enqueue(fingerprints[0].id!, "normal"),
    queueService.enqueue(fingerprints[1].id!, "normal"),
    queueService.enqueue(fingerprints[2].id!, "normal")
  ]);
  
  // Check queue positions
  const position1 = await queueService.getQueuePosition(taskIds[0]);
  const position2 = await queueService.getQueuePosition(taskIds[1]);
  const position3 = await queueService.getQueuePosition(taskIds[2]);
  
  assertExists(position1);
  assertExists(position2);
  assertExists(position3);
  
  assertEquals(position1.position, 1);
  assertEquals(position2.position, 2);
  assertEquals(position3.position, 3);
  
  // All should have estimated wait times
  assertEquals(position1.estimatedWaitTimeMs > 0, true);
  assertEquals(position2.estimatedWaitTimeMs > position1.estimatedWaitTimeMs, true);
  assertEquals(position3.estimatedWaitTimeMs > position2.estimatedWaitTimeMs, true);
  
  await db.close();
});

Deno.test("QueueService - queue statistics", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db);
  
  // Initial stats should be empty
  const initialStats = await queueService.getQueueStatistics();
  assertEquals(initialStats.totalQueued, 0);
  assertEquals(initialStats.currentlyProcessing, 0);
  
  // Create and enqueue items
  const fingerprints = await Promise.all([
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash1",
      perceptualHash: "perceptual1",
      metadataHash: "metadata1",
      fileSize: 1024,
      durationSeconds: 30.0,
      format: "mp3"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash2",
      perceptualHash: "perceptual2",
      metadataHash: "metadata2",
      fileSize: 2048,
      durationSeconds: 60.0,
      format: "wav"
    }))
  ]);
  
  const taskIds = await Promise.all([
    queueService.enqueue(fingerprints[0].id!, "normal"),
    queueService.enqueue(fingerprints[1].id!, "high")
  ]);
  
  // Check stats after enqueuing
  const queuedStats = await queueService.getQueueStatistics();
  assertEquals(queuedStats.totalQueued, 2);
  assertEquals(queuedStats.currentlyProcessing, 0);
  
  // Start processing one item
  await queueService.markProcessingStarted(taskIds[0]);
  
  // Check stats after starting processing
  const processingStats = await queueService.getQueueStatistics();
  assertEquals(processingStats.totalQueued, 1);
  assertEquals(processingStats.currentlyProcessing, 1);
  
  await db.close();
});

Deno.test("QueueService - processing lifecycle", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db);
  
  // Create test audio fingerprint
  const fingerprint = new AudioFingerprint({
    contentHash: "test_content_hash",
    perceptualHash: "test_perceptual_hash",
    metadataHash: "test_metadata_hash",
    fileSize: 1024,
    durationSeconds: 30.0,
    format: "mp3"
  });
  
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  const taskId = await queueService.enqueue(savedFingerprint.id!, "normal");
  
  // Initial state should be QUEUED
  let queueItem = await db.queueRepository.findByTaskId(taskId);
  assertEquals(queueItem!.status, "QUEUED");
  assertEquals(queueItem!.startedAt, undefined);
  
  // Mark as processing
  await queueService.markProcessingStarted(taskId);
  queueItem = await db.queueRepository.findByTaskId(taskId);
  assertEquals(queueItem!.status, "PROCESSING");
  assertExists(queueItem!.startedAt);
  
  // Mark as completed
  await queueService.markProcessingCompleted(taskId);
  queueItem = await db.queueRepository.findByTaskId(taskId);
  assertEquals(queueItem!.status, "COMPLETED");
  assertExists(queueItem!.completedAt);
  
  // Should be able to get processing time
  const processingTime = queueItem!.getProcessingTimeMs();
  assertExists(processingTime);
  assertEquals(processingTime! > 0, true);
  
  await db.close();
});

Deno.test("QueueService - error handling", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db);
  
  // Create test audio fingerprint
  const fingerprint = new AudioFingerprint({
    contentHash: "test_content_hash",
    perceptualHash: "test_perceptual_hash",
    metadataHash: "test_metadata_hash",
    fileSize: 1024,
    durationSeconds: 30.0,
    format: "mp3"
  });
  
  const savedFingerprint = await db.audioRepository.save(fingerprint);
  const taskId = await queueService.enqueue(savedFingerprint.id!, "normal");
  
  // Start processing
  await queueService.markProcessingStarted(taskId);
  
  // Mark as failed
  const errorMessage = "Processing failed due to corrupted audio";
  await queueService.markProcessingFailed(taskId, errorMessage);
  
  const queueItem = await db.queueRepository.findByTaskId(taskId);
  assertEquals(queueItem!.status, "FAILED");
  assertEquals(queueItem!.errorMessage, errorMessage);
  assertExists(queueItem!.completedAt);
  
  await db.close();
});

Deno.test("QueueService - concurrency limits", async () => {
  const db = await createTestDatabase();
  const queueService = new QueueService(db, { maxConcurrency: 2 });
  
  // Create multiple fingerprints
  const fingerprints = await Promise.all([
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash1",
      perceptualHash: "perceptual1",
      metadataHash: "metadata1",
      fileSize: 1024,
      durationSeconds: 30.0,
      format: "mp3"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash2",
      perceptualHash: "perceptual2",
      metadataHash: "metadata2",
      fileSize: 2048,
      durationSeconds: 60.0,
      format: "wav"
    })),
    db.audioRepository.save(new AudioFingerprint({
      contentHash: "hash3",
      perceptualHash: "perceptual3",
      metadataHash: "metadata3",
      fileSize: 512,
      durationSeconds: 15.0,
      format: "mp3"
    }))
  ]);
  
  // Enqueue all
  const taskIds = await Promise.all([
    queueService.enqueue(fingerprints[0].id!, "normal"),
    queueService.enqueue(fingerprints[1].id!, "normal"),
    queueService.enqueue(fingerprints[2].id!, "normal")
  ]);
  
  // Start processing first two
  await queueService.markProcessingStarted(taskIds[0]);
  await queueService.markProcessingStarted(taskIds[1]);
  
  // Should not be able to process more due to concurrency limit
  const canProcess = await queueService.canProcessMore();
  assertEquals(canProcess, false);
  
  // Complete one task
  await queueService.markProcessingCompleted(taskIds[0]);
  
  // Should now be able to process more
  const canProcessAfter = await queueService.canProcessMore();
  assertEquals(canProcessAfter, true);
  
  await db.close();
});