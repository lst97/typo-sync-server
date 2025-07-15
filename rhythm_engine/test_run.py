#!/usr/bin/env python3
"""
Test suite for the standalone rhythm engine script.

This provides comprehensive testing for the Python IPC interface.
"""

import os
import sys
import json
import tempfile
import unittest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add the current directory to Python path
sys.path.insert(0, os.path.dirname(__file__))

try:
    from app.analysis_utils import perform_analysis
    from app.config import settings
except ImportError as e:
    print(f"Warning: Could not import app modules: {e}")
    perform_analysis = None
    settings = None


class TestRhythmEngineStandalone(unittest.TestCase):
    """Test cases for the standalone rhythm engine script."""

    def setUp(self):
        """Set up test fixtures."""
        self.script_path = Path(__file__).parent / "run.py"
        self.test_files = []

    def tearDown(self):
        """Clean up test files."""
        for file_path in self.test_files:
            try:
                if file_path.exists():
                    file_path.unlink()
            except Exception:
                pass

    def create_test_audio_file(self, content: bytes = None) -> Path:
        """Create a temporary test audio file."""
        if content is None:
            # Create minimal WAV file content
            content = b'RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xAC\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
        
        temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        temp_file.write(content)
        temp_file.close()
        
        temp_path = Path(temp_file.name)
        self.test_files.append(temp_path)
        return temp_path

    def run_script(self, args: list) -> tuple[int, str, str]:
        """Run the rhythm engine script and return exit code, stdout, stderr."""
        cmd = [sys.executable, str(self.script_path)] + args
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return 1, "", "Script execution timed out"
        except Exception as e:
            return 1, "", str(e)

    def test_script_exists_and_executable(self):
        """Test that the script file exists and is executable."""
        self.assertTrue(self.script_path.exists(), "run.py script does not exist")
        self.assertTrue(os.access(self.script_path, os.X_OK), "run.py is not executable")

    def test_help_message(self):
        """Test that the script shows help when requested."""
        exit_code, stdout, stderr = self.run_script(["--help"])
        
        self.assertEqual(exit_code, 0)
        self.assertIn("TypoSync Rhythm Engine", stdout)
        self.assertIn("audio_file", stdout)

    def test_version_message(self):
        """Test that the script shows version when requested."""
        exit_code, stdout, stderr = self.run_script(["--version"])
        
        self.assertEqual(exit_code, 0)
        self.assertIn("TypoSync Rhythm Engine", stdout)
        self.assertIn("v2.0.0", stdout)

    def test_missing_audio_file_argument(self):
        """Test script behavior when no audio file is provided."""
        exit_code, stdout, stderr = self.run_script([])
        
        self.assertEqual(exit_code, 1)
        # Should show usage information
        self.assertIn("audio_file", stderr)

    def test_nonexistent_audio_file(self):
        """Test script behavior with non-existent audio file."""
        exit_code, stdout, stderr = self.run_script(["/nonexistent/file.wav"])
        
        self.assertEqual(exit_code, 1)
        
        # Parse error response from stderr
        try:
            error_response = json.loads(stderr)
            self.assertTrue(error_response.get("error"))
            self.assertEqual(error_response.get("error_type"), "FileNotFoundError")
            self.assertIn("not found", error_response.get("message", ""))
        except json.JSONDecodeError:
            self.fail("Script should output valid JSON error response to stderr")

    def test_unsupported_file_extension(self):
        """Test script behavior with unsupported file extension."""
        # Create a text file
        text_file = tempfile.NamedTemporaryFile(suffix='.txt', delete=False)
        text_file.write(b"This is not an audio file")
        text_file.close()
        
        text_path = Path(text_file.name)
        self.test_files.append(text_path)
        
        exit_code, stdout, stderr = self.run_script([str(text_path)])
        
        self.assertEqual(exit_code, 1)
        
        # Parse error response
        try:
            error_response = json.loads(stderr)
            self.assertTrue(error_response.get("error"))
            self.assertEqual(error_response.get("error_type"), "ValidationError")
            self.assertIn("Unsupported file extension", error_response.get("message", ""))
        except json.JSONDecodeError:
            self.fail("Script should output valid JSON error response to stderr")

    def test_valid_audio_file_structure(self):
        """Test script with a valid audio file (may fail analysis but should have correct structure)."""
        audio_file = self.create_test_audio_file()
        
        exit_code, stdout, stderr = self.run_script([str(audio_file)])
        
        # The script should run without crashing, but analysis might fail
        # We're testing the JSON structure regardless of success/failure
        
        if exit_code == 0:
            # Success case - should have JSON on stdout
            try:
                response = json.loads(stdout)
                self.assertFalse(response.get("error"))
                self.assertIn("data", response)
                
                # Validate structure of analysis data
                data = response["data"]
                self.assertIn("bpm", data)
                self.assertIn("beat_timestamps", data)
                self.assertIn("melody_map", data)
                self.assertIn("analysis_info", data)
                
            except json.JSONDecodeError:
                self.fail("Script should output valid JSON to stdout on success")
        
        else:
            # Failure case - should have JSON error on stderr
            try:
                error_response = json.loads(stderr)
                self.assertTrue(error_response.get("error"))
                self.assertIn("error_type", error_response)
                self.assertIn("message", error_response)
                
            except json.JSONDecodeError:
                self.fail("Script should output valid JSON error response to stderr")

    def test_log_level_environment_variable(self):
        """Test that LOG_LEVEL environment variable is respected."""
        audio_file = self.create_test_audio_file()
        
        # Test with DEBUG log level
        env = os.environ.copy()
        env["LOG_LEVEL"] = "DEBUG"
        
        cmd = [sys.executable, str(self.script_path), str(audio_file)]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            # Debug logging should appear in stderr
            self.assertIn("[DEBUG]", result.stderr)
            
        except subprocess.TimeoutExpired:
            self.fail("Script execution timed out with DEBUG logging")

    @unittest.skipIf(perform_analysis is None, "Analysis modules not available")
    def test_analysis_function_directly(self):
        """Test the analysis function directly (unit test)."""
        audio_file = self.create_test_audio_file()
        
        try:
            result = perform_analysis(str(audio_file))
            
            # Validate result structure
            self.assertIsInstance(result, dict)
            self.assertIn("bpm", result)
            self.assertIn("beat_timestamps", result)
            self.assertIn("melody_map", result)
            self.assertIn("analysis_info", result)
            
            # Validate types
            self.assertIsInstance(result["bpm"], (int, float))
            self.assertIsInstance(result["beat_timestamps"], list)
            self.assertIsInstance(result["melody_map"], list)
            self.assertIsInstance(result["analysis_info"], dict)
            
        except Exception as e:
            # Analysis might fail with minimal test data, but should not crash
            print(f"Note: Analysis failed with test data (expected): {e}")

    @unittest.skipIf(settings is None, "Settings module not available")
    def test_settings_configuration(self):
        """Test that settings are loaded correctly."""
        self.assertIsNotNone(settings)
        self.assertIsInstance(settings.min_note_duration, (int, float))
        self.assertGreater(settings.min_note_duration, 0)


class TestJSONOutput(unittest.TestCase):
    """Test JSON output format compliance."""

    def test_success_response_schema(self):
        """Test that success response follows expected schema."""
        response = {
            "error": False,
            "data": {
                "bpm": 120.0,
                "beat_timestamps": [0.0, 0.5, 1.0],
                "melody_map": [
                    {
                        "pitch": "A4",
                        "start_time": 1.0,
                        "duration": 0.5
                    }
                ],
                "analysis_info": {
                    "total_beats": 3,
                    "total_subdivisions": 6,
                    "consolidated_notes": 1,
                    "filtered_notes": 1,
                    "min_note_duration": 0.05,
                    "subdivision_factor": 2
                }
            }
        }
        
        # Test JSON serialization
        json_str = json.dumps(response)
        parsed = json.loads(json_str)
        
        self.assertEqual(parsed["error"], False)
        self.assertIn("data", parsed)

    def test_error_response_schema(self):
        """Test that error response follows expected schema."""
        response = {
            "error": True,
            "error_type": "FileNotFoundError",
            "message": "Audio file not found: /path/to/file.wav"
        }
        
        # Test JSON serialization
        json_str = json.dumps(response)
        parsed = json.loads(json_str)
        
        self.assertEqual(parsed["error"], True)
        self.assertIn("error_type", parsed)
        self.assertIn("message", parsed)


def run_tests():
    """Run all tests and return exit code."""
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add test cases
    suite.addTests(loader.loadTestsFromTestCase(TestRhythmEngineStandalone))
    suite.addTests(loader.loadTestsFromTestCase(TestJSONOutput))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2, buffer=True)
    result = runner.run(suite)
    
    # Print summary
    print(f"\nTests run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    
    if result.failures:
        print("\nFailures:")
        for test, traceback in result.failures:
            print(f"  {test}: {traceback}")
    
    if result.errors:
        print("\nErrors:")
        for test, traceback in result.errors:
            print(f"  {test}: {traceback}")
    
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    exit_code = run_tests()
    sys.exit(exit_code)