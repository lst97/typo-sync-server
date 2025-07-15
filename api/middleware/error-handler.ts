import { Context, Status, type Middleware } from "../deps.ts";
import { logger } from "../utils/logger.ts";

export interface AppError extends Error {
  status?: number;
  expose?: boolean;
}

export class ValidationError extends Error implements AppError {
  status = Status.BadRequest;
  expose = true;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error implements AppError {
  status = Status.NotFound;
  expose = true;

  constructor(message: string = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class FileUploadError extends Error implements AppError {
  status = Status.BadRequest;
  expose = true;

  constructor(message: string) {
    super(message);
    this.name = "FileUploadError";
  }
}

export class InternalServerError extends Error implements AppError {
  status = Status.InternalServerError;
  expose = false;

  constructor(message: string = "Internal server error") {
    super(message);
    this.name = "InternalServerError";
  }
}

export const errorHandler: Middleware = async (ctx: Context, next) => {
  try {
    await next();
  } catch (error) {
    const appError = error as AppError;
    
    // Determine status code
    const status = appError.status || Status.InternalServerError;
    const expose = appError.expose !== false;

    // Log the error
    if (status >= 500) {
      logger.error("Unhandled server error", error instanceof Error ? error : new Error(String(error)), {
        url: ctx.request.url.toString(),
        method: ctx.request.method,
        userAgent: ctx.request.headers.get("user-agent"),
      });
    } else {
      logger.warn("Client error", error instanceof Error ? error : undefined, {
        status,
        message: error instanceof Error ? error.message : String(error),
        url: ctx.request.url.toString(),
        method: ctx.request.method,
      });
    }

    // Set response
    ctx.response.status = status;
    ctx.response.headers.set("Content-Type", "application/json");

    if (expose) {
      ctx.response.body = {
        detail: error instanceof Error ? error.message : String(error),
      };
    } else {
      ctx.response.body = {
        detail: "An unexpected error occurred. Please try again later.",
      };
    }
  }
};

// Helper function to create standard errors
export function createError(status: number, message: string): AppError {
  const error = new Error(message) as AppError;
  error.status = status;
  error.expose = status < 500;
  return error;
}