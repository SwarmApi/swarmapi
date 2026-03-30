const http = require('http');
const https = require('https');
const os = require('os');
const { URL } = require('url');

const PORT = process.env.PORT || 44444;
const UPDATE_URL = process.env.UPDATE_URL || 'https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json';

let currentVersion = process.env.WORKER_VERSION || '0.0.0';
let requestLogs = [];
let requestCount = 0;
let startTime = Date.now();

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

const updater = require('./updater');

async function callOpenCode(messages, model, headers = {}) {
  const openaiUrl = 'https://api.opencode.ai/v1/chat/completions';
  
  return httpRequest(openaiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer public`,
      'x-api-key': 'public',
      ...headers
    },
    body: JSON.stringify({
      model: model || 'gpt-5-nano',
      messages: messages,
      max_tokens: 4096
    })
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
  
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(workerHTML);
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
  
  if (pathname === '/api/update' && method === 'POST') {
    try {
      const result = await updater.forceUpdate();
      res.end(JSON.stringify({ success: true, version: currentVersion, message: result }));
    } catch (err) {
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
      
      try {
        const parsed = JSON.parse(body);
        const messages = parsed.messages || [];
        const model = parsed.model || 'gpt-5-nano';
        const result = await callOpenCode(messages, model, req.headers);
        
        requestCount++;
        requestLogs.push(`[${new Date().toISOString()}] 响应成功 (${Date.now() - start}ms)`);
        
        res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (e) {
        requestLogs.push(`[${new Date().toISOString()}] 错误: ${e.message}`);
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
  console.log(`🐝 Swarm Worker 运行中`);
  console.log(`📍 本机IP: ${localIP}`);
  console.log(`🌐 端口: ${PORT}`);
  console.log(`📦 版本: ${currentVersion}`);
  
  try {
    updater.startUpdater();
  } catch (err) {
    console.log('热更新模块启动失败:', err.message);
  }
});
