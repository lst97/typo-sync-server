import { assertEquals, assertExists } from "../deps.ts";
import { config } from "../config/config.ts";
import { createTaskManager } from "../services/task-manager.ts";
import { AnalysisService } from "../services/analysis-service.ts";

// Integration tests that test the full flow
Deno.test("Integration - full analysis workflow with in-memory backend", async () => {
  // Ensure we're using in-memory backend for this test
  const originalRedisUrl = Deno.env.get("REDIS_URL");
  Deno.env.delete("REDIS_URL");
  
  try {
    const taskManager = await createTaskManager();
    const analysisService = new AnalysisService(taskManager);
    
    // Create a minimal audio file for testing
    const testAudioData = new Uint8Array([
      // Minimal WAV header
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x24, 0x00, 0x00, 0x00, // File size
      0x57, 0x41, 0x56, 0x45, // "WAVE"
      0x66, 0x6D, 0x74, 0x20, // "fmt "
      0x10, 0x00, 0x00, 0x00, // Chunk size
      0x01, 0x00, 0x01, 0x00, // Format, channels
      0x44, 0xAC, 0x00, 0x00, // Sample rate
      0x88, 0x58, 0x01, 0x00, // Byte rate
      0x02, 0x00, 0x10, 0x00, // Block align, bits per sample
      0x64, 0x61, 0x74, 0x61, // "data"
      0x00, 0x00, 0x00, 0x00, // Data size
    ]);
    
    // Submit analysis
    const taskId = await analysisService.submitAnalysis(testAudioData, "test.wav");
    assertExists(taskId);
    
    // Check initial status
    let status = await analysisService.getTaskStatus(taskId);
    assertEquals(status.state, "PENDING");
    
    // Wait a bit for processing to start (this will likely fail since we don't have a real audio file)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check final status (should be FAILURE due to invalid audio data)
    status = await analysisService.getTaskStatus(taskId);
    
    // The status should be either PROCESSING or FAILURE
    assertEquals(["PROCESSING", "FAILURE"].includes(status.state), true);
    
  } finally {
    // Restore original Redis URL if it was set
    if (originalRedisUrl) {
      Deno.env.set("REDIS_URL", originalRedisUrl);
    }
  }
});

Deno.test("Integration - configuration loading", () => {
  // Test that configuration is loaded correctly
  const conf = config.config;
  
  assertExists(conf);
  assertEquals(typeof conf.port, "number");
  assertEquals(typeof conf.log_level, "string");
  assertEquals(typeof conf.min_note_duration, "number");
  assertEquals(typeof conf.python_executable, "string");
  assertEquals(typeof conf.upload_dir, "string");
  assertEquals(typeof conf.max_file_size, "number");
  
  // Test backend determination
  const backend = config.backend;
  assertEquals(["redis", "in-memory"].includes(backend), true);
});

Deno.test("Integration - error handling workflow", async () => {
  const taskManager = await createTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  // Test with completely invalid data
  const invalidData = new Uint8Array([1, 2, 3, 4, 5]);
  
  const taskId = await analysisService.submitAnalysis(invalidData, "invalid.txt");
  assertExists(taskId);
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Should have failed
  const status = await analysisService.getTaskStatus(taskId);
  assertEquals(status.state, "FAILURE");
  assertExists((status as any).status);
});

Deno.test("Integration - health check with Python validation", async () => {
  const taskManager = await createTaskManager();
  const analysisService = new AnalysisService(taskManager);
  
  const health = await analysisService.healthCheck();
  
  assertExists(health);
  assertEquals(typeof health.healthy, "boolean");
  
  // The health check should validate Python availability
  if (!health.healthy) {
    assertExists(health.error);
    // Error should mention Python or script issues
    assertEquals(
      health.error.toLowerCase().includes("python") || 
      health.error.toLowerCase().includes("script") ||
      health.error.toLowerCase().includes("executable"),
      true
    );
  }
});