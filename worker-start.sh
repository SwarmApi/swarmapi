#!/bin/sh

WORKER_PATH="${WORKER_PATH:-/app/worker}"
UPDATE_URL="${UPDATE_URL:-https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json}"
WORKER_BASE="https://raw.githubusercontent.com/SwarmApi/swarmapi/master"
WORKER_START_URL="${WORKER_START_URL:-https://raw.githubusercontent.com/SwarmApi/swarmapi/master/worker-start.sh}"
WORKER_START_PATH="${WORKER_START_PATH:-/app/worker-start.sh}"
UPDATE_MODE="${UPDATE_MODE:-periodic}"
CHECK_INTERVAL="${CHECK_INTERVAL:-3600}"

# UPDATE_MODE:
#  - periodic: 脚本启动后按 CHECK_INTERVAL 轮询远程版本（默认一天）
#  - manual: 仅启动时检查一次，之后由 worker 内部 /api/update 调用触发更新
#  - none: 不在脚本层做定时检查，仅首次启动一次

log() {
    printf "%s %s\n" "$(date +'%Y-%m-%d %H:%M:%S')" "$1"
}

fetch_version() {
    node -e "
    const https = require('https');
    const url = '$UPDATE_URL';
    https.get(url, { headers: { 'User-Agent': 'worker-start.sh' } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data.trim());
          console.log(JSON.stringify(parsed));
        } catch (e) {
          console.log('{\"version\":\"0.0.0\"}');
        }
      });
    }).on('error', () => console.log('{\"version\":\"0.0.0\"}'));
    " 2>/dev/null || echo '{"version":"0.0.0"}'
}

get_version() {
    fetch_version | grep -o '"version":"[^"]*"' | cut -d'"' -f4
}

get_field() {
    local key="$1"
    fetch_version | grep -o "\"${key}\":\"[^\"]*\"" | cut -d'"' -f4
}

get_worker_url() {
    local w
    w="$(get_field worker_url)"
    [ -z "$w" ] && w="$(get_field url)"
    [ -z "$w" ] && w="${WORKER_BASE}/worker"
    echo "$w"
}

get_worker_start_url() {
    local s
    s="$(get_field worker_start_url)"
    [ -z "$s" ] && s="${WORKER_START_URL}"
    echo "$s"
}

download_worker() {
    local url="$1"
    log "⬇️ 下载 Worker: $url"
    [ -d "$(dirname "$WORKER_PATH")" ] || mkdir -p "$(dirname "$WORKER_PATH")"

    if timeout 120 node -e "
    const https = require('https');
    const fs = require('fs');
    const url = '$url';
    const file = fs.createWriteStream('$WORKER_PATH.new');
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync('$WORKER_PATH.new');
        process.exit(1);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        process.exit(0);
      });
    });
    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync('$WORKER_PATH.new'); } catch(e) {}
      process.exit(1);
    });
    req.setTimeout(110000, () => {
      req.abort();
      file.close();
      try { fs.unlinkSync('$WORKER_PATH.new'); } catch(e) {}
      process.exit(1);
    });
    "; then
        chmod +x "$WORKER_PATH.new"
        mv -f "$WORKER_PATH.new" "$WORKER_PATH"
        log "✅ 下载完成"
        return 0
    fi

    rm -f "$WORKER_PATH.new"
    log "❌ 下载失败"
    return 1
}

check_worker_exists() {
    if [ ! -f "$WORKER_PATH" ]; then
        log "❌ Worker 二进制文件不存在: $WORKER_PATH"
        return 1
    fi

    if [ ! -x "$WORKER_PATH" ]; then
        chmod +x "$WORKER_PATH" 2>/dev/null
    fi

    if [ ! -x "$WORKER_PATH" ]; then
        log "❌ Worker 文件不可执行"
        return 1
    fi

    return 0
}

show_details() {
    if [ -f "$WORKER_PATH" ]; then
        log "Worker 文件信息: $(ls -l "$WORKER_PATH")"
        file "$WORKER_PATH" 2>/dev/null | log
    fi
}

update_self_script() {
    local script_url="${1:-$(get_worker_start_url)}"
    [ -n "$script_url" ] || return 0

    local tmp="/tmp/worker-start.sh.new"
    if node -e "
    const https = require('https');
    const fs = require('fs');
    const url = '$script_url';
    const file = fs.createWriteStream('$tmp');
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync('$tmp');
        process.exit(1);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        process.exit(0);
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync('$tmp'); } catch(e) {}
      process.exit(1);
    });
    "; then
        chmod +x "$tmp"
        if [ ! -f "$WORKER_START_PATH" ] || ! cmp -s "$tmp" "$WORKER_START_PATH"; then
            log "🔄 检测到 worker-start.sh 新版本，替换并重启脚本"
            mv -f "$tmp" "$WORKER_START_PATH"
            exec "$WORKER_START_PATH"
        fi
    fi
    rm -f "$tmp"
}

# 首次或版本更新检查
prepare_worker() {
    local current="${WORKER_VERSION:-0.0.0}"
    local latest
    local worker_url
    local start_url

    latest=$(get_version)
    worker_url=$(get_worker_url)
    start_url=$(get_worker_start_url)

    log "🌐 检查 Worker 更新..."
    log "📦 当前版本: $current"
    log "🌐 最新版本: ${latest:-<未知>}"
    log "📡 worker_url: ${worker_url}"
    log "📡 worker_start_url: ${start_url}"

    if [ -z "$latest" ] || [ "$latest" = "null" ]; then
        log "⚠️ 版本读取失败，保留现有 Worker"
    else
        if [ ! -f "$WORKER_PATH" ] || [ "$latest" != "$current" ]; then
            download_worker "$worker_url"
            update_self_script "$start_url"
            WORKER_VERSION="$latest"
        else
            # 尝试更新脚本（即使版本相同）
            update_self_script "$start_url"
        fi
    fi

    if ! check_worker_exists; then
        show_details
        return 1
    fi

    return 0
}

# 如果需要守护与热更新（退出后重启）
update_self_script
while true; do
    if ! prepare_worker; then
        log "🚨 无法准备 Worker，5 秒后重试"
        sleep 5
        continue
    fi

    log "🚀 启动 Worker..."
    "$WORKER_PATH" &
    WORKER_PID=$!

    if [ "$UPDATE_MODE" = "manual" ]; then
        log "🛠️ 已设置 UPDATE_MODE=manual，只在启动时检查一次，交给队长 Queen 调用 /api/update 来更新"
        wait "$WORKER_PID" 2>/dev/null
        log "🔁 Worker 退出，重新启动"
        sleep 1
        continue
    fi

    if [ "$UPDATE_MODE" = "none" ]; then
        log "🛠️ 已设置 UPDATE_MODE=none，不做周期性更新。"
        wait "$WORKER_PID" 2>/dev/null
        log "🔁 Worker 退出，重新启动"
        sleep 1
        continue
    fi

    # periodic 模式默认（或 UPDATE_MODE=periodic）
    while kill -0 "$WORKER_PID" 2>/dev/null; do
        sleep "$CHECK_INTERVAL"

        latest=$(get_version)
        if [ -n "$latest" ] && [ "$latest" != "${WORKER_VERSION:-0.0.0}" ]; then
            log "🛠️ 检测到新版本 $latest，更新并重启"
            if download_worker "${WORKER_BASE}/worker"; then
                WORKER_VERSION="$latest"
                kill -TERM "$WORKER_PID" 2>/dev/null || true
                break
            fi
        fi
    done

    wait "$WORKER_PID" 2>/dev/null
    log "🔁 Worker 退出，重新启动"
    sleep 1
done
