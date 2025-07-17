import { Router } from "../deps.ts";

// Create router
export const analysisRouter = new Router();

// Define routes - V1 endpoints are deprecated
analysisRouter
	.post("/analyze", (ctx) => {
		ctx.response.status = 410;
		ctx.response.body = {
			error: "API endpoint deprecated",
			message:
				"The v1 /analyze endpoint has been deprecated. Please use /v2/analyze instead for enhanced features including intelligent caching, priority queue management, and improved performance.",
			deprecated_endpoint: "/analyze",
			recommended_endpoint: "/v2/analyze",
		};
	})
	.get("/results/:taskId", (ctx) => {
		ctx.response.status = 410;
		ctx.response.body = {
			error: "API endpoint deprecated",
			message:
				"The v1 /results endpoint has been deprecated. Please use /v2/results/:taskId instead for enhanced features including processing metrics and detailed error information.",
			deprecated_endpoint: "/results/:taskId",
			recommended_endpoint: "/v2/results/:taskId",
		};
	})
	.get("/stream/:taskId", (ctx) => {
		ctx.response.status = 410;
		ctx.response.body = {
			error: "API endpoint deprecated",
			message:
				"The v1 /stream endpoint has been deprecated. Please use /v2/stream/:taskId instead for enhanced features including queue position updates and detailed processing information.",
			deprecated_endpoint: "/stream/:taskId",
			recommended_endpoint: "/v2/stream/:taskId",
		};
	});
