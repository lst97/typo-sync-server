import { z } from "../deps.ts";

// Core audio analysis schemas
export const MelodyNoteSchema = z.object({
  pitch: z.string().describe("MIDI note name (e.g., A4, C#5)"),
  start_time: z.number().describe("Start time in seconds"),
  duration: z.number().describe("Duration in seconds"),
});

export const AnalysisInfoSchema = z.object({
  total_beats: z.number().describe("Total number of beats detected"),
  total_subdivisions: z.number().describe("Total number of subdivisions analyzed"),
  consolidated_notes: z.number().describe("Number of notes after consolidating consecutive identical notes"),
  filtered_notes: z.number().describe("Number of notes after applying the minimum duration filter"),
  min_note_duration: z.number().describe("The minimum note duration filter used"),
  subdivision_factor: z.number().describe("The number of subdivisions per beat"),
});

export const AnalysisResultSchema = z.object({
  bpm: z.number().describe("Estimated tempo in beats per minute"),
  beat_timestamps: z.array(z.number()).describe("List of timestamps for each detected beat"),
  melody_map: z.array(MelodyNoteSchema).describe("The extracted melody as a list of notes"),
  analysis_info: AnalysisInfoSchema.describe("Detailed information about the analysis process"),
});

// API response schemas
export const AnalyzeResponseSchema = z.object({
  task_id: z.string().describe("A unique ID for the analysis task"),
  backend: z.enum(["redis", "in-memory"]).describe("The backend used for processing"),
});

export const SuccessResponseSchema = z.object({
  state: z.literal("SUCCESS"),
  result: AnalysisResultSchema,
});

export const StatusResponseSchema = z.object({
  state: z.enum(["PENDING", "PROCESSING"]),
  status: z.string().describe("A message describing the current status"),
});

export const FailureResponseSchema = z.object({
  state: z.literal("FAILURE"),
  status: z.string().describe("A message describing the error"),
});

export const NotFoundResponseSchema = z.object({
  state: z.literal("NOT_FOUND"),
  status: z.string().default("Task not found"),
});

export const ErrorResponseSchema = z.object({
  state: z.literal("ERROR"),
  status: z.string().describe("Error description"),
});

export const TaskResultResponseSchema = z.union([
  SuccessResponseSchema,
  StatusResponseSchema,
  FailureResponseSchema,
  NotFoundResponseSchema,
  ErrorResponseSchema,
]);

export const HTTPErrorSchema = z.object({
  detail: z.string().describe("Error description"),
});

// Configuration schema
export const ConfigSchema = z.object({
  port: z.number().default(8000),
  log_level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).default("INFO"),
  redis_url: z.string().optional(),
  min_note_duration: z.number().default(0.05),
  python_executable: z.string().default("python3"),
  rhythm_engine_path: z.string().default("../rhythm_engine/run.py"),
  upload_dir: z.string().default("./uploads"),
  max_file_size: z.number().default(50 * 1024 * 1024), // 50MB
});

// TypeScript types derived from schemas
export type MelodyNote = z.infer<typeof MelodyNoteSchema>;
export type AnalysisInfo = z.infer<typeof AnalysisInfoSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
export type FailureResponse = z.infer<typeof FailureResponseSchema>;
export type NotFoundResponse = z.infer<typeof NotFoundResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type TaskResultResponse = z.infer<typeof TaskResultResponseSchema>;
export type HTTPError = z.infer<typeof HTTPErrorSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// Supported audio MIME types
export const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav", 
  "audio/x-wav",
  "audio/mp3",
] as const;

export type SupportedAudioType = typeof SUPPORTED_AUDIO_TYPES[number];