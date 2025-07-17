# TypoSync Docker Hub Images

This document describes the Docker Hub images for TypoSync, a modern audio analysis service.

## 📦 Available Images

### 1. TypoSync API Server

- **Image**: `typosync/api:latest`
- **Description**: Deno TypeScript API server with Oak framework
- **Base Image**: `denoland/deno:2.4.1`
- **Ports**: 8000
- **Architecture**: AMD64, ARM64

### 2. TypoSync Rhythm Engine

- **Image**: `typosync/rhythm-engine:latest`
- **Description**: Python audio analysis engine with librosa
- **Base Image**: `python:3.11-slim`
- **Architecture**: AMD64, ARM64

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/lst97/typosync.git
cd typosync

# Start the services
docker-compose -f docker-compose.simple.yml up -d

# Access the API
curl http://localhost:8000/
```

### Using Docker Run

```bash
# Create a network
docker network create typosync_network

# Start Redis
docker run -d --name typosync_redis \
  --network typosync_network \
  -p 6379:6379 \
  redis:7-alpine redis-server --appendonly yes

# Start Rhythm Engine
docker run -d --name typosync_rhythm_engine \
  --network typosync_network \
  typosync/rhythm-engine:latest

# Start API Server
docker run -d --name typosync_api \
  --network typosync_network \
  -p 8000:8000 \
  -e REDIS_URL=redis://typosync_redis:6379/0 \
  -e PYTHON_EXECUTABLE=python3 \
  -e RHYTHM_ENGINE_PATH=/rhythm_engine/run.py \
  typosync/api:latest
```

## ⚙️ Configuration

### Environment Variables

#### API Server (`typosync/api`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8000 | Server port |
| `LOG_LEVEL` | INFO | Logging level |
| `REDIS_URL` | - | Redis connection URL |
| `PYTHON_EXECUTABLE` | python3 | Python executable path |
| `RHYTHM_ENGINE_PATH` | /rhythm_engine/run.py | Rhythm engine script path |
| `MAX_FILE_SIZE` | 52428800 | Max upload size (50MB) |
| `TURNSTILE_SECRET_KEY` | - | Turnstile CAPTCHA secret key |
| `CACHE_L1_MAX_SIZE` | 100 | L1 cache size |
| `CACHE_L2_TTL_SECONDS` | 3600 | L2 cache TTL |
| `QUEUE_CONCURRENCY_LIMIT` | 2 | Queue concurrency limit |

#### Rhythm Engine (`typosync/rhythm-engine`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MIN_NOTE_DURATION` | 0.05 | Minimum note duration |

### Volumes

#### API Server

- `/app/uploads` - Temporary file uploads
- `/app/data` - Database and persistent storage
- `/app/logs` - Application logs

#### Rhythm Engine

- `/app` - Application code (mounted read-only)

### Health Checks

Both images include comprehensive health checks:

- **API Server**: `deno run --allow-net healthcheck.ts`
- **Rhythm Engine**: `python run.py --version`

## 📊 Multi-Architecture Support

Images are built for multiple architectures:

- `linux/amd64` - Intel/AMD 64-bit
- `linux/arm64` - ARM 64-bit (Apple Silicon, ARM servers)

## 🔧 Development

### Building Images Locally

```bash
# Build API image
docker build -t typosync/api:latest ./api

# Build Rhythm Engine image
docker build -t typosync/rhythm-engine:latest ./rhythm_engine

# Build both using Docker Compose
docker-compose -f docker-compose.simple.yml build
```

### Custom Tags

```bash
# Build with custom tag
docker build -t typosync/api:v2.0.0 ./api

# Push to Docker Hub
docker push typosync/api:v2.0.0
```

## 🏭 Production Deployment

### Docker Compose Production

```yaml
services:
  api:
    image: typosync/api:latest
    restart: unless-stopped
    environment:
      - REDIS_URL=redis://redis:6379/0
      - TURNSTILE_SECRET_KEY=your_secret_key
    depends_on:
      - redis
      - rhythm_engine
    healthcheck:
      test: ["CMD", "deno", "run", "--allow-net", "healthcheck.ts"]
      interval: 30s
      timeout: 10s
      retries: 3

  rhythm_engine:
    image: typosync/rhythm-engine:latest
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "run.py", "--version"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: typosync-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: typosync-api
  template:
    metadata:
      labels:
        app: typosync-api
    spec:
      containers:
      - name: api
        image: typosync/api:latest
        ports:
        - containerPort: 8000
        env:
        - name: REDIS_URL
          value: redis://typosync-redis:6379/0
        livenessProbe:
          exec:
            command:
            - deno
            - run
            - --allow-net
            - healthcheck.ts
          initialDelaySeconds: 30
          periodSeconds: 30
```

## 📈 Monitoring

### Metrics

The API server exposes metrics for monitoring:

- Health check endpoints
- Queue status and performance
- Cache hit rates and statistics
- Processing times and throughput

### Logging

Structured JSON logging is available:

- Request/response logging
- Error tracking
- Performance metrics
- Security events

## 🔐 Security

### Best Practices

1. **Non-root User**: Rhythm Engine runs as non-root user
2. **Read-only Mounts**: Source code mounted read-only
3. **Resource Limits**: CPU and memory limits configured
4. **Health Checks**: Comprehensive health monitoring
5. **Secrets**: Use environment variables for sensitive data

### Security Scanning

Images are regularly scanned for vulnerabilities:

```bash
# Scan for vulnerabilities
docker scout cves typosync/api:latest
docker scout cves typosync/rhythm-engine:latest
```

## 🆘 Troubleshooting

### Common Issues

1. **Container Won't Start**
   - Check logs: `docker logs typosync_api`
   - Verify environment variables
   - Ensure Redis is running

2. **Permission Errors**
   - Check volume permissions
   - Verify user/group ownership

3. **Performance Issues**
   - Monitor resource usage
   - Check Redis connection
   - Review queue metrics

### Debug Mode

Run containers with debug logging:

```bash
docker run -e LOG_LEVEL=DEBUG typosync/api:latest
```

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please see the main repository for contributing guidelines.

## 📧 Support

- **Documentation**: <https://github.com/lst97/typosync>
- **Issues**: <https://github.com/lst97/typosync/issues>
- **Docker Hub**: <https://hub.docker.com/r/typosync/api>
