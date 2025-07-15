# TypoSync Development Makefile

.PHONY: help build test dev clean docker-build docker-test

# Default target
help:
	@echo "TypoSync Development Commands:"
	@echo "  dev           - Start development environment (Docker, in-memory)"
	@echo "  dev-redis     - Start development with Redis (Docker)"
	@echo "  dev-local     - Start local development (no Docker)"
	@echo "  build         - Build all Docker images"
	@echo "  test          - Run all tests"
	@echo "  test-deno     - Run Deno API tests"
	@echo "  test-python   - Run Python engine tests"
	@echo "  test-coverage - Run tests with coverage"
	@echo "  docker-build  - Build Docker images"
	@echo "  docker-test   - Test Docker setup"
	@echo "  clean         - Clean up containers and volumes"
	@echo "  docs          - Start API documentation server"

# Development
dev:
	@echo "🚀 Starting development environment (in-memory mode)..."
	docker-compose -f docker-compose.dev-only.yml up --build

dev-redis:
	@echo "🚀 Starting development environment with Redis..."
	docker-compose -f docker-compose.yml up --build

# Testing
test: test-deno test-python
	@echo "✅ All tests completed"

test-deno:
	@echo "🧪 Running Deno API tests..."
	cd api && deno task test

test-python:
	@echo "🧪 Running Python engine tests..."
	cd rhythm_engine && python test_run.py

test-coverage:
	@echo "📊 Running tests with coverage..."
	cd api && deno task coverage
	cd rhythm_engine && coverage run --source=app test_run.py && coverage report

# Docker
docker-build:
	@echo "🐳 Building Docker images..."
	docker-compose build

docker-test:
	@echo "🐳 Testing Docker setup..."
	docker-compose up -d
	@echo "Waiting for services to start..."
	sleep 30
	curl -f http://localhost:8000/ || (echo "❌ API health check failed" && exit 1)
	curl -f http://localhost:8000/docs || (echo "❌ API docs check failed" && exit 1)
	@echo "✅ Docker setup working"
	docker-compose down

# Production
prod:
	@echo "🚀 Starting production environment..."
	docker-compose --profile production up -d

# Documentation
docs:
	@echo "📚 Starting documentation server..."
	cd api && deno task dev

# Cleanup
clean:
	@echo "🧹 Cleaning up..."
	docker-compose down -v
	docker system prune -f
	rm -rf api/coverage/
	rm -rf api/coverage.lcov
	rm -rf rhythm_engine/.coverage
	rm -rf rhythm_engine/coverage.xml

# Development helpers
format:
	@echo "🎨 Formatting code..."
	cd api && deno fmt
	cd rhythm_engine && python -m black . --line-length 100

lint:
	@echo "🔍 Linting code..."
	cd api && deno lint
	cd rhythm_engine && python -m flake8 --max-line-length 100

# Install dependencies
install:
	@echo "📦 Installing dependencies..."
	cd api && deno cache deps.ts
	cd rhythm_engine && pip install -r requirements.txt

# Local development (without Docker)
dev-local:
	@echo "🚀 Starting local development (no Docker)..."
	@echo "Make sure Python environment is set up in rhythm_engine/"
	cd api && deno task dev

# Run specific services
api-only:
	@echo "🚀 Starting API server only..."
	cd api && deno task dev

python-test:
	@echo "🐍 Testing Python engine standalone..."
	cd rhythm_engine && python run.py --help

# Health checks
health:
	@echo "🏥 Checking service health..."
	curl -f http://localhost:8000/ && echo "✅ API is healthy" || echo "❌ API is down"
	curl -f http://localhost:8000/docs && echo "✅ Docs are available" || echo "❌ Docs are down"

# Quick development setup
setup:
	@echo "⚙️  Setting up development environment..."
	cp .env.example .env
	@echo "✅ Created .env file (customize as needed)"
	make install
	@echo "✅ Development environment ready!"
	@echo "Run 'make dev' to start development server"