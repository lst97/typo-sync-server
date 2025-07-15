import { config } from "../config/config.ts";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

class Logger {
  private level: LogLevel;
  private readonly levels: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  };

  constructor(level: LogLevel = "INFO") {
    this.level = level;
  }

  private shouldLog(messageLevel: LogLevel): boolean {
    return this.levels[messageLevel] >= this.levels[this.level];
  }

  private formatMessage(level: LogLevel, message: string, extra?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString();
    const baseMessage = `[${timestamp}] [${level}] - ${message}`;
    
    if (extra) {
      return `${baseMessage} ${JSON.stringify(extra)}`;
    }
    
    return baseMessage;
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    if (this.shouldLog("DEBUG")) {
      console.log(this.formatMessage("DEBUG", message, extra));
    }
  }

  info(message: string, extra?: Record<string, unknown>): void {
    if (this.shouldLog("INFO")) {
      console.log(this.formatMessage("INFO", message, extra));
    }
  }

  warn(message: string, error?: Error, extra?: Record<string, unknown>): void {
    if (this.shouldLog("WARN")) {
      const errorDetails = error ? { 
        name: error.name, 
        message: error.message, 
        stack: error.stack 
      } : undefined;
      
      const combinedExtra = { ...extra, ...(errorDetails && { error: errorDetails }) };
      console.warn(this.formatMessage("WARN", message, combinedExtra));
    }
  }

  error(message: string, error?: Error, extra?: Record<string, unknown>): void {
    if (this.shouldLog("ERROR")) {
      const errorDetails = error ? { 
        name: error.name, 
        message: error.message, 
        stack: error.stack 
      } : undefined;
      
      const combinedExtra = { ...extra, ...(errorDetails && { error: errorDetails }) };
      console.error(this.formatMessage("ERROR", message, combinedExtra));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger(config.config.log_level);