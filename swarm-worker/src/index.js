const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 44444;
const UPDATE_URL = process.env.UPDATE_URL || 'https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json';
const UPDATE_MODE = process.env.UPDATE_MODE || 'periodic';

let currentVersion = process.env.WORKER_VERSION || '0.0.0';

const log = (...args) => console.log(new Date().toISOString().slice(0,19).replace('T',' '), ...args);
const logRaw = log;

log(`🐝 Worker 启动 - 版本: ${currentVersion}, 模式: ${UPDATE_MODE}`);
log(`📝 环境变量: WORKER_VERSION=${process.env.WORKER_VERSION || '(未设置)'}, UPDATE_MODE=${UPDATE_MODE}`);
let requestLogs = [];
let requestCount = 0;
let startTime = Date.now();
let isUpdating = false;
let checkInterval = null;
let lastHeartbeat = Date.now();
const HEARTBEAT_INTERVAL = (process.env.HEARTBEAT_INTERVAL || 30) * 60 * 1000; // 默认30分钟

const WORKER_PATH = process.env.WORKER_PATH || path.join(__dirname, '..', 'worker');
const WORKER_START_PATH = process.env.WORKER_START_PATH || '/app/worker-start.sh';
const WORKER_BASE = 'https://raw.githubusercontent.com/SwarmApi/swarmapi/master';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'SwarmWorker/1.0',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        resolve(data);
      });
    }).on('error', reject);

    req.setTimeout(30 * 1000, () => {
      req.abort();
      reject(new Error('Timeout'));
    });
  });
}

async function fetchVersions() {
  try {
    const data = await httpGet(UPDATE_URL);
    const trimmed = data.trim();
    if (!trimmed.startsWith('{')) {
      log('检查更新失败: 返回内容不是JSON:', trimmed.substring(0, 100));
      return null;
    }
    return JSON.parse(trimmed);
  } catch (e) {
    log('检查更新失败:', e.message);
    return null;
  }
}

async function downloadWorker(url) {
  const downloadUrl = url.startsWith('http') ? url : (WORKER_BASE + '/' + url);
  const tempPath = WORKER_PATH + '.new';

  return new Promise((resolve, reject) => {
    const client = downloadUrl.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tempPath);
    client.get(downloadUrl, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tempPath); } catch (err) {}
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        try { fs.chmodSync(tempPath, 0o755); } catch (err) {}
        if (fs.existsSync(WORKER_PATH)) {
          try { fs.unlinkSync(WORKER_PATH); } catch (err) {}
        }
        fs.renameSync(tempPath, WORKER_PATH);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(tempPath); } catch (e) {}
      reject(err);
    });
  });
}

async function downloadScript(url, targetPath) {
  const downloadUrl = url.startsWith('http') ? url : (WORKER_BASE + '/' + url);
  const tempPath = targetPath + '.new';

  return new Promise((resolve, reject) => {
    const client = downloadUrl.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tempPath);
    client.get(downloadUrl, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(tempPath); } catch (err) {}
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        try { fs.chmodSync(tempPath, 0o755); } catch (err) {}
        if (fs.existsSync(targetPath)) {
          try { fs.unlinkSync(targetPath); } catch (err) {}
        }
        fs.renameSync(tempPath, targetPath);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(tempPath); } catch (e) {}
      reject(err);
    });
  });
}

async function checkUpdate() {
  if (isUpdating) return;

  const meta = await fetchVersions();
  if (!meta) return;

  if (meta.version && meta.version !== currentVersion) {
    log(`🔄 发现新版本: ${currentVersion} → ${meta.version}`);
    await forceUpdate();
  } else {
    log(`✅ 当前已是最新版本: ${currentVersion}`);
  }
}

async function forceUpdate() {
  if (isUpdating) return 'Already updating';
  isUpdating = true;

  try {
    const meta = await fetchVersions();
    if (!meta) throw new Error('无法获取版本信息');

    if (!meta.version) {
      throw new Error('版本元信息缺少 version 字段');
    }

    const workerUrl = meta.worker_url || meta.url || 'worker';
    const startUrl = meta.worker_start_url || WORKER_BASE + '/worker-start.sh';

    log(`⬇️ 正在下载新版本: ${meta.version} (${workerUrl})`);
    await downloadWorker(workerUrl);

    log(`⬇️ 正在下载最新 worker-start.sh: ${startUrl}`);
    try {
      await downloadScript(startUrl, WORKER_START_PATH);
    } catch (err) {
      log('更新 worker-start.sh 失败:', err.message);
    }

    currentVersion = meta.version || currentVersion;
    process.env.WORKER_VERSION = currentVersion;

    log(`🔄 正在重启...`);

    setTimeout(() => {
      const isSupervised = process.env.WORKER_SUPERVISED === '1' || process.env.WORKER_SUPERVISED === 'true';
      if (isSupervised) {
        log('🔧 由 worker-start.sh 管理，直接退出（supervisor 将重启）');
        process.exit(0);
        return;
      }

      const workerBin = process.env.WORKER_PATH || process.execPath;
      const spawnArgs = process.env.WORKER_PATH ? [] : process.argv.slice(1);

      log(`🔧 未检测到 supervisor，直接自启动新实例: ${workerBin} ${spawnArgs.join(' ')}`);
      spawn(workerBin, spawnArgs, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, WORKER_VERSION: currentVersion }
      }).unref();
      process.exit(0);
    }, 1000);

    return `更新到 ${currentVersion} 成功，重启中...`;
  } catch (e) {
    log('更新失败:', e.message);
    return e.message;
  } finally {
    isUpdating = false;
  }
}

function startUpdater() {
  log('🌡️ 热更新服务已启动');
  
  if (UPDATE_MODE === 'periodic') {
    // 定期检查由 worker-start.sh Shell 脚本层负责，Worker 进程只在启动时检查一次
    checkUpdate();
  } else if (UPDATE_MODE === 'manual') {
    // 仅启动时检查一次（脚本已检查，但为安全起见再检查）
    checkUpdate();
  } else { // none
    // 不启动周期检查
  }
}

function stopUpdater() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function httpRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    
    const req = client.request(targetUrl, {
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Timeout')));
    
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function callOpenCode(rawBody, headers = {}) {
  const openaiUrl = 'https://opencode.ai/zen/v1/chat/completions';

  const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

  return httpRequest(openaiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer public`,
      ...headers
    },
    body
  });
}

const localIP = getLocalIP();

const workerHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>🐝 Swarm Worker</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #00ff00; padding: 20px; }
    h1 { text-align: center; }
    .status { background: #0a0a1a; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
    .online { color: #00ff00; }
    .log { background: #000; padding: 10px; max-height: 400px; overflow: auto; font-size: 12px; }
    .stat { display: flex; justify-content: space-between; margin-bottom: 10px; }
    .stat-item { padding: 10px; background: #0a0a1a; border-radius: 6px; flex: 1; margin: 0 5px; text-align: center; }
  </style>
</head>
<body>
  <h1>🐝 Swarm Worker</h1>
  <div class="status">
    <div class="stat">
      <div class="stat-item">状态: <span class="online">在线</span></div>
      <div class="stat-item">版本: ${currentVersion}</div>
      <div class="stat-item">请求数: ${requestCount}</div>
    </div>
    <div class="stat">
      <div class="stat-item">本机IP: ${localIP}</div>
      <div class="stat-item">运行时间: <span id="uptime"></span></div>
    </div>
  </div>
  <h3>请求日志:</h3>
  <div class="log" id="log"></div>
  <script>
    function formatUptime(ms) {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      const d = Math.floor(h / 24);
      if (d > 0) return d + 'd ' + (h % 24) + 'h';
      if (h > 0) return h + 'h ' + (m % 60) + 'm';
      return m + 'm';
    }
    setInterval(() => {
      fetch('/api/info').then(r => r.json()).then(d => {
        document.getElementById('log').innerHTML = d.logs.join('<br>') || '暂无日志';
        document.getElementById('uptime').textContent = formatUptime(d.uptime);
      });
    }, 3000);
  </script>
</body>
</html>
`;

async function route(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const method = req.method;
  
  // CORS 支持
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/') || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // 处理 OPTIONS 预检请求
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(workerHTML);
  }
  
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', version: currentVersion, uptime: Date.now() - startTime }));
  }

  if (pathname === '/api/info') {
    return res.end(JSON.stringify({
      role: 'worker',
      ip: localIP,
      version: currentVersion,
      uptime: Date.now() - startTime,
      requestCount: requestCount,
      logs: requestLogs.slice(-20),
      timestamp: new Date().toISOString()
    }));
  }
  
  if ((pathname === '/api/update' || pathname === '/api/worker/update') && method === 'POST') {
    log(`🔔 收到 ${pathname} 调用，当前版本: ${currentVersion}`);
    try {
      const result = await forceUpdate();
      log(`🔔 /api/update 完成，新版本: ${currentVersion}`);
      res.end(JSON.stringify({ success: true, version: currentVersion, message: result }));
    } catch (err) {
      log(`🔔 /api/update 失败: ${err.message}`);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }
  
  if (pathname === '/api/logs' && method === 'GET') {
    return res.end(JSON.stringify({ logs: requestLogs.slice(-50) }));
  }
  
  if (pathname.startsWith('/v1/') && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const start = Date.now();
      requestLogs.push(`[${new Date().toISOString()}] 收到请求 ${pathname}`);
      if (requestLogs.length > 100) requestLogs.shift();

      let parsed;
      let modelForLog = '-';
      let messagesForLog = '-';
      try {
        parsed = JSON.parse(body);
        modelForLog = parsed.model || '-';
        if (parsed.model === 'free') {
          modelForLog = 'big-pickle';
        }
        if (Array.isArray(parsed.messages)) {
          messagesForLog = parsed.messages.map(m => (m.content || '').replace(/\s+/g, ' ').slice(0, 150)).join(' | ');
        }
      } catch (e) {
        // ignore parse errors,透明转发
      }

      requestLogs.push(`[${new Date().toISOString()}] 代理模型: ${modelForLog}, messages: ${messagesForLog}`);
      if (requestLogs.length > 100) requestLogs.shift();

      if (parsed && parsed.model === 'free') {
        parsed.model = 'big-pickle';
        body = JSON.stringify(parsed);
      }

      try {
        const result = await callOpenCode(body, req.headers);

        requestCount++;
        requestLogs.push(`[${new Date().toISOString()}] 响应成功 (${Date.now() - start}ms)`);
        if (requestLogs.length > 100) requestLogs.shift();

        res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (e) {
        requestLogs.push(`[${new Date().toISOString()}] 错误: ${e.message}`);
        if (requestLogs.length > 100) requestLogs.shift();
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
}

const server = http.createServer(route);

server.listen(PORT, '0.0.0.0', () => {
  log(`🐝 Swarm Worker 运行中`);
  log(`📍 本机IP: ${localIP}`);
  log(`🌐 端口: ${PORT}`);
  log(`📦 版本: ${currentVersion}`);
  
  try {
    startUpdater();
  } catch (err) {
    log('热更新模块启动失败:', err.message);
  }

  // 启动心跳日志：每N分钟打印一次进程状态
  function printHeartbeat() {
    const uptime = Date.now() - startTime;
    const uptimeMinutes = Math.floor(uptime / 60000);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    const displayHours = uptimeHours % 24;
    const uptimeMins = uptimeMinutes % 60;
    
    let uptimeStr;
    if (uptimeDays > 0) {
      uptimeStr = `${uptimeDays}d${displayHours}h${uptimeMins}m`;
    } else {
      uptimeStr = `${uptimeHours}h${uptimeMins}m`;
    }
    
    const mem = process.memoryUsage();
    const memUsedMB = Math.round(mem.rss / 1024 / 1024); // RSS - 实际使用的物理内存

    // 获取磁盘信息 - 使用 df 命令获取容器文件系统信息
    let diskInfo = 'N/A';
    try {
      const { execSync } = require('child_process');
      const dfOutput = execSync('df -h / | tail -1', { encoding: 'utf8' });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 5) {
        // 在容器中，显示可用空间（总大小可能不准确）
        diskInfo = `可用: ${parts[3]}`;
      }
    } catch (e) {
      diskInfo = 'N/A';
    }

    // 获取 CPU 负载
    const loadAvg = os.loadavg();
    const cpuLoad = `负载: ${loadAvg[0].toFixed(2)}`;

    const heartbeatLog = `💓 [心跳] 运行时间: ${uptimeStr} | 请求数: ${requestCount} | 内存: ${memUsedMB}MB | ${cpuLoad} | 磁盘: ${diskInfo}`;
    log(heartbeatLog);
    requestLogs.push(heartbeatLog);
    if (requestLogs.length > 100) requestLogs.shift();
  }

  // 立即打印一次心跳
  printHeartbeat();

  // 定期打印心跳
  setInterval(() => {
    printHeartbeat();
  }, HEARTBEAT_INTERVAL);
});
