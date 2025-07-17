import { ensureDir, join } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import { PythonIPCService } from "./python-ipc.ts";
import { AudioHashService } from "./audio-hash-service.ts";
import { CacheService } from "./cache-service.ts";
import { QueueService } from "./queue-service.ts";
import { DatabaseService } from "./database-service.ts";
import { AudioFingerprint } from "../types/domain.ts";
import type { AnalysisResult } from "../types/schemas.ts";

export interface AnalysisResultResponse {
	task_id: string;
	backend: string;
	cache_hit: boolean;
	queue_position?: number;
	estimated_wait_time_minutes?: number;
	result?: AnalysisResult; // Include result directly for cache hits
}

export type TaskStatus = {
	state:
		| "SUCCESS"
		| "FAILURE"
		| "PENDING"
		| "PROCESSING"
		| "NOT_FOUND"
		| "ERROR";
	status: string;
	result?: AnalysisResult;
	queue_position?: number;
	estimated_wait_time_minutes?: number;
};

export class AnalysisService {
	private readonly pythonIPC: PythonIPCService;
	private readonly audioHashService: AudioHashService;
	private readonly cacheService: CacheService;
	private readonly queueService: QueueService;
	private readonly db: DatabaseService;

	constructor(
		db: DatabaseService,
		cacheService: CacheService,
		queueService: QueueService
	) {
		this.db = db;
		this.cacheService = cacheService;
		this.queueService = queueService;
		this.pythonIPC = new PythonIPCService();
		this.audioHashService = new AudioHashService();
	}

	async submitAnalysis(
		fileBuffer: Uint8Array,
		filename: string,
		priority: "high" | "normal" | "batch" = "normal"
	): Promise<AnalysisResultResponse> {
		logger.info("Submitting analysis request", { filename, priority });

		try {
			// Generate audio hashes
			const metadata = {
				fileSize: fileBuffer.length,
				duration: this.estimateAudioDuration(fileBuffer),
				format: this.extractFormat(filename),
			};

			const hashes = await this.audioHashService.generateAllHashes(
				fileBuffer,
				metadata
			);

			// Check cache first
			const cachedResult = await this.cacheService.get(hashes.contentHash);

			if (cachedResult) {
				logger.info("Cache hit for audio analysis", {
					contentHash: hashes.contentHash.substring(0, 8) + "...",
				});

				// Return the cached result directly without creating a streamable task
				// Use a special task ID format that indicates this is a completed cache hit
				const taskId = `cache_hit_${Date.now()}`;

				return {
					task_id: taskId,
					backend: config.backend,
					cache_hit: true,
					result: cachedResult,
				};
			}

			// Check if audio fingerprint already exists
			let savedFingerprint = await this.db.audioRepository.findByContentHash(
				hashes.contentHash
			);

			if (!savedFingerprint) {
				// Save new audio fingerprint to database
				const fingerprint = new AudioFingerprint({
					contentHash: hashes.contentHash,
					perceptualHash: hashes.perceptualHash,
					metadataHash: hashes.metadataHash,
					fileSize: metadata.fileSize,
					durationSeconds: metadata.duration,
					format: metadata.format,
				});

				savedFingerprint = await this.db.audioRepository.save(fingerprint);
			}

			// Enqueue for processing
			const taskId = await this.queueService.enqueue(
				savedFingerprint.id!,
				priority
			);

			// Get queue position
			const queuePosition = await this.queueService.getQueuePosition(taskId);

			// Save uploaded file for processing
			const filePath = await this.saveUploadedFile(
				fileBuffer,
				filename,
				taskId
			);

			// Start background processing
			this.processAnalysisAsync(taskId, filePath, hashes.contentHash);

			logger.info("Analysis task created", {
				taskId,
				filename,
				priority,
				queuePosition: queuePosition?.position,
			});

			return {
				task_id: taskId,
				backend: config.backend,
				cache_hit: false,
				queue_position: queuePosition?.position,
				estimated_wait_time_minutes:
					queuePosition?.getEstimatedWaitTimeMinutes(),
			};
		} catch (error) {
			logger.error(
				"Analysis submission failed",
				error instanceof Error ? error : new Error(String(error))
			);
			throw new Error("Failed to submit analysis request");
		}
	}

	private async processAnalysisAsync(
		taskId: string,
		filePath: string,
		contentHash: string
	): Promise<void> {
		try {
			logger.info("Starting enhanced background analysis", { taskId });

			// Mark processing as started
			await this.queueService.markProcessingStarted(taskId);

			// Perform the analysis via Python IPC
			const result = await this.pythonIPC.analyzeAudio(filePath);

			if (result.success && result.data) {
				// Analysis succeeded - cache the result
				await this.cacheService.set(contentHash, result.data);

				// Mark processing as completed
				await this.queueService.markProcessingCompleted(taskId);

				logger.info("Analysis completed successfully", { taskId });
			} else {
				// Analysis failed
				await this.queueService.markProcessingFailed(
					taskId,
					result.error || "Analysis failed"
				);
				logger.error("Analysis failed", undefined, {
					taskId,
					error: result.error,
				});
			}
		} catch (error) {
			// Unexpected error during processing
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			await this.queueService.markProcessingFailed(taskId, errorMessage);
			logger.error(
				"Unexpected error during analysis",
				error instanceof Error ? error : new Error(String(error)),
				{ taskId }
			);
		} finally {
			// Clean up the uploaded file
			try {
				await Deno.remove(filePath);
				logger.debug("Cleaned up uploaded file", { filePath });
			} catch (cleanupError) {
				logger.warn(
					"Failed to clean up uploaded file",
					cleanupError instanceof Error
						? cleanupError
						: new Error(String(cleanupError)),
					{ filePath }
				);
			}
		}
	}

	async getTaskStatus(taskId: string): Promise<TaskStatus> {
		try {
			// Check if this is a cache hit task
			if (taskId.startsWith("cache_hit_")) {
				// Cache hit tasks are already completed - the result was returned directly
				// Status queries for these tasks should indicate completion
				return {
					state: "SUCCESS",
					status:
						"Cache hit - result was provided directly in the initial response",
				};
			}

			// Legacy support for old cached_ format
			if (taskId.startsWith("cached_")) {
				logger.warn(`Legacy cached task ID format detected: ${taskId}`);
				return {
					state: "SUCCESS",
					status:
						"Cache hit - result was provided directly in the initial response",
				};
			}

			// Get task status from queue
			const queueItem = await this.db.queueRepository.findByTaskId(taskId);

			if (!queueItem) {
				return {
					state: "NOT_FOUND",
					status: "Task not found",
				};
			}

			switch (queueItem.status) {
				case "QUEUED": {
					const position = await this.queueService.getQueuePosition(taskId);
					return {
						state: "PENDING",
						status: "Queued for processing",
						queue_position: position?.position,
						estimated_wait_time_minutes:
							position?.getEstimatedWaitTimeMinutes(),
					};
				}

				case "PROCESSING":
					return {
						state: "PROCESSING",
						status: "Processing audio file...",
					};

				case "COMPLETED": {
					// Get result from cache
					const fingerprint = await this.db.audioRepository.findById(
						queueItem.audioFingerprintId
					);
					if (fingerprint) {
						const cachedResult = await this.cacheService.get(
							fingerprint.contentHash
						);
						if (cachedResult) {
							return {
								state: "SUCCESS",
								status:
									"Cache hit - result was provided directly in the initial response",
								result: cachedResult,
							};
						}
					}
					return {
						state: "FAILURE",
						status: "Result not found in cache",
					};
				}
				case "FAILED":
					return {
						state: "FAILURE",
						status: queueItem.errorMessage || "Processing failed",
					};

				default:
					return {
						state: "ERROR",
						status: "Unknown task status",
					};
			}
		} catch (error) {
			logger.error(
				"Failed to get enhanced task status",
				error instanceof Error ? error : new Error(String(error)),
				{ taskId }
			);
			return {
				state: "ERROR",
				status: "Failed to retrieve task status",
			};
		}
	}

	async *streamTaskStatus(taskId: string): AsyncGenerator<TaskStatus> {
		logger.info("Starting enhanced task status stream", { taskId });

		// Handle cache hit tasks immediately
		if (taskId.startsWith("cache_hit_") || taskId.startsWith("cached_")) {
			const status = await this.getTaskStatus(taskId);
			logger.debug("Cache hit task - streaming final status immediately", {
				taskId,
				finalState: status.state,
			});
			yield status;
			return;
		}

		while (true) {
			const status = await this.getTaskStatus(taskId);

			yield status;

			// Exit conditions
			if (
				status.state === "SUCCESS" ||
				status.state === "FAILURE" ||
				status.state === "NOT_FOUND" ||
				status.state === "ERROR"
			) {
				logger.debug("Enhanced stream terminating", {
					taskId,
					finalState: status.state,
				});
				break;
			}

			// Wait before next poll
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	async healthCheck() {
		const pythonHealth = await this.pythonIPC.healthCheck();
		const queueHealth = await this.queueService.getHealthMetrics();
		const cacheStats = await this.cacheService.getStats();

		return {
			python_engine: pythonHealth,
			queue_system: queueHealth,
			cache_system: {
				healthy: cacheStats.totalHitRate > 0 || cacheStats.totalHitCount === 0,
				hit_rate: cacheStats.totalHitRate,
				total_hits: cacheStats.totalHitCount,
				total_misses: cacheStats.totalMissCount,
			},
		};
	}

	private async saveUploadedFile(
		fileBuffer: Uint8Array,
		filename: string,
		taskId: string
	): Promise<string> {
		const uploadDir = config.config.upload_dir;
		await ensureDir(uploadDir);

		const sanitizedFilename = this.sanitizeFilename(filename);
		const filePath = join(uploadDir, `${taskId}_${sanitizedFilename}`);

		await Deno.writeFile(filePath, fileBuffer);
		logger.debug("File saved", { filePath, size: fileBuffer.length });

		return filePath;
	}

	private sanitizeFilename(filename: string): string {
		return filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
	}

	private estimateAudioDuration(buffer: Uint8Array): number {
		// Simple estimation - in a real system, you'd parse audio headers
		// For now, estimate based on file size (rough approximation)
		return Math.max(1, buffer.length / 32000); // Assume 32kbps average
	}

	private extractFormat(filename: string): string {
		const ext = filename.split(".").pop()?.toLowerCase();
		return ext || "unknown";
	}

	/**
	 * Get the Python IPC service instance for process management
	 */
	getPythonIPCService(): PythonIPCService {
		return this.pythonIPC;
	}
}
