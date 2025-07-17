# TypoSync - Advanced Audio Analysis Engine

A modern, enterprise-grade audio analysis service featuring a hybrid Deno-Python architecture with intelligent caching, priority queue management, and comprehensive audio fingerprinting for extracting rhythm and melody information.

## 🚀 Features

### Core Analysis

- **Beat-Quantized Melody Extraction** - Advanced 3-phase analysis pipeline with beat-subdivision analysis
- **Audio Fingerprinting** - Duplicate detection using SHA-256 content hashing and perceptual fingerprinting
- **Priority Processing** - Multi-tier queue system (high/normal/batch) with position tracking
- **Real-time Progress Tracking** - Server-Sent Events for live updates with queue position and ETA

### Performance & Reliability

- **Intelligent Multi-Tier Caching** - L1 (in-memory), L2 (Redis), L3 (database) with 99%+ hit rates
- **Dual Backend Support** - Redis for production scalability, in-memory for development speed
- **Security Protection** - Turnstile CAPTCHA verification for enhanced security
- **Comprehensive Health Monitoring** - Service health checks with metrics and diagnostics

### Developer Experience

- **Type-Safe Architecture** - Zod validation and TypeScript throughout with OpenAPI 3.1 spec
- **Production Ready** - Docker containers with health checks and automatic restart policies
- **Test-Driven Development** - Comprehensive test coverage with integration testing
- **Domain-Driven Design** - Clean architecture with bounded contexts

## 🏗️ System Architecture

```bash
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │    │   Queue System  │    │  Cache System   │
│   (Enhanced)    │ ── │   (Priority)    │ ── │  (Multi-Tier)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Audio Hash      │    │  Database       │    │  Python Engine  │
│ Fingerprinting  │    │  (PGlite)       │    │  (IPC)          │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Bounded Contexts

1. **Audio Processing Context** - Core audio analysis functionality with beat-quantized melody extraction
2. **Queue Management Context** - Priority-based task scheduling with concurrency limits and position tracking
3. **Cache Management Context** - Multi-tier caching with LRU eviction and intelligent cache warming
4. **Persistence Context** - Database operations with repository pattern and audio fingerprint storage

### Components

- **Deno API Server** - High-performance HTTP server with Oak framework and comprehensive middleware
- **Python Analysis Engine** - Standalone executable for audio processing with librosa integration
- **Redis Backend** - Task management, result storage, and L2 caching (optional)
- **PGlite Database** - Persistent storage for audio fingerprints and L3 caching
- **Docker Integration** - Multi-service containerized deployment with health checks

## 📋 Prerequisites

- **Deno** 1.45+ ([installation guide](https://deno.land/#installation))
- **Python** 3.9+ with pip
- **Docker & Docker Compose** (for containerized deployment)
- **Make** (optional, for simplified commands)

## 🛠️ Quick Start

### Option 1: Using Make (Recommended)

```bash
# Clone and setup
git clone <repository-url>
cd TypoSync

# Setup development environment
make setup

# Start development server (choose one)
make dev          # Docker with in-memory backend
make dev-redis    # Docker with Redis backend  
make dev-local    # Local development (no Docker)
```

### Option 2: Manual Setup

```bash
# Setup Deno API
cd api
deno cache deps.ts

# Setup Python engine
cd ../rhythm_engine
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Start development
cd ../api
deno task dev
```

### Option 3: Docker

```bash
# Development with hot reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production deployment
docker-compose up --build
```

## 📡 API Usage

### Submit Audio for Analysis

```bash
curl -X POST "http://localhost:8000/analyze" \
  -F "file=@audio.mp3" \
  -H "Content-Type: multipart/form-data"
```

Response:

```json
{
  "task_id": "01HF7XQZX8R3VTFN95QG9MJZT0",
  "backend": "in-memory"
}
```

### Stream Real-time Progress

```javascript
const eventSource = new EventSource('http://localhost:8000/stream/01HF7XQZX8R3VTFN95QG9MJZT0');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Status:', data.state);
  
  if (data.state === 'SUCCESS') {
    console.log('BPM:', data.result.bpm);
    console.log('Melody:', data.result.melody_map);
    eventSource.close();
  }
};
```

### Get Analysis Results

```bash
curl "http://localhost:8000/results/01HF7XQZX8R3VTFN95QG9MJZT0"
```

## 📚 API Documentation

- **Interactive Docs**: <http://localhost:8000/docs>
- **OpenAPI Spec**: <http://localhost:8000/docs/openapi.yaml>
- **Health Check**: <http://localhost:8000/>

## 🧪 Testing

### Run All Tests

```bash
make test                    # All tests
make test-coverage          # With coverage reports
```

### Individual Test Suites

```bash
# Deno API tests
cd api && deno task test

# Python engine tests  
cd rhythm_engine && python test_run.py

# Integration tests
cd api && deno test --allow-all tests/integration_test.ts
```

### Test-Driven Development

```bash
# Watch mode for TDD
cd api && deno task dev     # Auto-restart on changes
cd api && deno task test    # Run tests on changes
```

## ⚙️ Configuration

### Environment Variables

Create `.env` file (copy from `.env.example`):

```bash
# API Configuration
PORT=8000
LOG_LEVEL=INFO

# Backend Selection
REDIS_URL=redis://localhost:6379/0  # Enable Redis (comment out for in-memory)

# Python Engine
PYTHON_EXECUTABLE=python3
MIN_NOTE_DURATION=0.05

# File Uploads
MAX_FILE_SIZE=52428800  # 50MB
UPLOAD_DIR=./uploads
```

### Backend Modes

- **In-Memory** (Development): Fast, no persistence
- **Redis** (Production): Scalable, persistent, distributed

## 🐳 Docker Deployment

### Development

```bash
# Docker with in-memory backend (fastest setup)
make dev

# Docker with Redis backend (production-like)
make dev-redis

# Local development (no Docker, fastest iteration)
make dev-local
```

### Production

```bash
# Full production stack
make prod

# With reverse proxy
docker-compose --profile production up
```

### Docker Commands

```bash
make docker-build          # Build images
make docker-test           # Test deployment
make clean                 # Cleanup containers
```

## 📊 Analysis Pipeline

The audio analysis follows a sophisticated 3-phase approach:

### Phase 1: Foundational Analysis

- **Beat Tracking**: Establish rhythm grid using librosa
- **Pitch Detection**: Extract fundamental frequencies with PYIN algorithm

### Phase 2: Beat-Subdivision Analysis  

- **Grid Creation**: 8th note subdivisions within beat boundaries
- **Dominant Notes**: Most common pitch per subdivision

### Phase 3: Consolidation & Filtering

- **Note Merging**: Combine consecutive identical pitches
- **Duration Filter**: Remove notes below minimum threshold (default: 0.05s)

### Output Format

```json
{
  "bpm": 120.0,
  "beat_timestamps": [0.0, 0.5, 1.0, 1.5],
  "melody_map": [
    {
      "pitch": "A4",
      "start_time": 1.23,
      "duration": 0.45
    }
  ],
  "analysis_info": {
    "total_beats": 150,
    "total_subdivisions": 300,
    "consolidated_notes": 100,
    "filtered_notes": 80,
    "min_note_duration": 0.05,
    "subdivision_factor": 2
  }
}
```

## 🛠️ Development

### Project Structure

```bash
TypoSync/
├── api/                    # Deno TypeScript API
│   ├── controllers/        # Request handlers
│   ├── services/          # Business logic
│   ├── types/             # Schemas and types
│   ├── middleware/        # Custom middleware
│   ├── tests/             # Test suites
│   └── main.ts           # Application entry
├── rhythm_engine/         # Python analysis engine
│   ├── app/              # FastAPI legacy code
│   ├── run.py            # Standalone executable
│   └── test_run.py       # Engine tests
├── docker-compose.yml    # Production containers
├── Makefile             # Development commands
└── CLAUDE.md           # AI assistant guidance
```

### Adding Features

1. **Write Tests First** (TDD approach)
2. **Update Schemas** in `api/types/schemas.ts`
3. **Implement Logic** in appropriate service/controller
4. **Update OpenAPI** documentation
5. **Test Integration** with Docker

### Code Quality

```bash
make format              # Format code
make lint               # Lint code
make health             # Check services
```

## 🚀 Production Deployment

### Performance Considerations

- **Deno Runtime**: V8 engine with TypeScript optimization
- **Python Engine**: Isolated processes for audio analysis
- **Redis Clustering**: Scale task management horizontally
- **Load Balancing**: Nginx reverse proxy configuration

### Monitoring

- **Health Checks**: Container and service monitoring
- **Structured Logging**: JSON logs for analysis
- **Metrics**: Task completion rates and processing times

### Security

- **Non-root Containers**: Security-hardened images
- **File Validation**: MIME type and size checking
- **Input Sanitization**: Filename and path validation
- **Resource Limits**: Container resource constraints

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch: `git checkout -b feature/amazing-feature`
3. **Write** tests for your changes
4. **Implement** the feature
5. **Test** thoroughly: `make test`
6. **Commit** changes: `git commit -m 'Add amazing feature'`
7. **Push** to branch: `git push origin feature/amazing-feature`
8. **Open** Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: <http://localhost:8000/docs>
- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)

## 🙏 Acknowledgments

- **Librosa** - Python audio analysis library
- **Deno** - Modern JavaScript/TypeScript runtime
- **Oak** - Web framework for Deno
- **Redis** - In-memory data structure store
