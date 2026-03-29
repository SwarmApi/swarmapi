const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 44444;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ========== 工具函数 ==========
function md5Hash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function encrypt(text, key) {
  const algorithm = 'aes-256-cbc';
  const keyHash = crypto.scryptSync(key, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, keyHash, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText, key) {
  try {
    const algorithm = 'aes-256-cbc';
    const keyHash = crypto.scryptSync(key, 'salt', 32);
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv(algorithm, keyHash, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// ========== 数据管理 ==========
let nodes = loadNodes();
let accounts = loadAccounts();
let requestLogs = [];
let sessions = {}; // 内存会话: { sessionId: { createdAt } }

function loadNodes() {
  const file = path.join(DATA_DIR, 'workers.json');
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  } catch {
    return [];
  }
}

function saveNodes() {
  fs.writeFileSync(path.join(DATA_DIR, 'workers.json'), JSON.stringify(nodes, null, 2));
}

function loadAccounts() {
  const file = path.join(DATA_DIR, 'accounts.json');
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  } catch {
    return [];
  }
}

function saveAccounts() {
  fs.writeFileSync(path.join(DATA_DIR, 'accounts.json'), JSON.stringify(accounts, null, 2));
}

function loadAdmin() {
  const file = path.join(DATA_DIR, 'admin.json');
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

function saveAdmin(adminData) {
  fs.writeFileSync(path.join(DATA_DIR, 'admin.json'), JSON.stringify(adminData, null, 2));
}

function verifySession(sessionId) {
  if (!sessionId || !sessions[sessionId]) return false;
  const session = sessions[sessionId];
  // 会话有效期1小时
  if (Date.now() - session.createdAt > 60 * 60 * 1000) {
    delete sessions[sessionId];
    return false;
  }
  return true;
}

// ========== HTTP请求 ==========
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
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data, time: options.startTime });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Timeout')));
    
    if (options.body) req.write(options.body);
    req.end();
  });
}

const localIP = (() => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
})();

// ========== 节点权重选择 ==========
function selectNode() {
  const activeNodes = nodes.filter(n => n.weight > 0);
  if (activeNodes.length === 0) return null;
  
  const totalWeight = activeNodes.reduce((sum, n) => sum + n.weight, 0);
  let rand = Math.random() * totalWeight;
  
  for (const node of activeNodes) {
    rand -= node.weight;
    if (rand <= 0) return node;
  }
  return activeNodes[0];
}

function updateNodeStats(nodeUrl, success, responseTime) {
  const node = nodes.find(n => n.url === nodeUrl);
  if (!node) return;
  
  node.totalRequests = (node.totalRequests || 0) + 1;
  node.totalTime = (node.totalTime || 0) + responseTime;
  
  if (success) {
    node.successRequests = (node.successRequests || 0) + 1;
    node.failCount = 0;
  } else {
    node.failCount = (node.failCount || 0) + 1;
    if (node.failCount >= 3) {
      node.weight = 0;
    }
  }
  
  if (node.totalRequests >= 10) {
    const successRate = node.successRequests / node.totalRequests;
    const avgTime = node.totalTime / node.totalRequests;
    const normalizedTime = Math.max(1, 10 - avgTime / 1000);
    node.weight = Math.round(successRate * normalizedTime * 10);
    node.weight = Math.max(1, Math.min(100, node.weight));
  }
  
  saveNodes();
}

// ========== HTML模板（省略详细CSS，后续补充） ==========
const loginHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🐝 Swarm Queen - 登录</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-container { width: 100%; max-width: 400px; padding: 20px; }
    .login-card { background: rgba(255,255,255,0.1); border-radius: 12px; padding: 40px; }
    h1 { text-align: center; color: #00d4ff; margin-bottom: 30px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; color: #ccc; }
    input { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 6px; background: #0a0a1a; color: #fff; }
    button { width: 100%; padding: 12px; border: none; border-radius: 6px; background: #00d4ff; color: #000; font-weight: bold; cursor: pointer; }
    .error { color: #ff4444; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <h1>🐝 Swarm Queen</h1>
      <form id="loginForm">
        <div class="form-group">
          <label>管理员密码</label>
          <input type="password" id="password" required>
        </div>
        <button type="submit">登录</button>
        <div id="error" class="error"></div>
      </form>
    </div>
  </div>
  
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('sessionId', data.sessionId);
        window.location.href = '/admin';
      } else {
        document.getElementById('error').textContent = data.error || '登录失败';
      }
    });
  </script>
</body>
</html>`;

const adminHTML = (nodes, accounts) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>🐝 Swarm Queen</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; padding: 20px; color: #fff; }
    .container { max-width: 1200px; margin: 0 auto; }
    .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
    h1 { color: #00d4ff; }
    .logout-btn { padding: 10px 20px; background: #ff4444; border: none; border-radius: 6px; color: #fff; cursor: pointer; }
    .status-bar { display: flex; justify-content: space-between; padding: 15px; background: rgba(0,255,0,0.1); border-radius: 8px; margin-bottom: 20px; }
    .card { background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .tab-buttons { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .tab-btn { padding: 10px 20px; background: #333; border: none; border-radius: 6px; color: #fff; cursor: pointer; }
    .tab-btn.active { background: #00d4ff; color: #000; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    input, select { padding: 10px; border: 1px solid #333; border-radius: 6px; background: #0a0a1a; color: #fff; width: 100%; margin-bottom: 10px; }
    button { padding: 10px 20px; border: none; border-radius: 6px; background: #00d4ff; color: #000; cursor: pointer; margin: 5px 0; }
    button.secondary { background: #444; color: #fff; }
    button.danger { background: #ff4444; color: #fff; }
    .item { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(0,0,0,0.3); margin-bottom: 8px; border-radius: 6px; }
    .result { margin-top: 10px; padding: 10px; background: #0a0a1a; border-radius: 6px; font-size: 12px; white-space: pre-wrap; max-height: 300px; overflow: auto; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <h1>🐝 Swarm Queen</h1>
      <button class="logout-btn" onclick="logout()">登出</button>
    </div>
    
    <div class="status-bar">
      <span>Workers: <span id="nodeCount">${nodes.length}</span></span>
      <span>账户: <span id="accountCount">${accounts.length}</span></span>
      <span>IP: ${localIP}</span>
    </div>
    
    <div class="tab-buttons">
      <button class="tab-btn active" onclick="showTab('workers')">Workers</button>
      <button class="tab-btn" onclick="showTab('accounts')">GitHub账户</button>
      <button class="tab-btn" onclick="showTab('logs')">日志</button>
      <button class="tab-btn" onclick="showTab('admin')">设置</button>
    </div>
    
    <div id="tab-workers" class="tab-content active">
      <div class="card">
        <h3>添加Worker</h3>
        <input type="text" id="newUrl" placeholder="https://xxx.clawcloudrun.com">
        <input type="text" id="containerRegion" placeholder="大区 (e.g., ap-southeast-1)">
        <input type="text" id="containerLocation" placeholder="位置 (e.g., Singapore)">
        <select id="accountSelect"><option value="">选择账户</option>${accounts.map(a => '<option value="' + a.id + '">' + (a.label || a.username) + '</option>').join('')}</select>
        <button onclick="addNode()">➕ 添加</button>
        <button class="secondary" onclick="testAll()">🧪 测试</button>
      </div>
      <div class="card" id="nodeList"></div>
    </div>
    
    <div id="tab-accounts" class="tab-content">
      <div class="card">
        <button class="secondary" onclick="toggleAddForm()" style="margin-bottom:15px">➕ 添加GitHub账户</button>
        <div id="addFormContainer" style="display:none; padding:15px; background:rgba(0,0,0,0.2); border-radius:8px; margin-bottom:15px">
          <h4 style="color:#00d4ff; margin-bottom:10px">新增账户</h4>
          <input type="text" id="ghUsername" placeholder="GitHub用户名">
          <input type="text" id="ghEmail" placeholder="邮箱（登录用）">
          <input type="text" id="ghPassword" placeholder="GitHub密码">
          <input type="text" id="ghProxyRegion" placeholder="代理地区 (e.g., Japan, Germany, US)">
          <label for="ghCopilotDate" style="display:block; margin-bottom:5px; color:#ccc">Copilot额度恢复日期</label>
          <input type="date" id="ghCopilotDate" style="margin-bottom:10px">
          <input type="text" id="ghLabel" placeholder="账户标签/描述（可选）">
          <button onclick="saveAccount()" style="margin-right:10px">✅ 保存</button>
          <button class="secondary" onclick="toggleAddForm()">❌ 取消</button>
        </div>
      </div>
      <div class="card" id="accountList"></div>
    </div>
    
    <div id="tab-logs" class="tab-content">
      <div class="card">
        <button class="secondary" onclick="refreshLogs()">🔄 刷新</button>
        <div class="result" id="logList"></div>
      </div>
    </div>
    
    <div id="tab-admin" class="tab-content">
      <div class="card">
        <h3>修改管理员密码</h3>
        <input type="password" id="oldPassword" placeholder="当前密码">
        <input type="password" id="newPassword" placeholder="新密码">
        <input type="password" id="confirmPassword" placeholder="确认密码">
        <button onclick="changePassword()">修改</button>
        <div id="passwordResult" class="result"></div>
      </div>
    </div>
  </div>
  
  <script>
    let nodeList = ${JSON.stringify(nodes)};
    let accountList = ${JSON.stringify(accounts)};
    
    function showTab(tab) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      event.target.classList.add('active');
    }
    
    function updateNodeList() {
      document.getElementById('nodeCount').textContent = nodeList.length;
      let html = '';
      if (nodeList.length === 0) {
        html = '<p style="color:#888">暂无Workers</p>';
      } else {
        html = nodeList.map((n, i) => 
          '<div class="item"><div style="flex:1"><div style="color:#0f0">' + n.url + '</div><div style="color:#888;font-size:12px">' + (n.containerRegion || '-') + ' / ' + (n.containerLocation || '-') + '</div></div><div style="text-align:right"><button class="small danger" onclick="deleteNode(' + i + ')">删除</button></div></div>'
        ).join('');
      }
      document.getElementById('nodeList').innerHTML = '<h3>Worker列表</h3>' + html;
    }
     
    function toggleAddForm() {
      const form = document.getElementById('addFormContainer');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }
    
    function updateAccountList() {
      document.getElementById('accountCount').textContent = accountList.length;
      
      // 按Copilot恢复日期排序（升序，近期恢复的排在前），保留原始索引
      const sorted = accountList.map((a, i) => ({...a, _origIdx: i})).sort((a, b) => {
        const dateA = new Date(a.copilotResetDate || '9999-12-31');
        const dateB = new Date(b.copilotResetDate || '9999-12-31');
        return dateA - dateB;
      });
      
      // 统计数据
      const stats = {
        regions: {},
        copilotStatus: { available: 0, expired: 0 }
      };
      
      sorted.forEach(a => {
        // 地区统计
        const region = a.proxyRegion || '未设置';
        stats.regions[region] = (stats.regions[region] || 0) + 1;
        
        // Copilot状态统计：恢复日期 <= 今天 = 可用
        if (!a.copilotResetDate) {
          stats.copilotStatus.expired++;
        } else {
          const now = new Date();
          const resetDate = new Date(a.copilotResetDate);
          if (resetDate <= now) {
            stats.copilotStatus.available++;
          } else {
            stats.copilotStatus.expired++;
          }
        }
      });
      
      let html = '';
      if (sorted.length === 0) {
        html = '<p style="color:#888">暂无账户</p>';
      } else {
        // 统计和筛选按钮
        let filterHtml = '<div style="margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap">';
        Object.entries(stats.regions).forEach(([region, count]) => {
          filterHtml += '<button class="small secondary" style="padding:4px 10px; font-size:11px">' + region + ' ' + count + '</button>';
        });
        filterHtml += '<button class="small secondary" style="padding:4px 10px; font-size:11px; color:#00ff00">✅ 可用 ' + stats.copilotStatus.available + '</button>';
        filterHtml += '<button class="small secondary" style="padding:4px 10px; font-size:11px; color:#ff4444">❌ 已用 ' + stats.copilotStatus.expired + '</button>';
        filterHtml += '</div>';
        html += filterHtml;
        
        // 表头
        html += '<div style="display:grid; grid-template-columns:1.5fr 1.5fr 1fr 1fr 1.2fr 0.8fr 1fr 1.5fr; gap:8px; padding:10px; background:rgba(0,255,0,0.1); border-radius:6px; margin-bottom:8px; font-weight:bold; font-size:12px; align-items:center"><div>账户</div><div>邮箱</div><div>密码</div><div>地区</div><div>Copilot恢复</div><div>状态</div><div>标签</div><div>操作</div></div>';
        
        // 账户行（每行一条记录）
html += sorted.map((a) => {
  const origIdx = a._origIdx;
  const pwd = a.passwordRaw || '****';
  const now = new Date();
  const resetDate = a.copilotResetDate ? new Date(a.copilotResetDate) : null;
  
  // Copilot状态：恢复日期 <= 今天 = 可用
  let copilotStatus = '-';
  let copilotColor = '#888';
  if (!a.copilotResetDate) {
    copilotStatus = '-';
    copilotColor = '#888';
  } else if (resetDate <= now) {
    copilotStatus = '✅ 可用';
    copilotColor = '#00ff00';
  } else {
    copilotStatus = '❌ 已用';
    copilotColor = '#ff4444';
  }
  
  return '<div style="display:grid; grid-template-columns:1.5fr 1.5fr 1fr 1fr 1.2fr 0.8fr 1fr 1.5fr; gap:8px; padding:10px; background:rgba(0,0,0,0.3); border-radius:4px; align-items:center; border-left:3px solid #00d4ff">' +
    '<div style="word-break:break-all; display:flex; align-items:center; gap:5px"><span style="color:#0d9">' + (a.username || '-') + '</span></div>' +
    '<div style="word-break:break-all; display:flex; align-items:center; gap:5px"><span style="color:#0d9">' + (a.email || '-') + '</span><button class="small" style="padding:2px 4px; font-size:10px" onclick="copyEmail(' + origIdx + ')" title="复制邮箱">📋</button></div>' +
    '<div style="display:flex; align-items:center; gap:4px"><span id="pwd' + origIdx + '" style="font-family:monospace; color:#00ff00; font-size:11px">***</span><button class="small" style="padding:2px 4px; font-size:10px" onclick="togglePassword(' + origIdx + ')">👁️</button><button class="small" style="padding:2px 4px; font-size:10px" onclick="copyPassword(' + origIdx + ')">📋</button></div>' +
    '<div style="font-size:12px; color:#888">' + (a.proxyRegion || '-') + '</div>' +
    '<div style="font-size:12px">' + (a.copilotResetDate || '-') + '</div>' +
    '<div style="font-size:11px; color:' + copilotColor + '">' + copilotStatus + '</div>' +
    '<div style="font-size:12px">' + (a.label || '-') + '</div>' +
    '<div style="display:flex; gap:4px"><button class="small secondary" style="padding:2px 6px; font-size:10px" onclick="editAccount(' + origIdx + ')">✏️</button><button class="small danger" style="padding:2px 6px; font-size:10px" onclick="deleteAccount(' + origIdx + ')">🗑️</button></div>' +
    '</div>';
}).join('');
      }
      document.getElementById('accountList').innerHTML = '<h3>账户列表</h3>' + html;
    }
    
    function togglePassword(i) {
      const el = document.getElementById('pwd' + i);
      const a = accountList[i];
      const pwd = a.passwordRaw || '****';
      if (el.textContent === '***') {
        el.textContent = pwd;
      } else {
        el.textContent = '***';
      }
    }
    
    function copyEmail(i) {
      const a = accountList[i];
      const email = a.email || '';
      if (!email) {
        alert('邮箱为空');
        return;
      }
      navigator.clipboard.writeText(email).then(() => {
        alert('邮箱已复制');
      }).catch(() => {
        alert('邮箱: ' + email);
      });
    }
    
    function copyUsername(i) {
      const a = accountList[i];
      const username = a.username || '';
      if (!username) {
        alert('用户名为空');
        return;
      }
      navigator.clipboard.writeText(username).then(() => {
        alert('用户名已复制');
      }).catch(() => {
        alert('用户名: ' + username);
      });
    }
    
    function copyPassword(i) {
      const a = accountList[i];
      const pwd = a.passwordRaw || '';
      if (!pwd) {
        alert('密码不可用');
        return;
      }
      navigator.clipboard.writeText(pwd).then(() => {
        alert('密码已复制到剪贴板');
      }).catch(() => {
        alert('复制失败，密码为: ' + pwd);
      });
    }
    
    let editingAccountIndex = null;
function editAccount(i) {
  const a = accountList[i];
  document.getElementById('addFormContainer').style.display = 'block';
  document.getElementById('ghEmail').value = a.email || '';
  document.getElementById('ghUsername').value = a.username || '';
  document.getElementById('ghLabel').value = a.label || '';
  document.getElementById('ghPassword').value = a.passwordRaw || '';
  document.getElementById('ghProxyRegion').value = a.proxyRegion || '';
  document.getElementById('ghCopilotDate').value = a.copilotResetDate || '';
  editingAccountIndex = i;
}
    
    async function addNode() {
      const url = document.getElementById('newUrl').value.trim();
      if (!url) return;
      const res = await fetch('/api/nodes', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ 
          url, 
          accountId: document.getElementById('accountSelect').value,
          containerRegion: document.getElementById('containerRegion').value,
          containerLocation: document.getElementById('containerLocation').value
        })
      });
      nodeList = (await res.json()).nodes;
      document.getElementById('newUrl').value = '';
      updateNodeList();
    }
    
    async function deleteNode(i) {
      nodeList = (await fetch('/api/nodes/' + i, { method: 'DELETE' })).json().nodes;
      updateNodeList();
    }
    
    async function testAll() {
      nodeList = (await fetch('/api/nodes/test', { method: 'POST' })).json().nodes;
      updateNodeList();
    }
    
    async function saveAccount() {
      const email = document.getElementById('ghEmail').value.trim();
      const username = document.getElementById('ghUsername').value.trim();
      const password = document.getElementById('ghPassword').value;
      const label = document.getElementById('ghLabel').value.trim();
      const proxyRegion = document.getElementById('ghProxyRegion').value;
      const copilotResetDate = document.getElementById('ghCopilotDate').value;
      
      if (!email || !username || !password) {
        alert('邮箱、用户名和密码为必填项');
        return;
      }
      
      if (editingAccountIndex !== null) {
        // 编辑模式
        const res = await fetch('/api/accounts/' + editingAccountIndex + '/edit', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            email,
            username,
            password,
            label,
            proxyRegion,
            copilotResetDate
          })
        });
        accountList = (await res.json()).accounts;
      } else {
        // 新增模式
        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            email,
            username,
            password,
            label,
            proxyRegion,
            copilotResetDate
          })
        });
        const data = await res.json();
        if (data.error) {
          alert('添加失败: ' + data.error);
          return;
        }
        accountList = data.accounts;
      }
      
      // 清空表单
      document.getElementById('ghEmail').value = '';
      document.getElementById('ghUsername').value = '';
      document.getElementById('ghPassword').value = '';
      document.getElementById('ghLabel').value = '';
      document.getElementById('ghProxyRegion').value = '';
      document.getElementById('ghCopilotDate').value = '';
      document.getElementById('addFormContainer').style.display = 'none';
      editingAccountIndex = null;
      updateAccountList();
    }
    
    async function addAccount_legacy() {
      const email = document.getElementById('ghEmail').value.trim();
      const username = document.getElementById('ghUsername').value.trim();
      const password = document.getElementById('ghPassword').value;
      const label = document.getElementById('ghLabel').value.trim();
      
      if (!email || !username || !password) {
        alert('邮箱、用户名和密码为必填项');
        return;
      }
      
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email,
          username,
          password,
          label: label || username,
          proxyRegion: document.getElementById('ghProxyRegion').value,
          copilotResetDate: document.getElementById('ghCopilotDate').value
        })
      });
      
      const data = await res.json();
      if (data.error) {
        alert('添加失败: ' + data.error);
        return;
      }
      
      accountList = data.accounts;
      // 清空表单
      document.getElementById('ghEmail').value = '';
      document.getElementById('ghUsername').value = '';
      document.getElementById('ghPassword').value = '';
      document.getElementById('ghLabel').value = '';
      document.getElementById('ghProxyRegion').value = '';
      document.getElementById('ghCopilotDate').value = '';
      // 关闭表单
      document.getElementById('addFormContainer').style.display = 'none';
      updateAccountList();
    }
    
    async function deleteAccount(i) {
      if (!confirm('确定删除此账户?')) return;
      const res = await fetch('/api/accounts/' + i, { method: 'DELETE' });
      accountList = (await res.json()).accounts;
      updateAccountList();
    }
    
    async function refreshLogs() {
      const data = await (await fetch('/api/logs')).json();
      document.getElementById('logList').innerHTML = data.logs.map(l => '<div style="padding:5px; border-bottom:1px solid #333"><span style="color:#888">' + l.time + '</span> ' + l.msg + '</div>').join('');
    }
    
    async function changePassword() {
      const old = document.getElementById('oldPassword').value;
      const n = document.getElementById('newPassword').value;
      const c = document.getElementById('confirmPassword').value;
      if (!old || !n || !c) return;
      if (n !== c) {
        alert('密码不一致');
        return;
      }
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ oldPassword: old, newPassword: n })
      });
      const data = await res.json();
      document.getElementById('passwordResult').textContent = data.message || data.error;
    }
    
    function logout() {
      fetch('/api/admin/logout', { method: 'POST' });
      localStorage.removeItem('sessionId');
      window.location.href = '/';
    }
    
    updateNodeList();
    updateAccountList();
    refreshLogs();
  </script>
</body>
</html>`;

// ========== 路由处理 ==========
function route(req, res) {
  const pathname = url.parse(req.url).pathname;
  const method = req.method;
  
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, cookie) => {
    const [k, v] = cookie.trim().split('=');
    acc[k] = v;
    return acc;
  }, {});
  const sessionId = cookies.sessionId || '';
  
  if (pathname === '/' || pathname === '/login') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(loginHTML);
  }
  
  if (pathname === '/admin') {
    if (!verifySession(sessionId)) {
      res.writeHead(302, { 'Location': '/' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(adminHTML(nodes, accounts));
  }
  
  // 登录API
  if (pathname === '/api/admin/login' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { password } = JSON.parse(body);
      const adminData = loadAdmin();
      
      if (!adminData) {
        const newAdmin = { passwordHash: md5Hash(password), createdAt: new Date().toISOString() };
        saveAdmin(newAdmin);
        const sid = generateSessionId();
        sessions[sid] = { createdAt: Date.now() };
        res.writeHead(200, { 'Set-Cookie': 'sessionId=' + sid + '; Path=/' });
        return res.end(JSON.stringify({ success: true, sessionId: sid }));
      }
      
      if (md5Hash(password) === adminData.passwordHash) {
        const sid = generateSessionId();
        sessions[sid] = { createdAt: Date.now() };
        res.writeHead(200, { 'Set-Cookie': 'sessionId=' + sid + '; Path=/' });
        return res.end(JSON.stringify({ success: true, sessionId: sid }));
      }
      
      res.end(JSON.stringify({ success: false, error: '密码错误' }));
    });
    return;
  }
  
  if (pathname === '/api/admin/logout' && method === 'POST') {
    if (sessionId) delete sessions[sessionId];
    return res.end(JSON.stringify({ success: true }));
  }
  
  if (pathname === '/api/admin/password' && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { oldPassword, newPassword } = JSON.parse(body);
      const adminData = loadAdmin();
      
      if (!adminData || md5Hash(oldPassword) !== adminData.passwordHash) {
        return res.end(JSON.stringify({ error: '旧密码错误' }));
      }
      
      adminData.passwordHash = md5Hash(newPassword);
      saveAdmin(adminData);
      res.end(JSON.stringify({ message: '密码已修改' }));
    });
    return;
  }
  
  // Workers API
  if (pathname === '/api/nodes' && method === 'GET') {
    return res.end(JSON.stringify({ nodes }));
  }
  
  if (pathname === '/api/nodes' && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body);
      if (data.url && !nodes.find(n => n.url === data.url)) {
        nodes.push({
          url: data.url,
          accountId: data.accountId,
          accountLabel: data.accountLabel,
          containerRegion: data.containerRegion,
          containerLocation: data.containerLocation,
          status: '未测试',
          weight: 10,
          totalRequests: 0,
          successRequests: 0,
          totalTime: 0,
          failCount: 0
        });
        saveNodes();
      }
      res.end(JSON.stringify({ nodes }));
    });
    return;
  }
  
  if (pathname.startsWith('/api/nodes/') && method === 'DELETE') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    const i = parseInt(pathname.split('/')[3]);
    if (!isNaN(i)) {
      nodes.splice(i, 1);
      saveNodes();
    }
    return res.end(JSON.stringify({ nodes }));
  }
  
  if (pathname === '/api/nodes/test' && method === 'POST') {
    testAllNodes().then(() => res.end(JSON.stringify({ nodes })));
    return;
  }
  
  if (pathname === '/api/worker/update' && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const { url } = JSON.parse(body);
      try {
        const result = await httpRequest(url + '/api/update', { method: 'POST' });
        res.end(result.body);
      } catch (e) {
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // 账户API
  if (pathname === '/api/accounts' && method === 'GET') {
    return res.end(JSON.stringify({ accounts }));
  }
  
  if (pathname === '/api/accounts' && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { email, username, password, label, proxyRegion, copilotResetDate } = JSON.parse(body);
      
      if (!username || !password || !email) {
        return res.end(JSON.stringify({ error: '缺少必要字段' }));
      }
      
      const id = 'gh_' + Date.now();
      const keyHash = md5Hash(password);
      
      accounts.push({
        id,
        email,
        username,
        passwordHash: encrypt(password, keyHash),
        passwordRaw: password,
        label,
        proxyRegion,
        copilotResetDate,
        containerUrls: [],
        createdAt: new Date().toISOString()
      });
      saveAccounts();
      res.end(JSON.stringify({ accounts }));
    });
    return;
  }
  
  if (pathname.startsWith('/api/accounts/') && method === 'DELETE') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    const i = parseInt(pathname.split('/')[3]);
    if (!isNaN(i)) {
      accounts.splice(i, 1);
      saveAccounts();
    }
    return res.end(JSON.stringify({ accounts }));
  }
  
  // 编辑账户API (使用POST /api/accounts/:id/edit)
  if (pathname.startsWith('/api/accounts/') && pathname.endsWith('/edit') && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const pathParts = pathname.split('/');
      const i = parseInt(pathParts[3]);
      const { email, username, password, label, proxyRegion, copilotResetDate } = JSON.parse(body);
      
      if (!isNaN(i) && accounts[i]) {
        if (email !== undefined) accounts[i].email = email;
        if (username !== undefined) accounts[i].username = username;
        if (password !== undefined) {
          accounts[i].passwordRaw = password;
          accounts[i].passwordHash = encrypt(password, md5Hash(password));
        }
        if (label !== undefined) accounts[i].label = label;
        if (proxyRegion !== undefined) accounts[i].proxyRegion = proxyRegion;
        if (copilotResetDate !== undefined) accounts[i].copilotResetDate = copilotResetDate;
        saveAccounts();
      }
      return res.end(JSON.stringify({ accounts }));
    });
    return;
  }
  
  // 添加容器API
  if (pathname.startsWith('/api/accounts/') && pathname.endsWith('/containers') && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const pathParts = pathname.split('/');
      const i = parseInt(pathParts[3]);
      const { url, region, location } = JSON.parse(body);
      
      if (!isNaN(i) && accounts[i]) {
        if (!accounts[i].containerUrls) accounts[i].containerUrls = [];
        accounts[i].containerUrls.push({ url, region, location });
        saveAccounts();
      }
      return res.end(JSON.stringify({ accounts }));
    });
    return;
  }
  
  // 删除容器API (使用POST /api/accounts/:i/containers/:j/delete)
  if (pathname.startsWith('/api/accounts/') && pathname.includes('/containers/') && pathname.endsWith('/delete') && method === 'POST') {
    if (!verifySession(sessionId)) {
      return res.end(JSON.stringify({ error: '未授权' }));
    }
    
    const pathParts = pathname.split('/');
    const i = parseInt(pathParts[3]);
    const j = parseInt(pathParts[5]);
    
    if (!isNaN(i) && !isNaN(j) && accounts[i] && accounts[i].containerUrls) {
      accounts[i].containerUrls.splice(j, 1);
      saveAccounts();
    }
    return res.end(JSON.stringify({ accounts }));
  }
  
  // 日志API
  if (pathname === '/api/logs' && method === 'GET') {
    return res.end(JSON.stringify({ logs: requestLogs.slice(-100) }));
  }
  
  // 代理测试
  if (pathname === '/api/proxy/test' && method === 'POST') {
    const target = selectNode();
    if (!target) {
      return res.end(JSON.stringify({ error: 'No nodes' }));
    }
    
    const startTime = Date.now();
    httpRequest(target.url + '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
      headers: { 'Authorization': 'Bearer test' }
    })
    .then(result => {
      const time = Date.now() - startTime;
      updateNodeStats(target.url, result.statusCode === 200, time);
      requestLogs.unshift({ time: new Date().toISOString(), msg: (result.statusCode === 200?'✅':'❌') + ' ' + target.url });
      if (requestLogs.length > 100) requestLogs.pop();
      res.end(JSON.stringify({ success: true, time: time + 'ms' }));
    })
    .catch(err => {
      const time = Date.now() - startTime;
      updateNodeStats(target.url, false, time);
      requestLogs.unshift({ time: new Date().toISOString(), msg: '❌ ' + target.url });
      if (requestLogs.length > 100) requestLogs.pop();
      res.end(JSON.stringify({ success: false, error: err.message }));
    });
    return;
  }
  
  // OpenAI代理
  if (method === 'POST' && pathname.startsWith('/v1/')) {
    const target = selectNode();
    if (!target) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No nodes' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const startTime = Date.now();
      httpRequest(target.url + pathname, { body, headers: req.headers })
        .then(result => {
          const time = Date.now() - startTime;
          updateNodeStats(target.url, result.statusCode === 200, time);
          let model = '-';
          try { model = JSON.parse(body).model || '-'; } catch {}
          requestLogs.unshift({ time: new Date().toISOString(), msg: (result.statusCode === 200?'✅':'❌') + ' [' + model + ']' });
          if (requestLogs.length > 100) requestLogs.pop();
          
          res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
          res.end(result.body);
        })
        .catch(err => {
          const time = Date.now() - startTime;
          updateNodeStats(target.url, false, time);
          requestLogs.unshift({ time: new Date().toISOString(), msg: '❌ 错误' });
          if (requestLogs.length > 100) requestLogs.pop();
          
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
    });
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
}

async function testAllNodes() {
  for (const node of nodes) {
    try {
      await httpRequest(node.url + '/api/info', { method: 'GET' });
      node.status = '✅ 在线';
    } catch {
      node.status = '❌ 离线';
      node.weight = 0;
    }
  }
  saveNodes();
}

const server = http.createServer(route);

server.listen(PORT, '0.0.0.0', () => {
  console.log('🐝 Swarm Queen 运行中');
  console.log('📍 IP: ' + localIP);
  console.log('🌐 访问: http://localhost:' + PORT);
  console.log('📁 数据: ' + DATA_DIR);
});
