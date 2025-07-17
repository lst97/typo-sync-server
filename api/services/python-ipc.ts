import { logger } from "../utils/logger.ts";
import { config } from "../config/config.ts";
import type { AnalysisResult } from "../types/schemas.ts";

export interface IPCResult {
	success: boolean;
	data?: AnalysisResult;
	error?: string;
}

export class PythonIPCService {
	private readonly pythonExecutable: string;
	private readonly scriptPath: string;
	private readonly activeProcesses = new Set<Deno.ChildProcess>();

	constructor() {
		this.pythonExecutable = config.config.python_executable;
		this.scriptPath = config.config.rhythm_engine_path;
	}

	async analyzeAudio(filePath: string): Promise<IPCResult> {
		logger.info("Starting Python IPC analysis", { filePath });

		let process: Deno.ChildProcess | null = null;
		
		try {
			// Verify the Python script exists
			await this.validatePythonScript();

			// Execute the Python script
			const command = new Deno.Command(this.pythonExecutable, {
				args: [this.scriptPath, filePath],
				stdout: "piped",
				stderr: "piped",
			});

			logger.debug("Executing Python command", {
				executable: this.pythonExecutable,
				script: this.scriptPath,
				args: [filePath],
			});

			process = command.spawn();
			
			// Track active process for cleanup
			this.activeProcesses.add(process);
			
			const { code, stdout, stderr } = await process.output();
			
			// Close the process streams and remove from active processes
			try {
				await process.stdout.cancel();
				await process.stderr.cancel();
			} catch (closeError) {
				logger.debug("Process streams already closed", { 
					error: closeError instanceof Error ? closeError.message : String(closeError) 
				});
			}
			this.activeProcesses.delete(process);

			// Log the process completion
			logger.debug("Python process completed", { exitCode: code });

			// Handle non-zero exit codes
			if (code !== 0) {
				const errorMessage = new TextDecoder().decode(stderr);
				logger.error("Python script failed", undefined, {
					exitCode: code,
					stderr: errorMessage,
				});

				// Try to extract JSON error from stderr
				const lines = errorMessage.split("\n");
				let jsonError = null;

				for (const line of lines) {
					if (line.trim().startsWith('{"error":')) {
						try {
							jsonError = JSON.parse(line.trim());
							break;
						} catch (e) {
							logger.error(
								"Failed to parse JSON.",
								e instanceof Error ? e : new Error(String(e)),
								{ line }
							);
						}
					}
				}

				if (jsonError && jsonError.error === true) {
					return {
						success: false,
						error: `Analysis failed: ${jsonError.message}`,
					};
				}

				return {
					success: false,
					error: `Analysis failed: ${
						errorMessage || `Process exited with code ${code}`
					}`,
				};
			}

			// Parse the stdout as JSON
			const outputText = new TextDecoder().decode(stdout);
			logger.debug("Raw Python output", { outputLength: outputText.length });

			if (!outputText.trim()) {
				logger.error("Python script produced no output");
				return {
					success: false,
					error: "Analysis script produced no output",
				};
			}

			try {
				const parsedResponse = JSON.parse(outputText);
				logger.debug("Raw parsed response from Python", { parsedResponse });

				// Check if this is a wrapped response format
				if (parsedResponse.error === false && parsedResponse.data) {
					// This is a success response with wrapped data
					const result = parsedResponse.data as AnalysisResult;
					logger.info("Successfully parsed analysis result", {
						bpm: result.bpm,
						totalBeats: result.analysis_info?.total_beats,
						notesCount: result.melody_map?.length,
					});

					return {
						success: true,
						data: result,
					};
				} else if (parsedResponse.error === true) {
					// This is an error response
					logger.error("Python analysis returned error", undefined, {
						errorType: parsedResponse.error_type,
						message: parsedResponse.message,
					});
					return {
						success: false,
						error: `Analysis failed: ${parsedResponse.message}`,
					};
				} else {
					// Try to parse as direct AnalysisResult (backwards compatibility)
					const result = parsedResponse as AnalysisResult;
					logger.info("Successfully parsed analysis result (legacy format)", {
						bpm: result.bpm,
						totalBeats: result.analysis_info?.total_beats,
						notesCount: result.melody_map?.length,
					});

					return {
						success: true,
						data: result,
					};
				}
			} catch (parseError) {
				logger.error(
					"Failed to parse Python output as JSON",
					parseError instanceof Error
						? parseError
						: new Error(String(parseError)),
					{
						output: outputText.substring(0, 500), // Log first 500 chars for debugging
					}
				);
				return {
					success: false,
					error: `Invalid JSON output from analysis script: ${
						parseError instanceof Error
							? parseError.message
							: String(parseError)
					}`,
				};
			}
		} catch (error) {
			logger.error(
				"IPC communication failed",
				error instanceof Error ? error : new Error(String(error))
			);
			
			// Clean up any zombie processes
			if (process) {
				try {
					await process.stdout.cancel();
					await process.stderr.cancel();
					this.activeProcesses.delete(process);
				} catch (cleanupError) {
					logger.warn("Failed to clean up process during error", 
						cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
					);
				}
			}
			
			return {
				success: false,
				error: `IPC communication error: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	}

	private async validatePythonScript(): Promise<void> {
		let testProcess: Deno.ChildProcess | null = null;
		
		try {
			// Check if the script file exists
			const scriptStat = await Deno.stat(this.scriptPath);
			if (!scriptStat.isFile) {
				throw new Error(`Python script is not a file: ${this.scriptPath}`);
			}

			// Test if Python executable is available
			const testCommand = new Deno.Command(this.pythonExecutable, {
				args: ["--version"],
				stdout: "piped",
				stderr: "piped",
			});

			testProcess = testCommand.spawn();
			
			// Track test process for cleanup
			this.activeProcesses.add(testProcess);
			
			const { code } = await testProcess.output();
			
			// Close the test process streams and remove from active processes
			try {
				await testProcess.stdout.cancel();
				await testProcess.stderr.cancel();
			} catch (closeError) {
				logger.debug("Test process streams already closed", { 
					error: closeError instanceof Error ? closeError.message : String(closeError) 
				});
			}
			this.activeProcesses.delete(testProcess);

			if (code !== 0) {
				throw new Error(
					`Python executable not working: ${this.pythonExecutable}`
				);
			}

			logger.debug("Python script validation successful", {
				executable: this.pythonExecutable,
				script: this.scriptPath,
			});
		} catch (error) {
			logger.error(
				"Python script validation failed",
				error instanceof Error ? error : new Error(String(error))
			);
			
			// Clean up test process on error
			if (testProcess) {
				try {
					await testProcess.stdout.cancel();
					await testProcess.stderr.cancel();
					this.activeProcesses.delete(testProcess);
				} catch (cleanupError) {
					logger.warn("Failed to clean up test process during error", 
						cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
					);
				}
			}
			
			throw new Error(
				`Python script validation failed: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
		try {
			await this.validatePythonScript();
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Terminate all active Python processes during shutdown
	 */
	async terminateAllProcesses(): Promise<void> {
		logger.info("Terminating Python processes", { 
			activeProcessCount: this.activeProcesses.size 
		});

		const terminationPromises = Array.from(this.activeProcesses).map(async (process) => {
			try {
				// Try graceful termination first
				process.kill("SIGTERM");
				
				// Wait a bit for graceful shutdown
				await new Promise(resolve => setTimeout(resolve, 2000));
				
				// Force kill if still running
				try {
					process.kill("SIGKILL");
				} catch (killError) {
					// Process might already be dead
					logger.debug("Process already terminated", { 
						error: killError instanceof Error ? killError.message : String(killError) 
					});
				}
				
				// Close streams and remove from active processes
				try {
					await process.stdout.cancel();
					await process.stderr.cancel();
				} catch (closeError) {
					logger.debug("Process streams already closed", { 
						error: closeError instanceof Error ? closeError.message : String(closeError) 
					});
				}
				
				this.activeProcesses.delete(process);
				
				logger.debug("Python process terminated");
			} catch (error) {
				logger.error("Error terminating Python process", 
					error instanceof Error ? error : new Error(String(error))
				);
			}
		});

		await Promise.all(terminationPromises);
		
		// Clear the set
		this.activeProcesses.clear();
		
		logger.info("All Python processes terminated");
	}

	/**
	 * Get count of active Python processes
	 */
	getActiveProcessCount(): number {
		return this.activeProcesses.size;
	}
}
