# Project Structure & Organization

## Root Directory Layout

```
TypoSync/
├── api/                    # Deno TypeScript API server
├── rhythm_engine/          # Python audio analysis engine
├── docker-compose*.yml     # Container orchestration
├── Makefile               # Development commands
├── .env.example           # Environment template
└── README.md              # Project documentation
```

## API Server Structure (`api/`)

### Core Application
- `main.ts` - Application entry point and server setup
- `deps.ts` - Centralized dependency imports
- `deno.json` - Deno configuration and tasks
- `healthcheck.ts` - Container health check script

### Organized by Layer
```
api/
├── config/                # Configuration management
│   └── config.ts         # Environment and settings
├── controllers/          # HTTP request handlers
│   ├── analysis-controller.ts
│   ├── enhanced-analysis-controller.ts
│   ├── cache-controller.ts
│   └── queue-controller.ts
├── services/             # Business logic layer
│   ├── analysis-service.ts
│   ├── enhanced-analysis-service.ts
│   ├── cache-service.ts
│   ├── queue-service.ts
│   ├── python-ipc.ts
│   ├── database-*.ts
│   └── task-manager.ts
├── middleware/           # HTTP middleware
│   ├── error-handler.ts
│   └── request-logger.ts
├── routes/              # Route definitions (closed folder)
├── types/               # Type definitions and schemas
│   ├── domain.ts        # Domain models
│   └── schemas.ts       # Zod validation schemas
├── utils/               # Utility functions
│   └── logger.ts        # Structured logging
├── docs/                # API documentation
│   ├── openapi.yaml     # OpenAPI specification
│   └── docs-handler.ts  # Documentation server
├── tests/               # Test suites
│   ├── test_*.ts        # Individual test files
│   └── integration_test.ts
└── uploads/             # Temporary file storage
```

## Python Engine Structure (`rhythm_engine/`)

### Standalone Engine
- `run.py` - Main executable script for IPC
- `test_run.py` - Engine test suite
- `requirements.txt` - Python dependencies
- `Dockerfile` - Container configuration

### Application Module
```
rhythm_engine/app/
├── __init__.py          # Package initialization
├── main.py             # FastAPI application (legacy)
├── config.py           # Configuration management
├── schemas.py          # Pydantic models
├── analysis_utils.py   # Core analysis logic
├── worker.py           # Background task processing
└── routers/            # API routes (closed folder)
```

## Architecture Patterns

### Layered Architecture (API)
1. **Controllers** - Handle HTTP requests/responses
2. **Services** - Implement business logic
3. **Data Layer** - Database and cache operations
4. **Types** - Shared schemas and domain models

### Service Communication
- **IPC**: Deno ↔ Python via subprocess and JSON
- **Caching**: Multi-tier (L1→L2→L3) with fallback
- **Queue**: Priority-based task management
- **Streaming**: Server-Sent Events for real-time updates

### File Organization Principles

#### API Server
- **Feature-based grouping** for controllers and services
- **Shared utilities** in dedicated folders
- **Type safety** with centralized schema definitions
- **Test co-location** with comprehensive coverage

#### Python Engine
- **Standalone executable** design for IPC
- **Minimal dependencies** for fast startup
- **Clear separation** between analysis logic and API

### Naming Conventions

#### Files and Directories
- **kebab-case** for file names (`analysis-service.ts`)
- **lowercase** for directories (`controllers/`)
- **Descriptive names** indicating purpose

#### Code Structure
- **PascalCase** for classes (`AnalysisService`)
- **camelCase** for functions and variables
- **UPPER_CASE** for constants and environment variables
- **Interfaces** prefixed with `I` when needed

### Import Organization
- **Centralized deps** in `api/deps.ts` for external libraries
- **Relative imports** for internal modules
- **Type-only imports** when appropriate
- **Barrel exports** for clean public APIs

### Configuration Management
- **Environment-based** configuration with `.env` files
- **Type-safe** config objects with validation
- **Sensible defaults** for development
- **Production overrides** via environment variables

### Error Handling Patterns
- **Structured logging** with context
- **Error categorization** (validation, system, analysis)
- **Graceful degradation** for non-critical failures
- **Proper HTTP status codes** and error responses