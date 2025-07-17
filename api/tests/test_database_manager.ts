import { assertEquals, assertExists } from "../deps.ts";
import { DatabaseManager } from "../services/database-manager.ts";

Deno.test("DatabaseManager - singleton pattern", async () => {
  const manager1 = DatabaseManager.getInstance();
  const manager2 = DatabaseManager.getInstance();
  
  // Should return the same instance
  assertEquals(manager1, manager2);
  
  // Clean up
  await manager1.reset();
});

Deno.test("DatabaseManager - database initialization", async () => {
  const manager = DatabaseManager.getInstance();
  
  // Should initialize database successfully
  const db = await manager.getDatabase(":memory:");
  assertExists(db);
  
  // Should return the same database instance on subsequent calls
  const db2 = await manager.getDatabase(":memory:");
  assertEquals(db, db2);
  
  // Should be initialized
  assertEquals(manager.isInitialized(), true);
  
  // Health check should pass
  const isHealthy = await db.healthCheck();
  assertEquals(isHealthy, true);
  
  // Clean up
  await manager.reset();
});

Deno.test("DatabaseManager - concurrent initialization", async () => {
  const manager = DatabaseManager.getInstance();
  
  // Multiple concurrent calls should all return the same instance
  const [db1, db2, db3] = await Promise.all([
    manager.getDatabase(":memory:"),
    manager.getDatabase(":memory:"),
    manager.getDatabase(":memory:")
  ]);
  
  assertEquals(db1, db2);
  assertEquals(db2, db3);
  assertEquals(manager.isInitialized(), true);
  
  // Clean up
  await manager.reset();
});

Deno.test("DatabaseManager - reset functionality", async () => {
  const manager = DatabaseManager.getInstance();
  
  // Initialize database
  await manager.getDatabase(":memory:");
  assertEquals(manager.isInitialized(), true);
  
  // Reset should clear state
  await manager.reset();
  assertEquals(manager.isInitialized(), false);
  assertEquals(manager.getDatabaseService(), null);
});