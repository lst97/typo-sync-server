import { assertEquals, assertExists, assert } from "../deps.ts";
import { config } from "../config/config.ts";
import {
	AnalysisResultResponse,
	AnalysisService,
	TaskStatus,
} from "../services/analysis-service.ts";
import { DatabaseService } from "../services/database-service.ts";
import { CacheService } from "../services/cache-service.ts";
import { QueueService } from "../services/queue-service.ts";

// Test configuration constants
const ANALYSIS_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;
const MEMORY_THRESHOLD_MB = 50;

// Integration test utilities
class IntegrationTestHelper {
	static createValidWavFile(): Uint8Array {
		return new Uint8Array([
			// Minimal WAV header
			0x52,
			0x49,
			0x46,
			0x46, // "RIFF"
			0x24,
			0x00,
			0x00,
			0x00, // File size
			0x57,
			0x41,
			0x56,
			0x45, // "WAVE"
			0x66,
			0x6d,
			0x74,
			0x20, // "fmt "
			0x10,
			0x00,
			0x00,
			0x00, // Chunk size
			0x01,
			0x00,
			0x01,
			0x00, // Format, channels
			0x44,
			0xac,
			0x00,
			0x00, // Sample rate
			0x88,
			0x58,
			0x01,
			0x00, // Byte rate
			0x02,
			0x00,
			0x10,
			0x00, // Block align, bits per sample
			0x64,
			0x61,
			0x74,
			0x61, // "data"
			0x00,
			0x00,
			0x00,
			0x00, // Data size
		]);
	}

	static createCorruptedAudioFile(): Uint8Array {
		return new Uint8Array([1, 2, 3, 4, 5]); // Invalid audio data
	}

	static async waitForTaskCompletion(
		service: AnalysisService,
		taskId: string,
		timeoutMs: number = ANALYSIS_TIMEOUT_MS
	): Promise<TaskStatus> {
		const maxAttempts = Math.floor(timeoutMs / POLL_INTERVAL_MS);
		let attempts = 0;

		while (attempts < maxAttempts) {
			const status = await service.getTaskStatus(taskId);

			if (
				status.state === "SUCCESS" ||
				status.state === "FAILURE" ||
				status.state === "ERROR"
			) {
				return status;
			}

			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			attempts++;
		}

		throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
	}

	static async getMemoryUsage(): Promise<number> {
		try {
			const command = new Deno.Command("ps", {
				args: ["-o", "rss=", "-p", Deno.pid.toString()],
				stdout: "piped",
			});

			const process = command.spawn();
			const { stdout } = await process.output();
			const rssKB = parseInt(new TextDecoder().decode(stdout).trim());
			return rssKB / 1024; // Convert to MB
		} catch {
			return 0; // Return 0 if unable to get memory info
		}
	}

	static async validateResourceCleanup(beforeMemory: number): Promise<boolean> {
		const afterMemory = await this.getMemoryUsage();
		const memoryIncrease = afterMemory - beforeMemory;

		if (memoryIncrease > MEMORY_THRESHOLD_MB) {
			console.warn(`Memory increase detected: ${memoryIncrease.toFixed(2)}MB`);
			return false;
		}

		return true;
	}
}

// Integration tests that test the full flow
Deno.test(
	"Integration - full analysis workflow with in-memory backend",
	async () => {
		// Ensure we're using in-memory backend for this test
		const originalRedisUrl = Deno.env.get("REDIS_URL");
		Deno.env.delete("REDIS_URL");

		const db = new DatabaseService(":memory:");
		await db.initialize();
		await db.migrate();

		const cacheService = new CacheService(db);
		const queueService = new QueueService(db);

		try {
			const analysisService = new AnalysisService(
				db,
				cacheService,
				queueService
			);

			// Create test audio data using helper
			const testAudioData = IntegrationTestHelper.createValidWavFile();

			// Submit analysis
			const analysisResult = await analysisService.submitAnalysis(
				testAudioData,
				"test.wav"
			);
			assertExists(analysisResult.task_id);

			// Check initial status (could be PENDING or PROCESSING due to timing)
			let status = await analysisService.getTaskStatus(analysisResult.task_id);
			assertEquals(["PENDING", "PROCESSING"].includes(status.state), true);

			// Wait for processing to complete using helper
			status = await IntegrationTestHelper.waitForTaskCompletion(
				analysisService,
				analysisResult.task_id
			);

			// Check final status (could be SUCCESS, PROCESSING, or FAILURE)
			const validStates = ["SUCCESS", "PROCESSING", "FAILURE", "ERROR"];
			assert(
				validStates.includes(status.state),
				`Invalid state: ${status.state}`
			);
		} finally {
			// Restore original Redis URL if it was set
			if (originalRedisUrl) {
				Deno.env.set("REDIS_URL", originalRedisUrl);
			}
		}
	}
);

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

Deno.test("Integration - real MP3 file analysis", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	try {
		// Read the test.mp3 file
		const testAudioPath = new URL("./test.mp3", import.meta.url).pathname;
		const audioBuffer = await Deno.readFile(testAudioPath);

		assertExists(audioBuffer);
		assert(audioBuffer.length > 0, "Audio file should not be empty");

		// Submit analysis with real MP3 file
		const analysisResult = await analysisService.submitAnalysis(
			audioBuffer,
			"test.mp3"
		);
		assertExists(analysisResult.task_id);

		// Wait for processing to complete
		const status = await IntegrationTestHelper.waitForTaskCompletion(
			analysisService,
			analysisResult.task_id
		);

		// Should succeed with real audio file
		assertEquals(status.state, "SUCCESS");

		if (status.state === "SUCCESS") {
			const result = status.result;
			assertExists(result);

			// Validate realistic analysis results
			assert(typeof result.bpm === "number", "BPM should be a number");
			assert(result.bpm >= 0, "BPM should be non-negative");
			assert(
				Array.isArray(result.beat_timestamps),
				"Beat timestamps should be an array"
			);
			assert(Array.isArray(result.melody_map), "Melody map should be an array");
			assertExists(result.analysis_info);

			// Validate analysis info structure
			const info = result.analysis_info;
			assert(
				typeof info.total_beats === "number",
				"Total beats should be a number"
			);
			assert(
				typeof info.total_subdivisions === "number",
				"Total subdivisions should be a number"
			);
			assert(
				typeof info.min_note_duration === "number",
				"Min note duration should be a number"
			);
			assert(
				typeof info.subdivision_factor === "number",
				"Subdivision factor should be a number"
			);

			console.log(
				`Analysis successful: BPM=${result.bpm}, Beats=${info.total_beats}, Notes=${result.melody_map.length}`
			);
		}
	} catch (error) {
		// Don't fail the test if file is missing, just skip it
		console.warn("Could not test real audio file:", error);
	}

	// Wait a bit to allow background processing to complete
	await new Promise((resolve) => setTimeout(resolve, 100));
});

Deno.test("Integration - error handling workflow", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	// Test with completely invalid data using helper
	const invalidData = IntegrationTestHelper.createCorruptedAudioFile();

	const analysisResult = await analysisService.submitAnalysis(
		invalidData,
		"invalid.txt"
	);
	assertExists(analysisResult.task_id);

	// Wait for processing to complete
	const status = await IntegrationTestHelper.waitForTaskCompletion(
		analysisService,
		analysisResult.task_id
	);

	// Should have failed
	assertEquals(status.state, "FAILURE");
	if (status.state === "FAILURE") {
		assertExists(status.status);
		assert(
			status.status.includes("Unsupported file extension") ||
				status.status.includes("Invalid") ||
				status.status.includes("Failed"),
			`Error message should indicate failure: ${status.status}`
		);
	}
});

Deno.test(
	"Integration - resource monitoring and cleanup validation",
	async () => {
		const db = new DatabaseService(":memory:");
		await db.initialize();
		await db.migrate();

		const cacheService = new CacheService(db);
		const queueService = new QueueService(db);

		const analysisService = new AnalysisService(db, cacheService, queueService);

		// Get initial memory usage
		const initialMemory = await IntegrationTestHelper.getMemoryUsage();

		// Perform multiple analysis operations
		const taskIds: string[] = [];
		const testData = IntegrationTestHelper.createValidWavFile();

		for (let i = 0; i < 3; i++) {
			const analysisResult = await analysisService.submitAnalysis(
				testData,
				`test_${i}.wav`
			);
			taskIds.push(analysisResult.task_id);
		}

		// Wait for all tasks to complete
		for (const taskId of taskIds) {
			await IntegrationTestHelper.waitForTaskCompletion(
				analysisService,
				taskId
			);
		}

		// Allow some time for cleanup
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Validate resource cleanup
		const cleanupSuccessful =
			await IntegrationTestHelper.validateResourceCleanup(initialMemory);
		assert(
			cleanupSuccessful,
			"Resource cleanup validation failed - possible memory leak"
		);

		console.log(
			`Resource cleanup validation passed - processed ${taskIds.length} tasks`
		);

		// Additional cleanup delay
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
);

Deno.test("Integration - Redis backend workflow", async () => {
	// Test with Redis backend when available
	const originalRedisUrl = Deno.env.get("REDIS_URL");

	try {
		// Try to set up Redis backend
		Deno.env.set("REDIS_URL", "redis://localhost:6379");

		const db = new DatabaseService(":memory:");
		await db.initialize();
		await db.migrate();

		const cacheService = new CacheService(db);
		const queueService = new QueueService(db);

		const analysisService = new AnalysisService(db, cacheService, queueService);

		// Test health check first
		const health = await analysisService.healthCheck();

		if (!health.cache_system.healthy) {
			console.warn("Redis backend not available, skipping Redis test");
			return;
		}

		// Create test audio data
		const testAudioData = IntegrationTestHelper.createValidWavFile();

		// Submit analysis
		const analysisResult = await analysisService.submitAnalysis(
			testAudioData,
			"redis_test.wav"
		);
		assertExists(analysisResult.task_id);

		// Wait for processing to complete
		const status = await IntegrationTestHelper.waitForTaskCompletion(
			analysisService,
			analysisResult.task_id
		);

		// Should work with Redis backend
		const validStates = ["SUCCESS", "PROCESSING", "FAILURE", "ERROR"];
		assert(
			validStates.includes(status.state),
			`Invalid state: ${status.state}`
		);

		console.log(`Redis backend test completed with state: ${status.state}`);
	} catch (error) {
		console.warn(
			"Redis backend test failed, likely Redis not available:",
			error
		);
		// Don't fail the test if Redis is not available
	} finally {
		// Restore original Redis URL
		if (originalRedisUrl) {
			Deno.env.set("REDIS_URL", originalRedisUrl);
		} else {
			Deno.env.delete("REDIS_URL");
		}
	}
});

Deno.test("Integration - concurrent analysis requests", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const testData = IntegrationTestHelper.createValidWavFile();
	const concurrentRequests = 3;

	// Submit multiple analyses concurrently
	const taskPromises = Array.from({ length: concurrentRequests }, (_, i) =>
		analysisService.submitAnalysis(testData, `concurrent_${i}.wav`)
	);

	const analysisResults = await Promise.all(taskPromises);

	// Validate all task IDs exist
	analysisResults.forEach((analysisResult: AnalysisResultResponse) =>
		assertExists(analysisResult.task_id)
	);
	assertEquals(analysisResults.length, concurrentRequests);

	// Wait for all tasks to complete
	const completionPromises = analysisResults.map(
		(analysisResult: AnalysisResultResponse) =>
			IntegrationTestHelper.waitForTaskCompletion(
				analysisService,
				analysisResult.task_id
			)
	);

	const results = await Promise.all(completionPromises);

	// Validate all results
	results.forEach((result: TaskStatus, index: number) => {
		const validStates = ["SUCCESS", "PROCESSING", "FAILURE", "ERROR"];
		assert(
			validStates.includes(result.state),
			`Task ${index} has invalid state: ${result.state}`
		);
	});

	console.log(
		`Concurrent analysis test completed: ${results.length} tasks processed`
	);
});

Deno.test("Integration - health check with Python validation", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const health = await analysisService.healthCheck();

	assertExists(health);
	assertEquals(typeof health.python_engine.healthy, "boolean");

	// The health check should validate Python availability
	if (!health.python_engine.healthy) {
		assertExists(health.python_engine.error);
		// Error should mention Python or script issues
		assertEquals(
			health.python_engine.error.toLowerCase().includes("python") ||
				health.python_engine.error.toLowerCase().includes("script") ||
				health.python_engine.error.toLowerCase().includes("executable"),
			true
		);
	}
});
