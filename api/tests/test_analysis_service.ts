import { assertEquals, assertExists, delay } from "../deps.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { InMemoryTaskManager } from "../services/task-manager.ts";

// Helper function to create test audio data
function createTestAudioBuffer(): Uint8Array {
  // Create a minimal WAV file header + some data
  const header = new Uint8Array([
    // RIFF header
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x24, 0x00, 0x00, 0x00, // File size (36 bytes)
    0x57, 0x41, 0x56, 0x45, // "WAVE"
    
    // fmt chunk
    0x66, 0x6D, 0x74, 0x20, // "fmt "
    0x10, 0x00, 0x00, 0x00, // Chunk size (16)
    0x01, 0x00,             // Audio format (PCM)
    0x01, 0x00,             // Number of channels (1)
    0x44, 0xAC, 0x00, 0x00, // Sample rate (44100)
    0x88, 0x58, 0x01, 0x00, // Byte rate
    0x02, 0x00,             // Block align
    0x10, 0x00,             // Bits per sample (16)
    
    // data chunk
    0x64, 0x61, 0x74, 0x61, // "data"
    0x00, 0x00, 0x00, 0x00, // Data size (0 - empty)
  ]);
  
  return header;
}

Deno.test("AnalysisService - submit analysis request", async () => {
  const taskManager = new InMemoryTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const testBuffer = createTestAudioBuffer();
  const filename = "test_audio.wav";
  
  const taskId = await analysisService.submitAnalysis(testBuffer, filename);
  
  assertExists(taskId);
  assertEquals(typeof taskId, "string");
  assertEquals(taskId.length > 0, true);
  
  // Check that task was created with initial status
  const status = await analysisService.getTaskStatus(taskId);
  assertExists(status);
  assertEquals(status.state, "PENDING");
});

Deno.test("AnalysisService - get task status for non-existent task", async () => {
  const taskManager = new InMemoryTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const status = await analysisService.getTaskStatus("non-existent-id");
  
  assertEquals(status.state, "NOT_FOUND");
  assertEquals(status.status, "Task not found");
});

Deno.test("AnalysisService - filename sanitization", async () => {
  const taskManager = new InMemoryTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const testBuffer = createTestAudioBuffer();
  const dangerousFilename = "../../../etc/passwd.wav";
  
  // This should not throw an error and should sanitize the filename
  const taskId = await analysisService.submitAnalysis(testBuffer, dangerousFilename);
  
  assertExists(taskId);
  assertEquals(typeof taskId, "string");
});

Deno.test("AnalysisService - stream task status", async () => {
  const taskManager = new InMemoryTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const taskId = taskManager.createTask();
  
  // Set up a sequence of status updates
  setTimeout(async () => {
    await taskManager.setTaskStatus(taskId, {
      state: "PROCESSING",
      status: "Processing audio file...",
    });
  }, 100);
  
  setTimeout(async () => {
    await taskManager.setTaskStatus(taskId, {
      state: "SUCCESS",
      result: {
        bpm: 120.0,
        beat_timestamps: [0.0, 0.5, 1.0],
        melody_map: [],
        analysis_info: {
          total_beats: 3,
          total_subdivisions: 6,
          consolidated_notes: 0,
          filtered_notes: 0,
          min_note_duration: 0.05,
          subdivision_factor: 2,
        },
      },
    });
  }, 200);
  
  const statuses: string[] = [];
  
  for await (const status of analysisService.streamTaskStatus(taskId)) {
    statuses.push(status.state);
    
    if (status.state === "SUCCESS") {
      break;
    }
  }
  
  // Should have seen at least PENDING and SUCCESS
  assertEquals(statuses.includes("PENDING"), true);
  assertEquals(statuses.includes("SUCCESS"), true);
  assertEquals(statuses[statuses.length - 1], "SUCCESS");
});

Deno.test("AnalysisService - stream non-existent task", async () => {
  const taskManager = new InMemoryTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const statuses: string[] = [];
  
  for await (const status of analysisService.streamTaskStatus("non-existent-id")) {
    statuses.push(status.state);
    
    if (status.state === "NOT_FOUND") {
      break;
    }
  }
  
  assertEquals(statuses.length, 1);
  assertEquals(statuses[0], "NOT_FOUND");
});

Deno.test("AnalysisService - health check", async () => {
  const taskManager = new InMemoryTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const health = await analysisService.healthCheck();
  
  assertExists(health);
  assertEquals(typeof health.healthy, "boolean");
  
  if (!health.healthy) {
    assertExists(health.error);
    assertEquals(typeof health.error, "string");
  }
});