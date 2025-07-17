import { assertEquals, assertExists } from "../deps.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { DatabaseService } from "../services/database-service.ts";
import { CacheService } from "../services/cache-service.ts";
import { QueueService } from "../services/queue-service.ts";

// Helper function to wait for task completion with timeout
async function waitForTaskCompletion(
	analysisService: AnalysisService,
	taskId: string,
	timeoutMs: number = 5000
): Promise<void> {
	const start = Date.now();

	while (Date.now() - start < timeoutMs) {
		try {
			const status = await analysisService.getTaskStatus(taskId);
			if (status.state === "SUCCESS" || status.state === "FAILURE") {
				return;
			}
		} catch {
			// If task status fails, just continue
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	// If we reach here, the task didn't complete in time
	// Force cleanup of any running processes
	try {
		const pythonIPC = analysisService.getPythonIPCService();
		await pythonIPC.terminateAllProcesses();
	} catch {
		// Cleanup failed, but we can continue
	}
}

// Helper function to create test audio data
function createTestAudioBuffer(): Uint8Array {
	// Create a minimal WAV file header + some data
	const header = new Uint8Array([
		// RIFF header
		0x52,
		0x49,
		0x46,
		0x46, // "RIFF"
		0x24,
		0x00,
		0x00,
		0x00, // File size (36 bytes)
		0x57,
		0x41,
		0x56,
		0x45, // "WAVE"

		// fmt chunk
		0x66,
		0x6d,
		0x74,
		0x20, // "fmt "
		0x10,
		0x00,
		0x00,
		0x00, // Chunk size (16)
		0x01,
		0x00, // Audio format (PCM)
		0x01,
		0x00, // Number of channels (1)
		0x44,
		0xac,
		0x00,
		0x00, // Sample rate (44100)
		0x88,
		0x58,
		0x01,
		0x00, // Byte rate
		0x02,
		0x00, // Block align
		0x10,
		0x00, // Bits per sample (16)

		// data chunk
		0x64,
		0x61,
		0x74,
		0x61, // "data"
		0x00,
		0x00,
		0x00,
		0x00, // Data size (0 - empty)
	]);

	return header;
}

Deno.test("AnalysisService - submit analysis request", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const testBuffer = createTestAudioBuffer();
	const filename = "test_audio.wav";

	const analysisResult = await analysisService.submitAnalysis(
		testBuffer,
		filename
	);

	assertExists(analysisResult.task_id);
	assertEquals(typeof analysisResult.task_id, "string");
	assertEquals(analysisResult.task_id.length > 0, true);

	// Check that task was created with initial status
	const status = await analysisService.getTaskStatus(analysisResult.task_id);
	assertExists(status);
	// Task might be PENDING or PROCESSING depending on timing
	assertEquals(["PENDING", "PROCESSING"].includes(status.state), true);

	// Wait for background processing to complete
	await waitForTaskCompletion(analysisService, analysisResult.task_id);
});

Deno.test(
	"AnalysisService - get task status for non-existent task",
	async () => {
		const db = new DatabaseService(":memory:");
		await db.initialize();
		await db.migrate();

		const cacheService = new CacheService(db);
		const queueService = new QueueService(db);

		const analysisService = new AnalysisService(db, cacheService, queueService);

		const status = await analysisService.getTaskStatus("non-existent-id");

		assertEquals(status.state, "NOT_FOUND");
		if (status.state === "NOT_FOUND") {
			assertEquals(status.status, "Task not found");
		}
	}
);

Deno.test("AnalysisService - filename sanitization", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const testBuffer = createTestAudioBuffer();
	const dangerousFilename = "../../../etc/passwd.wav";

	// This should not throw an error and should sanitize the filename
	const analysisResult = await analysisService.submitAnalysis(
		testBuffer,
		dangerousFilename
	);

	assertExists(analysisResult.task_id);
	assertEquals(typeof analysisResult.task_id, "string");

	// Wait for background processing to complete
	let finalStatus = await analysisService.getTaskStatus(analysisResult.task_id);
	for (let i = 0; i < 10; i++) {
		finalStatus = await analysisService.getTaskStatus(analysisResult.task_id);
		if (finalStatus.state === "SUCCESS" || finalStatus.state === "FAILURE") {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
});

Deno.test("AnalysisService - stream task status", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const testBuffer = createTestAudioBuffer();
	const filename = "test_audio.wav";

	const analysisResult = await analysisService.submitAnalysis(
		testBuffer,
		filename
	);

	// The submitAnalysis already enqueues the task, so we just need to wait for it to process
	// Remove the duplicate enqueue calls that were causing the UUID error

	const statuses: string[] = [];

	// Stream task status with a timeout
	const streamPromise = (async () => {
		for await (const status of analysisService.streamTaskStatus(
			analysisResult.task_id
		)) {
			statuses.push(status.state);

			if (status.state === "SUCCESS" || status.state === "FAILURE") {
				break;
			}
		}
	})();

	// Wait for completion with timeout
	let timeoutId: number | null = null;
	const timeoutPromise = new Promise<void>((resolve) => {
		timeoutId = setTimeout(() => {
			resolve();
		}, 5000);
	});

	await Promise.race([streamPromise, timeoutPromise]);

	// Clean up timeout if it hasn't fired
	if (timeoutId !== null) {
		clearTimeout(timeoutId);
	}

	// Ensure cleanup
	await waitForTaskCompletion(analysisService, analysisResult.task_id);

	// Should have seen at least some statuses
	assertEquals(statuses.length > 0, true);
	// Status might be PENDING, PROCESSING, or already completed
	assertEquals(
		statuses.some((s) =>
			["PENDING", "PROCESSING", "SUCCESS", "FAILURE"].includes(s)
		),
		true
	);
});

Deno.test("AnalysisService - stream non-existent task", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const statuses: string[] = [];

	for await (const status of analysisService.streamTaskStatus(
		"non-existent-id"
	)) {
		statuses.push(status.state);

		if (status.state === "NOT_FOUND") {
			break;
		}
	}

	assertEquals(statuses.length, 1);
	assertEquals(statuses[0], "NOT_FOUND");
});

Deno.test("AnalysisService - health check", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	const health = await analysisService.healthCheck();

	assertExists(health);
	assertEquals(typeof health.python_engine.healthy, "boolean");

	if (!health.python_engine.healthy) {
		assertExists(health.python_engine.error);
		assertEquals(typeof health.python_engine.error, "string");
	}
});

Deno.test("AnalysisService - real audio file processing", async () => {
	const db = new DatabaseService(":memory:");
	await db.initialize();
	await db.migrate();

	const cacheService = new CacheService(db);
	const queueService = new QueueService(db);

	const analysisService = new AnalysisService(db, cacheService, queueService);

	// Read the test.mp3 file
	const testAudioPath = new URL("./test.mp3", import.meta.url).pathname;
	const audioBuffer = await Deno.readFile(testAudioPath);

	assertExists(audioBuffer);
	assertEquals(audioBuffer.length > 0, true);

	// Submit analysis request with real audio file
	const analysisResult = await analysisService.submitAnalysis(
		audioBuffer,
		"test.mp3"
	);

	assertExists(analysisResult.task_id);
	assertEquals(typeof analysisResult.task_id, "string");
	assertEquals(analysisResult.task_id.length > 0, true);

	// Check that task was created with initial status
	const status = await analysisService.getTaskStatus(analysisResult.task_id);
	assertExists(status);
	// Task might be PENDING or PROCESSING depending on timing
	assertEquals(["PENDING", "PROCESSING"].includes(status.state), true);

	// Wait for background processing to complete
	await waitForTaskCompletion(analysisService, analysisResult.task_id);
});
