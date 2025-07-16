#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net --allow-run --allow-write

/**
 * Test Runner for TypoSync Deno API
 * 
 * This script runs all tests and generates coverage reports.
 * It can be used for TDD development and CI/CD pipelines.
 */

import { assertEquals } from "../deps.ts";

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: TestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalDuration: number;
}

class TestRunner {
  private testFiles: string[] = [
    "api/tests/test_schemas.ts",
    "api/tests/test_task_manager.ts", 
    "api/tests/test_python_ipc.ts",
    "api/tests/test_analysis_service.ts",
    "api/tests/test_audio_hash_service.ts",
    "api/tests/test_cache_service.ts",
    "api/tests/test_database_service.ts",
    "api/tests/test_database_manager.ts",
    "api/tests/test_queue_service.ts",
    "api/tests/test_shutdown_manager.ts",
    "api/tests/integration_test.ts",
  ];

  private results: TestSuite[] = [];

  async runAllTests(): Promise<void> {
    console.log("🧪 Starting TypoSync API Test Suite\n");

    for (const testFile of this.testFiles) {
      await this.runTestFile(testFile);
    }

    this.printSummary();
  }

  private async runTestFile(testFile: string): Promise<void> {
    console.log(`📝 Running tests in ${testFile}...`);
    
    const startTime = Date.now();
    
    try {
      const command = new Deno.Command("deno", {
        args: [
          "test",
          "--allow-net",
          "--allow-read", 
          "--allow-write",
          "--allow-run",
          "--allow-env",
          "--reporter=tap",
          testFile
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const process = command.spawn();
      const { code, stdout, stderr } = await process.output();
      
      const duration = Date.now() - startTime;
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (code === 0) {
        console.log(`✅ ${testFile} - All tests passed (${duration}ms)`);
        
        // Parse JSON output to get detailed results
        try {
          const lines = output.split('\n').filter(line => line.trim());
          const results = lines.map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          }).filter(Boolean);

          this.processTestResults(testFile, results, duration);
        } catch (parseError) {
          console.warn(`⚠️  Could not parse detailed results for ${testFile}`);
          this.addSimpleResult(testFile, true, duration);
        }
      } else {
        console.log(`❌ ${testFile} - Tests failed (${duration}ms)`);
        console.log("Error output:", errorOutput);
        this.addSimpleResult(testFile, false, duration, errorOutput);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(`💥 ${testFile} - Could not run tests: ${errorMessage}`);
      this.addSimpleResult(testFile, false, 0, errorMessage);
    }
    
    console.log("");
  }

  private processTestResults(fileName: string, results: any[], duration: number): void {
    const testResults: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const result of results) {
      if (result.type === "test") {
        const testResult: TestResult = {
          name: result.name,
          success: result.result === "ok",
          duration: result.duration || 0,
        };

        if (result.result === "failed") {
          testResult.error = result.error || "Test failed";
          failed++;
        } else {
          passed++;
        }

        testResults.push(testResult);
      }
    }

    const suite: TestSuite = {
      name: fileName,
      tests: testResults,
      totalTests: testResults.length,
      passedTests: passed,
      failedTests: failed,
      totalDuration: duration,
    };

    this.results.push(suite);
  }

  private addSimpleResult(fileName: string, success: boolean, duration: number, error?: string): void {
    const suite: TestSuite = {
      name: fileName,
      tests: [{
        name: "Test execution",
        success,
        duration,
        error,
      }],
      totalTests: 1,
      passedTests: success ? 1 : 0,
      failedTests: success ? 0 : 1,
      totalDuration: duration,
    };

    this.results.push(suite);
  }

  private printSummary(): void {
    console.log("📊 Test Summary");
    console.log("=".repeat(50));

    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalDuration = 0;

    for (const suite of this.results) {
      totalTests += suite.totalTests;
      totalPassed += suite.passedTests;
      totalFailed += suite.failedTests;
      totalDuration += suite.totalDuration;

      const status = suite.failedTests === 0 ? "✅" : "❌";
      console.log(
        `${status} ${suite.name}: ${suite.passedTests}/${suite.totalTests} passed (${suite.totalDuration}ms)`
      );

      // Show failed tests
      for (const test of suite.tests) {
        if (!test.success) {
          console.log(`    ❌ ${test.name}: ${test.error}`);
        }
      }
    }

    console.log("=".repeat(50));
    console.log(`Total: ${totalPassed}/${totalTests} tests passed`);
    console.log(`Duration: ${totalDuration}ms`);
    
    if (totalFailed > 0) {
      console.log(`\n❌ ${totalFailed} test(s) failed`);
      Deno.exit(1);
    } else {
      console.log("\n🎉 All tests passed!");
    }
  }
}

// Coverage runner
async function runWithCoverage(): Promise<void> {
  console.log("📈 Running tests with coverage...\n");

  const command = new Deno.Command("deno", {
    args: [
      "test", 
      "--allow-net",
      "--allow-read",
      "--allow-write", 
      "--allow-run",
      "--allow-env",
      "--coverage=coverage",
      "api/tests/test_schemas.ts",
      "api/tests/test_task_manager.ts", 
      "api/tests/test_python_ipc.ts",
      "api/tests/test_analysis_service.ts",
      "api/tests/test_audio_hash_service.ts",
      "api/tests/test_cache_service.ts",
      "api/tests/test_database_service.ts",
      "api/tests/test_database_manager.ts",
      "api/tests/test_queue_service.ts",
      "api/tests/test_shutdown_manager.ts",
      "api/tests/integration_test.ts",
    ],
  });

  const process = command.spawn();
  const { code } = await process.output();

  if (code === 0) {
    console.log("\n📊 Generating coverage report...");
    
    const coverageCommand = new Deno.Command("deno", {
      args: ["coverage", "coverage", "--lcov", "--output=coverage.lcov"],
    });

    const coverageProcess = coverageCommand.spawn();
    await coverageProcess.output();
    
    console.log("✅ Coverage report generated: coverage.lcov");
  } else {
    console.log("❌ Tests failed, no coverage report generated");
    Deno.exit(1);
  }
}

// Main execution
if (import.meta.main) {
  const args = Deno.args;
  
  if (args.includes("--coverage")) {
    await runWithCoverage();
  } else {
    const runner = new TestRunner();
    await runner.runAllTests();
  }
}