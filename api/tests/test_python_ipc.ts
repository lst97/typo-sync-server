import { assertEquals, assertExists } from "../deps.ts";
import { PythonIPCService } from "../services/python-ipc.ts";

// Mock test data - we'll create a simple test audio file for testing
const TEST_AUDIO_FILE = "./tests/fixtures/test_audio.wav";
const NON_EXISTENT_FILE = "./tests/fixtures/non_existent.wav";

Deno.test("PythonIPCService - health check success", async () => {
  const ipcService = new PythonIPCService();
  
  const health = await ipcService.healthCheck();
  
  // This will depend on whether Python and the script are available
  assertExists(health);
  assertEquals(typeof health.healthy, "boolean");
  
  if (!health.healthy) {
    assertExists(health.error);
    assertEquals(typeof health.error, "string");
  }
});

Deno.test("PythonIPCService - analyze non-existent file", async () => {
  const ipcService = new PythonIPCService();
  
  const result = await ipcService.analyzeAudio(NON_EXISTENT_FILE);
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assertEquals(typeof result.error, "string");
});

// This test requires the Python environment to be set up
Deno.test({
  name: "PythonIPCService - analyze valid audio file (integration)",
  ignore: true, // Skip by default since it requires Python environment
  fn: async () => {
    const ipcService = new PythonIPCService();
    
    // This would require a real audio file for testing
    const result = await ipcService.analyzeAudio(TEST_AUDIO_FILE);
    
    if (result.success) {
      assertExists(result.data);
      assertExists(result.data.bpm);
      assertExists(result.data.beat_timestamps);
      assertExists(result.data.melody_map);
      assertExists(result.data.analysis_info);
      
      assertEquals(typeof result.data.bpm, "number");
      assertEquals(Array.isArray(result.data.beat_timestamps), true);
      assertEquals(Array.isArray(result.data.melody_map), true);
    } else {
      assertExists(result.error);
    }
  },
});

Deno.test("PythonIPCService - error handling for invalid JSON output", async () => {
  // This test would require mocking the Python subprocess
  // For now, we'll test the error handling structure
  const ipcService = new PythonIPCService();
  
  // Test with a non-audio file that will cause the Python script to fail
  const result = await ipcService.analyzeAudio("./deno.json");
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assertEquals(typeof result.error, "string");
});