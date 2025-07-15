# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypoSync is a modern audio analysis service featuring a hybrid architecture:
- **Deno TypeScript API** (in `api/`) - High-performance HTTP server with Oak framework
- **Python Analysis Engine** (in `rhythm_engine/`) - Standalone executable for audio processing via IPC
- **Dual Backend Support** - Redis for production, in-memory for development
- **Comprehensive Testing** - TDD approach with coverage for both Deno and Python components

The system specializes in rhythm and melody extraction from audio files, using advanced beat-quantized analysis to extract musical notes synchronized to beat grids.

## Development Commands

### Quick Start
```bash
# Development setup
make setup
make dev

# With Redis (for testing production mode)
make dev-redis

# Production deployment
make prod
```

### Deno API Development
```bash
cd api
deno task dev          # Start with hot reload
deno task test         # Run tests
deno task coverage     # Generate coverage report
```

### Python Engine Development
```bash
cd rhythm_engine
python run.py --help   # Test standalone script
python test_run.py     # Run engine tests
```

### Docker Development
```bash
make docker-build      # Build images
make docker-test       # Test Docker setup
make clean            # Clean up containers/volumes
```

### Testing
```bash
make test             # Run all tests
make test-coverage    # Generate coverage reports
./api/tests/test_runner.ts --coverage  # Deno tests with coverage
```

## Architecture Overview

### Core Components

**Deno API Server (`api/main.ts`)**
- Oak framework with TypeScript
- CORS middleware and comprehensive error handling
- Structured logging and request tracking
- OpenAPI/ReDoc documentation at `/docs`

**API Routes & Controllers (`api/routes/`, `api/controllers/`)**
- `POST /analyze` - Submit audio files for processing
- `GET /stream/{task_id}` - SSE endpoint for real-time progress updates  
- `GET /results/{task_id}` - Retrieve analysis results
- `GET /` - Health check with Python engine validation

**Python IPC Service (`api/services/python-ipc.ts`)**
- Executes standalone Python script via `Deno.Command`
- Handles stdout/stderr parsing and error recovery
- Health check validation of Python environment

**Task Management (`api/services/task-manager.ts`)**
- **Redis Mode**: Production-ready with persistence and TTL
- **In-Memory Mode**: Development fallback with local storage
- Auto-switching based on `REDIS_URL` environment variable

**Python Analysis Engine (`rhythm_engine/run.py`)**
- Standalone executable with command-line interface
- JSON input/output for seamless IPC communication
- Three-phase beat-quantized melody extraction:
  1. Foundational analysis (beat tracking + pitch extraction)
  2. Beat-subdivision pitch analysis (8th note subdivisions)  
  3. Consolidation & humanization filtering

### Configuration (`api/config/config.ts`, `rhythm_engine/app/config.py`)
- Type-safe configuration with Zod/Pydantic validation
- Environment variable support with `.env` files
- Key settings:
  - `redis_url`: Enables/disables Redis backend
  - `min_note_duration`: Minimum duration for playable notes (default: 0.05s)
  - `python_executable`: Path to Python interpreter
  - `max_file_size`: Upload size limit

### Data Models (`api/types/schemas.ts`)
- Comprehensive Zod schemas for runtime validation
- TypeScript types derived from schemas
- OpenAPI specification generated from schemas

## Key Technical Details

### Audio Processing Pipeline
1. **Beat Tracking**: Uses librosa.beat.beat_track() to establish rhythm grid
2. **Pitch Detection**: Uses librosa.pyin() for fundamental frequency extraction
3. **Subdivision Analysis**: Creates 8th note subdivisions within beat boundaries
4. **Note Consolidation**: Merges consecutive identical notes
5. **Duration Filtering**: Removes notes shorter than minimum threshold

### Hybrid Architecture
The application features a modern hybrid design:
- **Deno Frontend**: High-performance TypeScript API server
- **Python Backend**: Specialized audio processing via IPC
- **Task Management**: Redis for production, in-memory for development
- **Real-time Updates**: Server-Sent Events for progress streaming

### API Response Format
All analysis results include:
- `bpm`: Detected tempo
- `beat_timestamps`: Array of beat timing markers
- `melody_map`: Array of note objects with pitch, start_time, and duration
- `analysis_info`: Metadata about the analysis process

## File Upload Support
- Supported formats: MP3, WAV (checked via MIME type)
- Files temporarily stored during processing
- Automatic cleanup after analysis completion

## Real-time Progress Tracking
- Server-Sent Events (SSE) for live progress updates
- WebSocket-style streaming without WebSocket complexity
- Automatic connection cleanup on task completion

## Docker Configuration
- **Multi-service setup**: api, rhythm_engine, redis, nginx (optional)
- **Development mode**: Hot reload with volume mounting
- **Production mode**: Optimized with health checks and restart policies
- **Environment-based configuration**: `.env` files with overrides
- **Make commands**: Simplified workflow with comprehensive Makefile

## Testing Strategy
- **TDD Approach**: Write tests first, implement features to pass
- **Comprehensive Coverage**: Both Deno and Python components tested
- **Integration Tests**: Full workflow testing with Docker
- **GitHub Actions**: Automated CI/CD with coverage reporting
- **Health Checks**: Container and service health monitoring

## IPC Communication
- **Python Executable**: Standalone script with JSON I/O
- **Error Handling**: Structured error responses via stderr
- **File Management**: Secure temporary file handling
- **Process Management**: Timeout handling and cleanup