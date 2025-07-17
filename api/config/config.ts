import { ConfigSchema, type Config } from "../types/schemas.ts";

class Configuration {
  private _config: Config;

  constructor() {
    this._config = this.loadConfig();
  }

  private loadConfig(): Config {
    const envConfig = {
      port: parseInt(Deno.env.get("PORT") || "8000"),
      log_level: (Deno.env.get("LOG_LEVEL") || "INFO") as "DEBUG" | "INFO" | "WARN" | "ERROR",
      redis_url: Deno.env.get("REDIS_URL"),
      min_note_duration: parseFloat(Deno.env.get("MIN_NOTE_DURATION") || "0.05"),
      python_executable: Deno.env.get("PYTHON_EXECUTABLE") || "../rhythm_engine/venv/bin/python3",
      rhythm_engine_path: Deno.env.get("RHYTHM_ENGINE_PATH") || "../rhythm_engine/run.py",
      upload_dir: Deno.env.get("UPLOAD_DIR") || "./uploads",
      max_file_size: parseInt(Deno.env.get("MAX_FILE_SIZE") || String(50 * 1024 * 1024))
    };

    return ConfigSchema.parse(envConfig);
  }

  get config(): Config {
    return this._config;
  }

  get redisEnabled(): boolean {
    return !!this._config.redis_url;
  }

  get backend(): "redis" | "in-memory" {
    return this.redisEnabled ? "redis" : "in-memory";
  }
}

export const config = new Configuration();
export { type Config };