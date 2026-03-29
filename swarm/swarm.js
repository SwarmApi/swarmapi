const http = require('http');
const https = require('https');
const os = require('os');
const url = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 44444;
const ROLE = process.env.ROLE || 'queen';  // queen | worker

// 加密配置
const ENCRYPT_KEY = process.env.ENCRYPT_KEY || 'swarm-default-key-2026';

// 内存中的URL列表 (仅Queen需要)
let nodes = [];
let currentIndex = 0;

// ========== 加密函数 ==========
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPT_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const key = crypto.scryptSync(ENCRYPT_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return [];
  }
}

// ========== HTTP请求函数 ==========
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
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Timeout')));
    
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ========== OpenAI API调用 ==========
async function callOpenAI(apiKey, model, messages) {
  const openaiUrl = 'https://api.opencode.ai/v1/chat/completions';
  
  const reqData = {
    model: model || 'openai/gpt-5-nano',
    messages: messages,
    max_tokens: 4096
  };
  
  return httpRequest(openaiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-api-key': 'public'
    },
    body: JSON.stringify(reqData)
  });
}

// 获取本机IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const localIP = getLocalIP();

// ========== Worker模式 HTML ==========
const workerHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>🐝 Swarm Worker</title>
  <style>
    body { font-family: monospace; background: #1a1a2e; color: #00ff00; padding: 20px; }
    h1 { text-align: center; }
    .status { background: #0a0a1a; padding: 20px; border-radius: 10px; }
    .online { color: #00ff00; }
    .log { background: #000; padding: 10px; max-height: 300px; overflow: auto; }
  </style>
</head>
<body>
  <h1>🐝 Swarm Worker</h1>
  <div class="status">
    <p>状态: <span class="online">在线</span></p>
    <p>本机IP: ${localIP}</p>
    <p>角色: Worker</p>
  </div>
  <h3>请求日志:</h3>
  <div class="log" id="log"></div>
  <script>
    setInterval(() => {
      fetch('/api/info').then(r => r.json()).then(d => {
        document.getElementById('log').innerHTML = d.logs.join('<br>');
      });
    }, 3000);
  </script>
</body>
</html>
`;

// ========== Queen模式 HTML ==========
const adminHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🐝 Swarm Queen</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: linear-gradient(135deg, #1a1a2e, #16213e); min-height: 100vh; padding: 20px; color: #fff; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 30px; color: #00d4ff; }
    .card { background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .status-bar { display: flex; justify-content: space-between; padding: 10px; background: rgba(0,255,0,0.1); border-radius: 8px; margin-bottom: 20px; }
    input, textarea { width: 100%; padding: 10px; border: 1px solid #333; border-radius: 6px; background: #0a0a1a; color: #fff; margin-bottom: 10px; }
    button { padding: 10px 20px; border: none; border-radius: 6px; background: #00d4ff; color: #fff; cursor: pointer; margin: 5px; }
    button.secondary { background: #444; }
    .node-item { display: flex; justify-content: space-between; padding: 10px; background: rgba(0,0,0,0.3); margin-bottom: 8px; border-radius: 6px; }
    .result { margin-top: 10px; padding: 10px; background: #0a0a1a; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐝 Swarm Queen 管理中心</h1>
    <div class="status-bar">
      <span>状态: 运行中</span>
      <span>节点数: <span id="nodeCount">0</span></span>
      <span>本机IP: ${localIP}</span>
    </div>
    <div class="card">
      <h3>添加节点URL</h3>
      <input type="text" id="newUrl" placeholder="https://xxx.clawcloudrun.com">
      <button onclick="addNode()">➕ 添加</button>
      <button class="secondary" onclick="testAll()">🧪 测试</button>
    </div>
    <div class="card">
      <h3>节点列表</h3>
      <div id="nodeList"></div>
    </div>
    <div class="card">
      <h3>导出/导入</h3>
      <button onclick="exportNodes()">📤 导出</button>
      <button onclick="importNodes()">📥 导入</button>
      <textarea id="importExport" placeholder="加密内容..."></textarea>
    </div>
    <div class="card">
      <h3>测试代理</h3>
      <button onclick="testProxy()">🧪 发送测试请求</button>
      <div class="result" id="proxyResult"></div>
    </div>
  </div>
  <script>
    let nodeList = [];
    function update() {
      fetch('/api/nodes').then(r => r.json()).then(d => {
        nodeList = d.nodes;
        document.getElementById('nodeCount').textContent = nodeList.length;
        document.getElementById('nodeList').innerHTML = nodeList.map((n, i) => 
          '<div class="node-item"><span>' + n.url + '</span><span>' + (n.status || '未测试') + '</span><button onclick="deleteNode(' + i + ')">删除</button></div>'
        ).join('') || '暂无节点';
      });
    }
    function addNode() {
      fetch('/api/nodes', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: document.getElementById('newUrl').value})})
        .then(r => r.json()).then(d => { update(); document.getElementById('newUrl').value = ''; });
    }
    function deleteNode(i) { fetch('/api/nodes/' + i, {method: 'DELETE'}).then(r => r.json()).then(d => update()); }
    function testAll() { fetch('/api/nodes/test', {method: 'POST'}).then(r => r.json()).then(d => update()); }
    function testProxy() {
      document.getElementById('proxyResult').textContent = '测试中...';
      fetch('/api/proxy/test', {method: 'POST'}).then(r => r.json()).then(d => 
        document.getElementById('proxyResult').textContent = JSON.stringify(d, null, 2));
    }
    function exportNodes() { fetch('/api/nodes/export', {method: 'POST'}).then(r => r.json()).then(d => document.getElementById('importExport').value = d.encrypted); }
    function importNodes() { 
      fetch('/api/nodes/import', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({encrypted: document.getElementById('importExport').value})})
        .then(r => r.json()).then(d => update()); 
    }
    update();
  </script>
</body>
</html>
`;

// Worker请求日志
let requestLogs = [];

// ========== 路由处理 ==========
function route(req, res) {
  const pathname = url.parse(req.url).pathname;
  const method = req.method;
  
  // 根路径 - 根据角色返回不同页面
  if (pathname === '/' || pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(ROLE === 'worker' ? workerHTML : adminHTML);
  }
  
  // API: 获取信息
  if (pathname === '/api/info') {
    return res.end(JSON.stringify({
      role: ROLE,
      ip: localIP,
      nodes: nodes.length,
      current: nodes[currentIndex]?.url || '-',
      logs: ROLE === 'worker' ? requestLogs.slice(-10) : [],
      timestamp: new Date().toISOString()
    }));
  }
  
  // ===== Queen 专属API =====
  if (ROLE === 'queen') {
    // 获取节点列表
    if (pathname === '/api/nodes' && method === 'GET') {
      return res.end(JSON.stringify({ nodes }));
    }
    
    // 添加节点
    if (pathname === '/api/nodes' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const { url } = JSON.parse(body);
        if (url && !nodes.find(n => n.url === url)) {
          nodes.push({ url, status: '未测试' });
        }
        res.end(JSON.stringify({ nodes }));
      });
      return;
    }
    
    // 删除节点
    if (pathname.startsWith('/api/nodes/') && method === 'DELETE') {
      const i = parseInt(pathname.split('/')[3]);
      if (!isNaN(i)) nodes.splice(i, 1);
      return res.end(JSON.stringify({ nodes }));
    }
    
    // 测试所有节点
    if (pathname === '/api/nodes/test' && method === 'POST') {
      testAllNodes().then(() => res.end(JSON.stringify({ nodes })));
      return;
    }
    
    // 导出节点
    if (pathname === '/api/nodes/export' && method === 'POST') {
      const data = JSON.stringify(nodes.map(n => n.url));
      return res.end(JSON.stringify({ encrypted: encrypt(data) }));
    }
    
    // 导入节点
    if (pathname === '/api/nodes/import' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const { encrypted } = JSON.parse(body);
        const urls = decrypt(encrypted);
        nodes = urls.map(u => ({ url: u, status: '未测试' }));
        res.end(JSON.stringify({ nodes }));
      });
      return;
    }
    
    // 代理测试
    if (pathname === '/api/proxy/test' && method === 'POST') {
      if (nodes.length === 0) {
        return res.end(JSON.stringify({ error: 'No nodes available' }));
      }
      
      const target = nodes[currentIndex % nodes.length];
      currentIndex++;
      
      httpRequest(target.url + '/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hi' }]
        })
      })
      .then(result => {
        res.end(JSON.stringify({
          success: result.statusCode === 200,
          node: target.url,
          statusCode: result.statusCode,
          response: result.body.substring(0, 200)
        }));
      })
      .catch(err => {
        res.end(JSON.stringify({ success: false, error: err.message, node: target.url }));
      });
      return;
    }
    
    // 代理转发 (OpenAI API兼容)
    if (method === 'POST' && pathname.startsWith('/v1/')) {
      if (nodes.length === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No nodes available' }));
      }
      
      const target = nodes[currentIndex % nodes.length];
      currentIndex++;
      
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        httpRequest(target.url + pathname, { body, headers: req.headers })
          .then(result => {
            res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
            res.end(result.body);
          })
          .catch(err => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          });
      });
      return;
    }
  }
  
  // ===== Worker 专属API =====
  if (ROLE === 'worker') {
    // 聊天接口
    if (pathname === '/api/chat' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const { messages } = JSON.parse(body);
        const log = `[${new Date().toISOString()}] 收到请求`;
        requestLogs.push(log);
        
        try {
          const result = await callOpenAI('public', 'openai/gpt-5-nano', messages);
          requestLogs.push(`[${new Date().toISOString()}] 响应成功`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(result.body);
        } catch (e) {
          requestLogs.push(`[${new Date().toISOString()}] 错误: ${e.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }
  
  res.writeHead(404);
  res.end('Not Found');
}

// 测试所有节点
async function testAllNodes() {
  for (const node of nodes) {
    try {
      await httpRequest(node.url + '/api/info', { method: 'GET' });
      node.status = '✅ 在线';
    } catch {
      node.status = '❌ 离线';
    }
  }
}

// 启动服务器
const server = http.createServer(route);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐝 Swarm ${ROLE === 'worker' ? 'Worker' : 'Queen'} 运行中`);
  console.log(`📍 本机IP: ${localIP}`);
  console.log(`🌐 端口: ${PORT}`);
  console.log(`⚙️ 角色: ${ROLE}`);
});
