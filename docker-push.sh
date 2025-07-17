#!/bin/bash

# TypoSync Docker Hub Push Script
# This script builds and pushes the TypoSync images to Docker Hub

set -e

echo "🚀 TypoSync Docker Hub Push Script"
echo "================================="

# Configuration
REGISTRY="docker.io"
NAMESPACE="typosync"
API_IMAGE="$NAMESPACE/api"
ENGINE_IMAGE="$NAMESPACE/rhythm-engine"
TAG="${1:-latest}"

echo "📋 Configuration:"
echo "   Registry: $REGISTRY"
echo "   Namespace: $NAMESPACE"
echo "   Tag: $TAG"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if we're logged in to Docker Hub
if ! docker info | grep -q "Username"; then
    echo "⚠️  You are not logged in to Docker Hub."
    echo "   Please run: docker login"
    exit 1
fi

echo "🏗️  Building images..."

# Build API image
echo "Building API image..."
docker build -t "$API_IMAGE:$TAG" ./api

# Build Rhythm Engine image
echo "Building Rhythm Engine image..."
docker build -t "$ENGINE_IMAGE:$TAG" ./rhythm_engine

echo "✅ Images built successfully!"

# Tag images for Docker Hub
echo "🏷️  Tagging images..."
docker tag "$API_IMAGE:$TAG" "$REGISTRY/$API_IMAGE:$TAG"
docker tag "$ENGINE_IMAGE:$TAG" "$REGISTRY/$ENGINE_IMAGE:$TAG"

# Push to Docker Hub
echo "📤 Pushing images to Docker Hub..."
docker push "$REGISTRY/$API_IMAGE:$TAG"
docker push "$REGISTRY/$ENGINE_IMAGE:$TAG"

echo "✅ Images pushed successfully!"

# Clean up local tags
echo "🧹 Cleaning up local tags..."
docker rmi "$REGISTRY/$API_IMAGE:$TAG" || true
docker rmi "$REGISTRY/$ENGINE_IMAGE:$TAG" || true

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