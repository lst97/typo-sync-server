import { assertEquals, assertExists } from "../deps.ts";
import {
  MelodyNoteSchema,
  AnalysisInfoSchema,
  AnalysisResultSchema,
  AnalyzeResponseSchema,
  TaskResultResponseSchema,
  ConfigSchema,
} from "../types/schemas.ts";

Deno.test("MelodyNoteSchema - valid data", () => {
  const validNote = {
    pitch: "A4",
    start_time: 1.23,
    duration: 0.45,
  };

  const result = MelodyNoteSchema.safeParse(validNote);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.pitch, "A4");
    assertEquals(result.data.start_time, 1.23);
    assertEquals(result.data.duration, 0.45);
  }
});

Deno.test("MelodyNoteSchema - invalid data", () => {
  const invalidNote = {
    pitch: "A4",
    start_time: "invalid", // Should be number
    duration: 0.45,
  };

  const result = MelodyNoteSchema.safeParse(invalidNote);
  assertEquals(result.success, false);
});

Deno.test("AnalysisInfoSchema - valid data", () => {
  const validInfo = {
    total_beats: 150,
    total_subdivisions: 300,
    consolidated_notes: 100,
    filtered_notes: 80,
    min_note_duration: 0.05,
    subdivision_factor: 2,
  };

  const result = AnalysisInfoSchema.safeParse(validInfo);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.total_beats, 150);
    assertEquals(result.data.total_subdivisions, 300);
  }
});

Deno.test("AnalysisResultSchema - complete valid data", () => {
  const validResult = {
    bpm: 120.0,
    beat_timestamps: [0.0, 0.5, 1.0],
    melody_map: [
      {
        pitch: "C4",
        start_time: 0.5,
        duration: 0.45,
      },
    ],
    analysis_info: {
      total_beats: 150,
      total_subdivisions: 300,
      consolidated_notes: 100,
      filtered_notes: 80,
      min_note_duration: 0.05,
      subdivision_factor: 2,
    },
  };

  const result = AnalysisResultSchema.safeParse(validResult);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.bpm, 120.0);
    assertEquals(result.data.beat_timestamps.length, 3);
    assertEquals(result.data.melody_map.length, 1);
    assertExists(result.data.analysis_info);
  }
});

Deno.test("AnalyzeResponseSchema - redis backend", () => {
  const validResponse = {
    task_id: "01HF7XQZX8R3VTFN95QG9MJZT0",
    backend: "redis",
  };

  const result = AnalyzeResponseSchema.safeParse(validResponse);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.backend, "redis");
  }
});

Deno.test("AnalyzeResponseSchema - in-memory backend", () => {
  const validResponse = {
    task_id: "01HF7XQZX8R3VTFN95QG9MJZT0",
    backend: "in-memory",
  };

  const result = AnalyzeResponseSchema.safeParse(validResponse);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.backend, "in-memory");
  }
});

Deno.test("TaskResultResponseSchema - success response", () => {
  const successResponse = {
    state: "SUCCESS",
    result: {
      bpm: 120.0,
      beat_timestamps: [0.0, 0.5, 1.0],
      melody_map: [],
      analysis_info: {
        total_beats: 150,
        total_subdivisions: 300,
        consolidated_notes: 100,
        filtered_notes: 80,
        min_note_duration: 0.05,
        subdivision_factor: 2,
      },
    },
  };

  const result = TaskResultResponseSchema.safeParse(successResponse);
  assertEquals(result.success, true);
});

Deno.test("TaskResultResponseSchema - failure response", () => {
  const failureResponse = {
    state: "FAILURE",
    status: "Analysis failed due to invalid file format",
  };

  const result = TaskResultResponseSchema.safeParse(failureResponse);
  assertEquals(result.success, true);
});

Deno.test("TaskResultResponseSchema - processing response", () => {
  const processingResponse = {
    state: "PROCESSING",
    status: "Processing audio file...",
  };

  const result = TaskResultResponseSchema.safeParse(processingResponse);
  assertEquals(result.success, true);
});

Deno.test("ConfigSchema - default values", () => {
  const minimalConfig = {};

  const result = ConfigSchema.safeParse(minimalConfig);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.port, 8000);
    assertEquals(result.data.log_level, "INFO");
    assertEquals(result.data.min_note_duration, 0.05);
    assertEquals(result.data.python_executable, "python3");
    assertEquals(result.data.upload_dir, "./uploads");
    assertEquals(result.data.max_file_size, 50 * 1024 * 1024);
  }
});

Deno.test("ConfigSchema - custom values", () => {
  const customConfig = {
    port: 3000,
    log_level: "DEBUG",
    redis_url: "redis://localhost:6379/0",
    min_note_duration: 0.1,
    python_executable: "/usr/bin/python3",
    rhythm_engine_path: "/custom/path/run.py",
    upload_dir: "/tmp/uploads",
    max_file_size: 100 * 1024 * 1024,
  };

  const result = ConfigSchema.safeParse(customConfig);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.port, 3000);
    assertEquals(result.data.log_level, "DEBUG");
    assertEquals(result.data.redis_url, "redis://localhost:6379/0");
    assertEquals(result.data.min_note_duration, 0.1);
  }
});