const https = require('https');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const UPDATE_URL = process.env.UPDATE_URL || 'https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json';
const WORKER_PATH = process.env.WORKER_PATH || path.join(__dirname, '..', 'worker');
const WORKER_BASE = 'https://raw.githubusercontent.com/SwarmApi/swarmapi/master';

let currentVersion = process.env.WORKER_VERSION || '0.0.0';
let isUpdating = false;
let checkInterval = null;

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
      console.log('检查更新失败: 返回内容不是JSON:', trimmed.substring(0, 100));
      return null;
    }
    return JSON.parse(trimmed);
  } catch (e) {
    console.log('检查更新失败:', e.message);
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

async function checkUpdate() {
  if (isUpdating) return;

  const meta = await fetchVersions();
  if (!meta) return;

  if (meta.version && meta.version !== currentVersion) {
    console.log(`🔄 发现新版本: ${currentVersion} → ${meta.version}`);
    await forceUpdate();
  } else {
    console.log(`✅ 当前已是最新版本: ${currentVersion}`);
  }
}

async function forceUpdate() {
  if (isUpdating) return 'Already updating';
  isUpdating = true;

  try {
    const meta = await fetchVersions();
    if (!meta) throw new Error('无法获取版本信息');

    if (!meta.url && !meta.version) {
      throw new Error('版本元信息缺少 url 或 version 字段');
    }

    const workerUrl = meta.url || 'worker';
    console.log(`⬇️ 正在下载新版本: ${meta.version} (${workerUrl})`);
    await downloadWorker(workerUrl);

    currentVersion = meta.version || currentVersion;
    process.env.WORKER_VERSION = currentVersion;

    console.log(`🔄 正在重启...`);

    setTimeout(() => {
      const workerBin = process.env.WORKER_PATH || process.execPath;
      spawn(workerBin, [], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, WORKER_VERSION: currentVersion }
      }).unref();
      process.exit(0);
    }, 1000);

    return `更新到 ${currentVersion} 成功，重启中...`;
  } catch (e) {
    console.log('更新失败:', e.message);
    return e.message;
  } finally {
    isUpdating = false;
  }
}

function startUpdater() {
  console.log('🌡️ 热更新服务已启动');
  checkUpdate();

  checkInterval = setInterval(() => {
    checkUpdate();
  }, 24 * 60 * 60 * 1000);
}

function stopUpdater() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

module.exports = { checkUpdate, forceUpdate, startUpdater, stopUpdater };
