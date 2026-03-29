#!/bin/bash
set -e

echo "🐝 Building Swarm Worker..."

cd "$(dirname "$0")"

echo "📦 Installing pkg..."
npm install -g pkg

echo "🏗️ Packaging..."
pkg src/index.js --targets node20-linux-x64,node20-win-x64 --output worker

echo "✅ Build complete!"
echo ""
echo "Output:"
ls -la worker
