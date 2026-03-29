const http = require('http');
const https = require('https');

const CONFIG = {
  port: process.env.PORT || 44444,
  githubRepo: process.env.GITHUB_REPO || 'SwarmApi/swarmapi',
  githubToken: process.env.GITHUB_TOKEN || '',
  pollInterval: parseInt(process.env.POLL_INTERVAL) || 30000,
  pushInterval: parseInt(process.env.PUSH_INTERVAL) || 120000,
};

const LOCAL_NODE = {
  id: `node-${Date.now()}`,
  addr: `http://localhost:${CONFIG.port}`,
  port: CONFIG.port,
  lastSeen: new Date().toISOString()
};

let nodes = [];
let currentIndex = 0;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function syncFromGitHub() {
  try {
    const url = `https://raw.githubusercontent.com/${CONFIG.githubRepo}/main/pool.json`;
    const data = await fetchJSON(url);
    nodes = (data.nodes || []).filter(n => n.id !== LOCAL_NODE.id);
    log(`Synced ${nodes.length} nodes from GitHub`);
  } catch (e) {
    log(`Sync failed: ${e.message}`);
  }
}

async function pushToGitHub() {
  if (!CONFIG.githubToken) {
    log('No GITHUB_TOKEN, skip push');
    return;
  }
  
  try {
    const getUrl = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/pool.json`;
    const current = await fetchJSON(getUrl, {
      headers: { 'Authorization': `token ${CONFIG.githubToken}` }
    });
    
    const allNodes = [...nodes, { ...LOCAL_NODE, lastSeen: new Date().toISOString() }];
    const content = Buffer.from(JSON.stringify({ nodes: allNodes }, null, 2)).toString('base64');
    
    const putUrl = `https://api.github.com/repos/${CONFIG.githubRepo}/contents/pool.json`;
    await new Promise((resolve, reject) => {
      const req = https.request(putUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${CONFIG.githubToken}`,
          'Content-Type': 'application/json'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            log(`Pushed ${allNodes.length} nodes to GitHub`);
            resolve();
          } else {
            reject(new Error(data));
          }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        message: `Update pool: ${LOCAL_NODE.id}`,
        content: content,
        sha: current.sha
      }));
      req.end();
    });
  } catch (e) {
    log(`Push failed: ${e.message}`);
  }
}

function proxyRequest(req, res) {
  const path = req.url.split('?')[0];
  
  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      nodes: nodes.length,
      local: LOCAL_NODE.id 
    }));
    return;
  }
  
  if (path === '/peer/announce') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const newNode = JSON.parse(body);
        if (!nodes.find(n => n.id === newNode.id)) {
          nodes.push(newNode);
          log(`Peer joined: ${newNode.id}`);
        }
        res.end('ok');
      } catch (e) {
        res.statusCode = 400;
        res.end('bad request');
      }
    });
    return;
  }
  
  if (nodes.length === 0) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No available nodes' }));
    return;
  }
  
  const target = nodes[currentIndex % nodes.length];
  currentIndex++;
  log(`Forwarding to ${target.addr}`);
  
  const url = new URL(req.url, target.addr);
  const client = url.protocol === 'https:' ? https : http;
  
  const proxyReq = client.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: req.method,
    headers: {
      ...req.headers,
      'Host': url.host
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxyReq.on('error', (e) => {
    log(`Proxy error: ${e.message}`);
    res.statusCode = 502;
    res.end('Bad gateway');
  });
  
  req.pipe(proxyReq);
}

const server = http.createServer(proxyRequest);

server.listen(CONFIG.port, () => {
  log(`swarmapi proxy running on :${CONFIG.port}`);
  log(`Node ID: ${LOCAL_NODE.id}`);
  
  if (CONFIG.githubToken) {
    log('GitHub token configured, will push to pool');
    syncFromGitHub().then(pushToGitHub);
    setInterval(syncFromGitHub, CONFIG.pollInterval);
    setInterval(pushToGitHub, CONFIG.pushInterval);
  } else {
    log('No GITHUB_TOKEN, running in local mode');
  }
});

process.on('SIGTERM', () => {
  log('Shutting down...');
  server.close(() => process.exit(0));
});
