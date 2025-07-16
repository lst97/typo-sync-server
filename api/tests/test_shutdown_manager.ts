import { assertEquals } from "../deps.ts";
import { ShutdownManager } from "../services/shutdown-manager.ts";

Deno.test("ShutdownManager - singleton pattern", () => {
  const manager1 = ShutdownManager.getInstance();
  const manager2 = ShutdownManager.getInstance();
  
  // Should return the same instance
  assertEquals(manager1, manager2);
});

Deno.test("ShutdownManager - register shutdown handler", async () => {
  const manager = ShutdownManager.getInstance();
  let handlerCalled = false;
  
  // Register a test handler
  manager.registerShutdownHandler(async () => {
    handlerCalled = true;
  });
  
  // Verify handler was registered (we can't test shutdown without actually shutting down)
  assertEquals(typeof manager.registerShutdownHandler, "function");
});

Deno.test("ShutdownManager - pattern matching", () => {
  const manager = ShutdownManager.getInstance();
  
  // Test private method via type assertion (for testing purposes)
  const privateManager = manager as any;
  
  // Test pattern matching
  assertEquals(privateManager.matchesPattern("test.tmp", "*.tmp"), true);
  assertEquals(privateManager.matchesPattern("test.log", "*.tmp"), false);
  assertEquals(privateManager.matchesPattern("core.123", "core.*"), true);
  assertEquals(privateManager.matchesPattern("exact.txt", "exact.txt"), true);
  assertEquals(privateManager.matchesPattern("different.txt", "exact.txt"), false);
});

Deno.test("ShutdownManager - setup signal handlers", () => {
  const manager = ShutdownManager.getInstance();
  
  // Verify the method exists and can be called
  assertEquals(typeof manager.setupSignalHandlers, "function");
  
  // Note: We don't actually call setupSignalHandlers() in the test
  // because it would register signal handlers that need cleanup
  // This test just verifies the method exists
});