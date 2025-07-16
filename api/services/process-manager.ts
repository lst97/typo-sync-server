import { logger } from "../utils/logger.ts";
import { PythonIPCService } from "./python-ipc.ts";
import { RedisTaskManager } from "./task-manager.ts";
import { config } from "../config/config.ts";

/**
 * Process manager for handling cleanup of all active processes and connections
 */
export class ProcessManager {
	private static instance: ProcessManager | null = null;
	private pythonIPCService: PythonIPCService | null = null;
	private taskManager: RedisTaskManager | null = null;

	private constructor() {}

	static getInstance(): ProcessManager {
		if (!ProcessManager.instance) {
			ProcessManager.instance = new ProcessManager();
		}
		return ProcessManager.instance;
	}

	/**
	 * Register services for cleanup
	 */
	registerPythonIPCService(service: PythonIPCService): void {
		this.pythonIPCService = service;
	}

	registerTaskManager(taskManager: RedisTaskManager): void {
		this.taskManager = taskManager;
	}

	/**
	 * Clean up all active processes and connections
	 */
	async cleanupAll(): Promise<void> {
		logger.info("Starting process cleanup...");

		const cleanupPromises: Promise<void>[] = [];

		// Terminate Python processes
		if (this.pythonIPCService) {
			cleanupPromises.push(
				this.pythonIPCService.terminateAllProcesses().catch((error) => {
					logger.error(
						"Error terminating Python processes",
						error instanceof Error ? error : new Error(String(error))
					);
				})
			);
		}

		// Close Redis connections
		if (this.taskManager) {
			this.taskManager.forceDisconnect();
		}

		// Clean up temporary files
		cleanupPromises.push(
			this.cleanupTempFiles().catch((error) => {
				logger.error(
					"Error cleaning up temporary files",
					error instanceof Error ? error : new Error(String(error))
				);
			})
		);

		// Execute all cleanup tasks in parallel
		await Promise.all(cleanupPromises);

		logger.info("Process cleanup completed");
	}

	/**
	 * Clean up temporary files
	 */
	private async cleanupTempFiles(): Promise<void> {
		try {
			const uploadDir = config.config.upload_dir;

			// Check if upload directory exists
			try {
				const stat = await Deno.stat(uploadDir);
				if (!stat.isDirectory) {
					logger.debug("Upload directory is not a directory", { uploadDir });
					return;
				}
			} catch {
				logger.debug("Upload directory does not exist", { uploadDir });
				return;
			}

			// Clean up temporary files in upload directory
			const tempFiles: string[] = [];

			for await (const entry of Deno.readDir(uploadDir)) {
				if (entry.isFile) {
					// Clean up task-specific files (format: {taskId}_{filename})
					const isTaskFile = /^[0-9A-Z]{26}_/.test(entry.name);

					// Clean up any .tmp files
					const isTempFile = entry.name.endsWith(".tmp");

					if (isTaskFile || isTempFile) {
						tempFiles.push(entry.name);
					}
				}
			}

			// Remove temporary files
			for (const fileName of tempFiles) {
				try {
					const filePath = `${uploadDir}/${fileName}`;
					await Deno.remove(filePath);
					logger.debug("Removed temporary file", { filePath });
				} catch (error) {
					logger.warn(
						"Failed to remove temporary file",
						error instanceof Error ? error : new Error(String(error)),
						{ fileName }
					);
				}
			}

			if (tempFiles.length > 0) {
				logger.info(`Cleaned up ${tempFiles.length} temporary files`);
			}
		} catch (error) {
			logger.error(
				"Error during temp file cleanup",
				error instanceof Error ? error : new Error(String(error))
			);
		}
	}

	/**
	 * Get status of all managed processes
	 */
	getProcessStatus(): {
		pythonProcesses: number;
		redisConnected: boolean;
	} {
		return {
			pythonProcesses: this.pythonIPCService?.getActiveProcessCount() || 0,
			redisConnected: this.taskManager !== null,
		};
	}
}

// Export singleton instance
export const processManager = ProcessManager.getInstance();
