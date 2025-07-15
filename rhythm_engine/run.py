#!/usr/bin/env python3
"""
TypoSync Rhythm Engine - Standalone Executable

This script provides a command-line interface for the rhythm analysis engine,
designed to be called from external processes via IPC.

Usage:
    python run.py <audio_file_path>

Output:
    JSON object containing analysis results sent to stdout
    Error messages sent to stderr
    Exit codes: 0 = success, 1 = error
"""

import sys
import os
import json
import argparse
import logging
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

try:
    from analysis_utils import perform_analysis
    from config import settings
except ImportError as e:
    print(f"Error importing required modules: {e}", file=sys.stderr)
    sys.exit(1)


def setup_logging(log_level: str = "INFO") -> None:
    """Configure logging for the standalone script."""
    # Only log to stderr to keep stdout clean for JSON output
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format='[%(asctime)s] [%(levelname)s] %(name)s - %(message)s',
        stream=sys.stderr
    )


def validate_audio_file(file_path: str) -> Path:
    """
    Validate that the audio file exists and has a supported extension.
    
    Args:
        file_path: Path to the audio file
        
    Returns:
        Path object of the validated file
        
    Raises:
        FileNotFoundError: If file doesn't exist
        ValueError: If file extension is not supported
    """
    path = Path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")
    
    if not path.is_file():
        raise ValueError(f"Path is not a file: {file_path}")
    
    # Check file extension
    supported_extensions = {'.mp3', '.wav', '.m4a', '.flac', '.ogg'}
    if path.suffix.lower() not in supported_extensions:
        raise ValueError(
            f"Unsupported file extension: {path.suffix}. "
            f"Supported: {', '.join(supported_extensions)}"
        )
    
    return path


def create_error_response(error_message: str, error_type: str = "AnalysisError") -> dict:
    """Create a standardized error response."""
    return {
        "error": True,
        "error_type": error_type,
        "message": error_message,
    }


def create_success_response(analysis_result: dict) -> dict:
    """Create a standardized success response."""
    return {
        "error": False,
        "data": analysis_result,
    }


def main() -> int:
    """
    Main entry point for the standalone rhythm engine.
    
    Returns:
        Exit code: 0 for success, 1 for error
    """
    parser = argparse.ArgumentParser(
        description="TypoSync Rhythm Engine - Standalone Audio Analysis",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python run.py audio.mp3
    python run.py /path/to/song.wav
    
Environment Variables:
    MIN_NOTE_DURATION: Minimum note duration in seconds (default: 0.05)
    LOG_LEVEL: Logging level (DEBUG, INFO, WARN, ERROR)
        """
    )
    
    parser.add_argument(
        "audio_file",
        help="Path to the audio file to analyze"
    )
    
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARN", "ERROR"],
        default=os.getenv("LOG_LEVEL", "INFO"),
        help="Set the logging level (default: INFO)"
    )
    
    parser.add_argument(
        "--version",
        action="version",
        version="TypoSync Rhythm Engine v2.0.0"
    )
    
    # Parse arguments
    try:
        args = parser.parse_args()
    except SystemExit:
        # argparse called sys.exit(), but we want to return an exit code
        return 1
    
    # Setup logging
    setup_logging(args.log_level)
    logger = logging.getLogger(__name__)
    
    try:
        # Validate input file
        logger.info(f"Starting analysis for: {args.audio_file}")
        audio_path = validate_audio_file(args.audio_file)
        
        # Log configuration
        logger.debug(f"Min note duration: {settings.min_note_duration}")
        logger.debug(f"Log level: {args.log_level}")
        
        # Perform the analysis
        logger.info("Beginning audio analysis...")
        result = perform_analysis(str(audio_path))
        
        # Create success response
        response = create_success_response(result)
        
        # Output JSON to stdout
        print(json.dumps(response, indent=None, separators=(',', ':')))
        
        logger.info("Analysis completed successfully")
        return 0
        
    except FileNotFoundError as e:
        logger.error(f"File not found: {e}")
        error_response = create_error_response(str(e), "FileNotFoundError")
        print(json.dumps(error_response), file=sys.stderr)
        return 1
        
    except ValueError as e:
        logger.error(f"Invalid input: {e}")
        error_response = create_error_response(str(e), "ValidationError")
        print(json.dumps(error_response), file=sys.stderr)
        return 1
        
    except ImportError as e:
        logger.error(f"Missing dependencies: {e}")
        error_response = create_error_response(
            f"Required audio analysis libraries not available: {e}",
            "DependencyError"
        )
        print(json.dumps(error_response), file=sys.stderr)
        return 1
        
    except Exception as e:
        logger.exception("Unexpected error during analysis")
        error_response = create_error_response(
            f"Analysis failed: {str(e)}",
            "AnalysisError"
        )
        print(json.dumps(error_response), file=sys.stderr)
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)