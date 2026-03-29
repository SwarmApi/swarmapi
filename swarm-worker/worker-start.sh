#!/bin/bash

WORKER_PATH="${WORKER_PATH:-/app/worker}"
UPDATE_URL="${UPDATE_URL:-https://raw.githubusercontent.com/SwarmApi/swarmapi/master/swarmapi/versions.json}"
WORKER_BASE="https://raw.githubusercontent.com/SwarmApi/swarmapi/master/swarmapi"
GIT_PROXY="${GIT_PROXY:-}"

echo "🌐 检查 Worker 更新..."

fetch_version() {
    if [ -n "$GIT_PROXY" ]; then
        curl -s --proxy "$GIT_PROXY" --max-time 10 "$UPDATE_URL" 2>/dev/null || echo '{"version":"0.0.0"}'
    else
        curl -s --max-time 10 "$UPDATE_URL" 2>/dev/null || echo '{"version":"0.0.0"}'
    fi
}

get_version() {
    fetch_version | grep -o '"version":"[^"]*"' | cut -d'"' -f4
}

download_worker() {
    local url="$1"
    echo "⬇️ 下载 Worker: $url"
    if [ -n "$GIT_PROXY" ]; then
      curl -s --proxy "$GIT_PROXY" --max-time 60 -o "$WORKER_PATH.new" "$url" && {
        chmod +x "$WORKER_PATH.new"
        mv -f "$WORKER_PATH.new" "$WORKER_PATH"
        echo "✅ 下载完成"
        return 0
      }
    else
      curl -s --max-time 60 -o "$WORKER_PATH.new" "$url" && {
        chmod +x "$WORKER_PATH.new"
        mv -f "$WORKER_PATH.new" "$WORKER_PATH"
        echo "✅ 下载完成"
        return 0
      }
    fi

    rm -f "$WORKER_PATH.new"
    echo "❌ 下载失败"
    return 1
}

CURRENT_VERSION="${WORKER_VERSION:-0.0.0}"
LATEST_VERSION=$(get_version)

if [ -f "$WORKER_PATH" ]; then
    echo "📦 当前版本: $CURRENT_VERSION"
    echo "🌐 最新版本: $LATEST_VERSION"
    
    if [ "$LATEST_VERSION" != "$CURRENT_VERSION" ]; then
        download_worker "${WORKER_BASE}/worker"
    fi
else
    echo "🆕 首次运行，下载 Worker..."
    download_worker "${WORKER_BASE}/worker"
fi

if [ ! -f "$WORKER_PATH" ]; then
    echo "❌ Worker 二进制文件不存在"
    exit 1
fi

echo "🚀 启动 Worker..."
exec "$WORKER_PATH"
