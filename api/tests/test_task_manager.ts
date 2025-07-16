import { assertEquals, assertExists } from "../deps.ts";
import { InMemoryTaskManager } from "../services/task-manager.ts";
import type { TaskResultResponse } from "../types/schemas.ts";

Deno.test("InMemoryTaskManager - create task", () => {
  const taskManager = new InMemoryTaskManager();
  
  const taskId = taskManager.createTask();
  
  assertExists(taskId);
  assertEquals(typeof taskId, "string");
  assertEquals(taskId.length > 0, true);
});

Deno.test("InMemoryTaskManager - set and get task status", async () => {
  const taskManager = new InMemoryTaskManager();
  
  const taskId = taskManager.createTask();
  const newStatus: TaskResultResponse = {
    state: "PROCESSING",
    status: "Processing audio file...",
  };
  
  await taskManager.setTaskStatus(taskId, newStatus);
  const retrievedStatus = await taskManager.getTaskStatus(taskId);
  
  assertEquals(retrievedStatus?.state, "PROCESSING");
  if (retrievedStatus?.state === "PROCESSING") {
    assertEquals(retrievedStatus.status, "Processing audio file...");
  }
});

Deno.test("InMemoryTaskManager - get non-existent task", async () => {
  const taskManager = new InMemoryTaskManager();
  
  const result = await taskManager.getTaskStatus("non-existent-id");
  
  assertEquals(result, null);
});

Deno.test("InMemoryTaskManager - delete task", async () => {
  const taskManager = new InMemoryTaskManager();
  
  const taskId = taskManager.createTask();
  const status: TaskResultResponse = {
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
  };
  
  await taskManager.setTaskStatus(taskId, status);
  
  // Verify task exists
  let retrievedStatus = await taskManager.getTaskStatus(taskId);
  assertEquals(retrievedStatus?.state, "SUCCESS");
  
  // Delete task
  await taskManager.deleteTask(taskId);
  
  // Verify task is deleted
  retrievedStatus = await taskManager.getTaskStatus(taskId);
  assertEquals(retrievedStatus, null);
});

Deno.test("InMemoryTaskManager - multiple tasks", async () => {
  const taskManager = new InMemoryTaskManager();
  
  const taskId1 = taskManager.createTask();
  const taskId2 = taskManager.createTask();
  
  const status1: TaskResultResponse = {
    state: "PROCESSING",
    status: "Processing first file...",
  };
  
  const status2: TaskResultResponse = {
    state: "PENDING",
    status: "Waiting to process second file...",
  };
  
  await taskManager.setTaskStatus(taskId1, status1);
  await taskManager.setTaskStatus(taskId2, status2);
  
  const retrieved1 = await taskManager.getTaskStatus(taskId1);
  const retrieved2 = await taskManager.getTaskStatus(taskId2);
  
  assertEquals(retrieved1?.state, "PROCESSING");
  if (retrieved1?.state === "PROCESSING") {
    assertEquals(retrieved1.status, "Processing first file...");
  }
  assertEquals(retrieved2?.state, "PENDING");
  if (retrieved2?.state === "PENDING") {
    assertEquals(retrieved2.status, "Waiting to process second file...");
  }
});

Deno.test("InMemoryTaskManager - update existing task", async () => {
  const taskManager = new InMemoryTaskManager();
  
  const taskId = taskManager.createTask();
  
  // Set initial status
  const initialStatus: TaskResultResponse = {
    state: "PENDING",
    status: "Queued for processing...",
  };
  await taskManager.setTaskStatus(taskId, initialStatus);
  
  // Update to processing
  const processingStatus: TaskResultResponse = {
    state: "PROCESSING",
    status: "Analyzing audio...",
  };
  await taskManager.setTaskStatus(taskId, processingStatus);
  
  // Update to success
  const successStatus: TaskResultResponse = {
    state: "SUCCESS",
    result: {
      bpm: 128.5,
      beat_timestamps: [0.0, 0.46875, 0.9375],
      melody_map: [{
        pitch: "G4",
        start_time: 0.5,
        duration: 0.25,
      }],
      analysis_info: {
        total_beats: 3,
        total_subdivisions: 6,
        consolidated_notes: 1,
        filtered_notes: 1,
        min_note_duration: 0.05,
        subdivision_factor: 2,
      },
    },
  };
  await taskManager.setTaskStatus(taskId, successStatus);
  
  const finalStatus = await taskManager.getTaskStatus(taskId);
  assertEquals(finalStatus?.state, "SUCCESS");
  if (finalStatus?.state === "SUCCESS") {
    assertEquals(finalStatus.result.bpm, 128.5);
  }
});