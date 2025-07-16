import { Application, oakCors } from "./deps.ts";
import { logger } from "./utils/logger.ts";
import { config } from "./config/config.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { requestLogger } from "./middleware/request-logger.ts";
import { queueRouter } from "./routes/queue.ts";
import { cacheRouter } from "./routes/cache.ts";
import { analysisRouter, enhancedAnalysisService } from "./routes/analysis.ts";
import { DocsHandler } from "./docs/docs-handler.ts";
import { shutdownManager } from "./services/shutdown-manager.ts";

function createApp(): Application {
	const app = new Application();
	const docsHandler = new DocsHandler();

	// Configure Oak application with proper limits and error handling
	app.addEventListener("error", (evt) => {
		const error = evt.error;

		// Handle stream controller errors specifically
		if (error instanceof Error && error.message.includes("stream controller")) {
			logger.warn("Stream controller error caught at application level", error);
			return; // Don't crash on stream errors
		}

		logger.error("Application error", error);
	});

	// Global middleware
	app.use(errorHandler);
	app.use(requestLogger);

	// CORS middleware - must be before other routes
	app.use(
		oakCors({
			origin: true,
			methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowedHeaders: [
				"Content-Type",
				"Authorization",
				"Cache-Control",
				"X-Requested-With",
			],
			credentials: false,
			optionsSuccessStatus: 200,
		})
	);

	// Add body parser configuration middleware
	app.use(async (ctx, next) => {
		// Ensure proper handling of multipart/form-data
		if (
			ctx.request.hasBody &&
			ctx.request.headers.get("content-type")?.includes("multipart/form-data")
		) {
			// Set a reasonable timeout for large file uploads
			const originalTimeout = ctx.request.url.searchParams.get("timeout");
			if (!originalTimeout) {
				// Add custom timeout handling if needed
			}
		}
		await next();
	});

	// Health check endpoint
	app.use(async (ctx, next) => {
		if (ctx.request.url.pathname === "/" && ctx.request.method === "GET") {
			const health = await enhancedAnalysisService.healthCheck();
			ctx.response.body = {
				status: health.python_engine.healthy
					? "Rhythm Analysis Engine is running"
					: "Service unavailable",
				backend: config.backend,
				python_check: health.python_engine,
			};
			ctx.response.status = health.python_engine.healthy ? 200 : 503;
			return;
		}
		await next();
	});

	// API documentation routes
	app.use(async (ctx, next) => {
		const path = ctx.request.url.pathname;

		if (path === "/docs" || path === "/docs/") {
			await docsHandler.serveDocs(ctx);
			return;
		}

		if (path === "/docs/openapi.yaml") {
			await docsHandler.serveOpenApiSpec(ctx);
			return;
		}

		await next();
	});

	// API routes
	app.use(analysisRouter.routes());
	app.use(analysisRouter.allowedMethods());

	app.use(queueRouter.routes());
	app.use(queueRouter.allowedMethods());

	app.use(cacheRouter.routes());
	app.use(cacheRouter.allowedMethods());

	return app;
}

async function startServer() {
	try {
		// Setup graceful shutdown handlers
		shutdownManager.setupSignalHandlers();

		// Register application-specific shutdown handlers
		shutdownManager.registerShutdownHandler(() => {
			logger.info("Closing application connections...");
			// Add any application-specific cleanup here
			// For example, close active HTTP connections, stop background tasks, etc.
			return Promise.resolve();
		});

		const app = createApp();
		const port = config.config.port;

		logger.info("Starting TypoSync API server", {
			port,
			backend: config.backend,
			logLevel: config.config.log_level,
		});

		app.addEventListener("listen", () => {
			logger.info(`Server running on http://localhost:${port}`);
			logger.info(
				`API Documentation available at http://localhost:${port}/docs`
			);
			logger.info(
				`OpenAPI spec available at http://localhost:${port}/docs/openapi.yaml`
			);
		});

		await app.listen({ port });
	} catch (error) {
		logger.error(
			"Failed to start server",
			error instanceof Error ? error : new Error(String(error))
		);
		Deno.exit(1);
	}
}

// Handle uncaught exceptions, especially stream controller errors
globalThis.addEventListener("error", (event) => {
	const error = event.error;

	if (error instanceof Error && error.message.includes("stream controller")) {
		logger.warn("Uncaught stream controller error", error);
		event.preventDefault(); // Prevent crash
		return;
	}

	logger.error(
		"Uncaught error",
		error instanceof Error ? error : new Error(String(error))
	);
});

// Note: unhandledrejection is now handled by the shutdown manager

// Start the server
if (import.meta.main) {
	await startServer();
}
