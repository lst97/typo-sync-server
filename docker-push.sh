#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
API_DIR="$SCRIPT_DIR/api"
RHYTHM_ENGINE_DIR="$SCRIPT_DIR/rhythm_engine"
DOCKER_HUB_USERNAME="lst97"

# Docker image configuration
API_IMAGE="typosync-api"
ENGINE_IMAGE="typosync-rhythm-engine"
TAG="latest"
REGISTRY="$DOCKER_HUB_USERNAME"
NAMESPACE="$DOCKER_HUB_USERNAME"

export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin/"

# Set up Docker Buildx for multi-architecture builds
echo "🔧 Setting up Docker Buildx..."
docker buildx create --name multiarch-builder --use --bootstrap || true
docker buildx inspect --bootstrap

echo "🏗️  Building and pushing multi-architecture images..."

# Build and push API image for multiple architectures
echo "Building and pushing API image for arm64 and amd64..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$REGISTRY/$API_IMAGE:$TAG" \
  --push \
  ./api

# Build and push Rhythm Engine image for multiple architectures
echo "Building and pushing Rhythm Engine image for arm64 and amd64..."
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$REGISTRY/$ENGINE_IMAGE:$TAG" \
  --push \
  ./rhythm_engine

echo "✅ Multi-architecture images built and pushed successfully!"

# Clean up buildx builder
echo "🧹 Cleaning up buildx builder..."
docker buildx rm multiarch-builder || true

echo ""
echo "🎉 Docker Hub push completed!"
echo "📦 Images available at:"
echo "   - $REGISTRY/$API_IMAGE:$TAG"
echo "   - $REGISTRY/$ENGINE_IMAGE:$TAG"
echo ""
echo "🚀 To run the application:"
echo "   docker-compose -f docker-compose.simple.yml up"
echo ""
echo "📚 Documentation:"
echo "   https://hub.docker.com/r/$NAMESPACE/api"
echo "   https://hub.docker.com/r/$NAMESPACE/rhythm-engine"