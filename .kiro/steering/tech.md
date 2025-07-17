# Technology Stack & Build System

## Core Technologies

### Deno API Server
- **Runtime**: Deno 1.45+ with TypeScript
- **Framework**: Oak web framework
- **Validation**: Zod schemas for type safety
- **Database**: PGLite for local development, Redis for production
- **Task Management**: Custom queue system with priority support

### Python Analysis Engine
- **Runtime**: Python 3.9+
- **Audio Processing**: librosa for rhythm and melody analysis
- **Execution**: Standalone script called via IPC
- **Dependencies**: See `rhythm_engine/requirements.txt`

### Infrastructure
- **Containerization**: Docker with multi-service compose setup
- **Caching**: Multi-tier (in-memory, Redis, database)
- **Reverse Proxy**: Nginx (production profile)
- **Development**: Hot reload with file watching

## Build & Development Commands

### Quick Start (Recommended)
```bash
make setup          # Initial project setup
make dev            # Docker with in-memory backend
make dev-redis      # Docker with Redis backend
make dev-local      # Local development (no Docker)
```

### Testing
```bash
make test           # Run all tests
make test-deno      # Deno API tests only
make test-python    # Python engine tests only
make test-coverage  # Tests with coverage reports
```

### Docker Operations
```bash
make docker-build   # Build all images
make docker-test    # Test Docker setup
make prod           # Production deployment
make clean          # Cleanup containers/volumes
```

### Development Helpers
```bash
make format         # Format code (Deno + Python)
make lint          # Lint code
make health        # Check service health
make docs          # Start API documentation server
```

### Manual Commands

#### Deno API
```bash
cd api
deno cache deps.ts              # Cache dependencies
deno task dev                   # Development server
deno task start                 # Production server
deno task test                  # Run tests
deno task coverage              # Coverage reports
```

#### Python Engine
```bash
cd rhythm_engine
python -m venv venv             # Create virtual environment
source venv/bin/activate        # Activate (Linux/Mac)
pip install -r requirements.txt # Install dependencies
python run.py audio.mp3         # Analyze audio file
python test_run.py              # Run tests
```

## Configuration

### Environment Variables
- `PORT`: API server port (default: 8000)
- `LOG_LEVEL`: Logging level (INFO, DEBUG, WARN, ERROR)
- `REDIS_URL`: Redis connection string (optional)
- `PYTHON_EXECUTABLE`: Python binary path
- `MIN_NOTE_DURATION`: Minimum note duration filter (0.05s)
- `MAX_FILE_SIZE`: Upload limit (50MB)
- `UPLOAD_DIR`: Temporary file storage

### Backend Modes
- **In-Memory**: Fast development, no persistence
- **Redis**: Production-ready, scalable, persistent

## Code Quality Standards

- **TypeScript**: Strict mode enabled, comprehensive type checking
- **Python**: Black formatting, flake8 linting
- **Testing**: TDD approach with comprehensive coverage
- **Error Handling**: Structured logging with proper error categorization
- **Security**: Input validation, file sanitization, resource limits