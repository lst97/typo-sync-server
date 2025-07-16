import { Context } from "../deps.ts";
import { logger } from "../utils/logger.ts";
import { AnalysisService } from "../services/analysis-service.ts";
import { SUPPORTED_AUDIO_TYPES } from "../types/schemas.ts";
import { turnstileService } from "../services/turnstile-service.ts";

export class AnalysisController {
	constructor(private analysisService: AnalysisService) {}

	/**
	 * Submit audio file for analysis with caching and queue support
	 * POST /analyze
	 */
	async analyzeAudio(ctx: Context): Promise<void> {
		try {
			const body = ctx.request.body;
			const bodyType = await body.type();

			if (bodyType !== "form-data") {
				ctx.response.status = 400;
				ctx.response.body = {
					error: "Content-Type must be multipart/form-data",
				};
				return;
			}

			let formData: FormData;
			try {
				// Use a timeout for form data parsing to prevent hanging
				const formDataPromise = body.formData();
				const timeoutPromise = new Promise((_, reject) => {
					setTimeout(
						() => reject(new Error("Form data parsing timeout")),
						30000
					);
				});

				formData = (await Promise.race([
					formDataPromise,
					timeoutPromise,
				])) as FormData;
			} catch (error) {
				logger.error(
					"Failed to parse form data",
					error instanceof Error ? error : new Error(String(error))
				);

				// Check if it's a stream controller error
				if (
					error instanceof Error &&
					error.message.includes("stream controller")
				) {
					ctx.response.status = 400;
					ctx.response.body = {
						error:
							"Upload interrupted - please try again with a smaller file or better connection",
					};
					return;
				}

				ctx.response.status = 400;
				ctx.response.body = { error: "Invalid or corrupted form data" };
				return;
			}

			// Validate Turnstile token if provided
			const turnstileToken = formData.get("turnstile_token") as string;
			if (turnstileService.isEnabled()) {
				if (!turnstileToken) {
					ctx.response.status = 400;
					ctx.response.body = {
						error: "Turnstile verification is required for cloud processing",
					};
					return;
				}

				// Get client IP for validation
				const clientIp =
					ctx.request.headers.get("cf-connecting-ip") ||
					ctx.request.headers.get("x-forwarded-for") ||
					ctx.request.headers.get("x-real-ip") ||
					ctx.request.ip;

				const validationResult = await turnstileService.validateToken(
					turnstileToken,
					clientIp
				);

				if (!validationResult.success) {
					logger.warn(
						"Turnstile validation failed",
						new Error(validationResult.error || "Unknown validation error"),
						{
							clientIp,
						}
					);

					ctx.response.status = 403;
					ctx.response.body = {
						error:
							validationResult.error ||
							"Security verification failed. Please complete the Turnstile verification.",
					};
					return;
				}

				logger.info("Turnstile validation successful", {
					clientIp,
					hostname: validationResult.hostname,
				});
			}

			const fileField = formData.get("audio");

			if (!fileField || !(fileField instanceof File)) {
				ctx.response.status = 400;
				ctx.response.body = { error: "No audio file provided" };
				return;
			}

			// Validate file type
			const contentType = fileField.type;
			if (
				!contentType ||
				!SUPPORTED_AUDIO_TYPES.includes(
					contentType as (typeof SUPPORTED_AUDIO_TYPES)[number]
				)
			) {
				ctx.response.status = 400;
				ctx.response.body = {
					error: "Unsupported file type",
					supported_types: SUPPORTED_AUDIO_TYPES,
				};
				return;
			}

			// Convert file to buffer with error handling
			let fileBuffer: Uint8Array;
			try {
				fileBuffer = new Uint8Array(await fileField.arrayBuffer());
			} catch (error) {
				logger.error(
					"Failed to read file data",
					error instanceof Error ? error : new Error(String(error))
				);
				ctx.response.status = 400;
				ctx.response.body = { error: "Failed to read uploaded file data" };
				return;
			}

			// Get priority from form data
			const priorityField = formData.get("priority") as string;
			const priority =
				(priorityField as "high" | "normal" | "batch") || "normal";

			// Submit for analysis
			const result = await this.analysisService.submitAnalysis(
				fileBuffer,
				fileField.name || "audio_file",
				priority
			);

			ctx.response.status = 202; // Accepted
			ctx.response.body = result;
		} catch (error) {
			logger.error(
				"Enhanced analysis submission failed",
				error instanceof Error ? error : new Error(String(error))
			);
			ctx.response.status = 500;
			ctx.response.body = { error: "Internal server error" };
		}
	}

	/**
	 * Get analysis results by task ID
	 * GET /results/:taskId
	 */
	async getResults(
		ctx: Context & { params: { taskId: string } }
	): Promise<void> {
		try {
			const taskId = ctx.params.taskId;

			if (!taskId) {
				ctx.response.status = 400;
				ctx.response.body = { error: "Task ID is required" };
				return;
			}

			const result = await this.analysisService.getTaskStatus(taskId);

			ctx.response.status = 200;
			ctx.response.body = result;
		} catch (error) {
			logger.error(
				"Failed to get enhanced analysis results",
				error instanceof Error ? error : new Error(String(error))
			);
			ctx.response.status = 500;
			ctx.response.body = { error: "Internal server error" };
		}
	}

	/**
	 * Stream analysis results with real-time updates
	 * GET /stream/:taskId
	 */
	streamResults(ctx: Context & { params: { taskId: string } }): void {
		const taskId = ctx.params.taskId;

		if (!taskId) {
			ctx.response.status = 400;
			ctx.response.body = { error: "Task ID is required" };
			return;
		}

		logger.info("Starting enhanced SSE stream", { taskId });

		// Set SSE headers
		ctx.response.headers.set("Content-Type", "text/event-stream");
		ctx.response.headers.set("Cache-Control", "no-cache");
		ctx.response.headers.set("Connection", "keep-alive");
		ctx.response.headers.set("Access-Control-Allow-Origin", "*");
		ctx.response.headers.set("Access-Control-Allow-Headers", "Cache-Control");

		ctx.response.status = 200;

		// Create the SSE stream
		const analysisService = this.analysisService;
		const body = new ReadableStream({
			start(controller) {
				let closed = false;

				const closeController = () => {
					if (!closed) {
						try {
							controller.close();
							closed = true;
							logger.info("Enhanced SSE stream closed", { taskId });
						} catch {
							// Stream already closed or in invalid state
							logger.debug("Enhanced stream controller already closed", {
								taskId,
							});
						}
					}
				};

				(async () => {
					try {
						for await (const status of analysisService.streamTaskStatus(
							taskId
						)) {
							if (closed) break;

							try {
								const eventData = `data: ${JSON.stringify(status)}\n\n`;
								controller.enqueue(new TextEncoder().encode(eventData));
							} catch {
								// Stream was closed or controller is in invalid state
								logger.debug(
									"Failed to enqueue enhanced data, stream likely closed",
									{ taskId }
								);
								break;
							}

							// Exit conditions
							if (
								status.state === "SUCCESS" ||
								status.state === "FAILURE" ||
								status.state === "NOT_FOUND" ||
								status.state === "ERROR"
							) {
								break;
							}
						}
					} catch (error) {
						if (!closed) {
							logger.error(
								"Enhanced SSE stream error",
								error instanceof Error ? error : new Error(String(error)),
								{ taskId }
							);
							try {
								const errorEvent = `data: ${JSON.stringify({
									state: "ERROR",
									status: `Stream error: ${
										error instanceof Error ? error.message : String(error)
									}`,
								})}\n\n`;
								controller.enqueue(new TextEncoder().encode(errorEvent));
							} catch {
								// Stream is already closed or in invalid state
								logger.debug("Failed to enqueue enhanced error event", {
									taskId,
								});
							}
						}
					} finally {
						closeController();
					}
				})();
			},
			cancel() {
				logger.info("Enhanced SSE stream cancelled by client", { taskId });
			},
		});

		ctx.response.body = body;
	}

	/**
	 * Get system health including cache and queue status
	 * GET /health
	 */
	async getHealth(ctx: Context): Promise<void> {
		try {
			const health = await this.analysisService.healthCheck();

			const overallHealthy =
				health.python_engine.healthy &&
				health.queue_system.healthy &&
				health.cache_system.healthy;

			ctx.response.status = overallHealthy ? 200 : 503;
			ctx.response.body = {
				status: overallHealthy ? "Healthy" : "Degraded",
				components: health,
			};
		} catch (error) {
			logger.error(
				"Failed to get enhanced health status",
				error instanceof Error ? error : new Error(String(error))
			);
			ctx.response.status = 500;
			ctx.response.body = { error: "Internal server error" };
		}
	}
}
