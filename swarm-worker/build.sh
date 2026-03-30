#!/bin/bash
set -e

echo "🐝 Building Swarm Worker..."

cd "$(dirname "$0")"

echo "🏗️ Packaging..."
pkg src/index.js --targets node18-linux-x64 --output ../swarmapi/worker

echo "✅ Build complete!"
echo ""
echo "Output:"
ls -la ../swarmapi/worker
