import { join } from "../deps.ts";
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

  constructor() {
    this.pythonExecutable = config.config.python_executable;
    this.scriptPath = config.config.rhythm_engine_path;
  }

  async analyzeAudio(filePath: string): Promise<IPCResult> {
    logger.info("Starting Python IPC analysis", { filePath });

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

      const process = command.spawn();
      const { code, stdout, stderr } = await process.output();

      // Log the process completion
      logger.debug("Python process completed", { exitCode: code });

      // Handle non-zero exit codes
      if (code !== 0) {
        const errorMessage = new TextDecoder().decode(stderr);
        logger.error("Python script failed", undefined, {
          exitCode: code,
          stderr: errorMessage,
        });
        return {
          success: false,
          error: `Analysis failed: ${errorMessage || `Process exited with code ${code}`}`,
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
        const result = JSON.parse(outputText) as AnalysisResult;
        logger.info("Successfully parsed analysis result", {
          bpm: result.bpm,
          totalBeats: result.analysis_info?.total_beats,
          notesCount: result.melody_map?.length,
        });

        return {
          success: true,
          data: result,
        };
      } catch (parseError) {
        logger.error("Failed to parse Python output as JSON", parseError instanceof Error ? parseError : new Error(String(parseError)), {
          output: outputText.substring(0, 500), // Log first 500 chars for debugging
        });
        return {
          success: false,
          error: `Invalid JSON output from analysis script: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        };
      }
    } catch (error) {
      logger.error("IPC communication failed", error instanceof Error ? error : new Error(String(error)));
      return {
        success: false,
        error: `IPC communication error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async validatePythonScript(): Promise<void> {
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

      const testProcess = testCommand.spawn();
      const { code } = await testProcess.output();

      if (code !== 0) {
        throw new Error(`Python executable not working: ${this.pythonExecutable}`);
      }

      logger.debug("Python script validation successful", {
        executable: this.pythonExecutable,
        script: this.scriptPath,
      });
    } catch (error) {
      logger.error("Python script validation failed", error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Python script validation failed: ${error instanceof Error ? error.message : String(error)}`);
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
}