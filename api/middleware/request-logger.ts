import { Context, type Middleware } from "../deps.ts";
import { logger } from "../utils/logger.ts";

export const requestLogger: Middleware = async (ctx: Context, next) => {
  const start = Date.now();
  const { method, url } = ctx.request;

  logger.info("Request started", {
    method,
    url: url.toString(),
    userAgent: ctx.request.headers.get("user-agent"),
  });

  await next();

  const duration = Date.now() - start;
  const { status } = ctx.response;

  logger.info("Request completed", {
    method,
    url: url.toString(),
    status,
    duration: `${duration}ms`,
  });
};