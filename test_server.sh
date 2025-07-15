#!/bin/bash

echo "Testing Deno server startup..."

# Kill any existing process on port 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null || true

# Start server in background
cd api
deno task dev &
SERVER_PID=$!

# Wait for server to start
sleep 3

# Test health endpoint
echo "Testing health endpoint..."
curl -f http://localhost:8000/ && echo " ✅ Health check passed" || echo " ❌ Health check failed"

# Test docs endpoint
echo "Testing docs endpoint..."
curl -f http://localhost:8000/docs >/dev/null && echo " ✅ Docs available" || echo " ❌ Docs failed"

# Kill the server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "✅ Server test completed successfully!"