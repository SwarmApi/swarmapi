import https from 'https';
import http from 'http';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPDATE_URL = process.env.UPDATE_URL || 'https://raw.githubusercontent.com/SwarmApi/swarmapi/main/versions.json';
const WORKER_PATH = process.env.WORKER_PATH || path.join(__dirname, '..', 'worker');

let currentVersion = process.env.WORKER_VERSION || '0.0.0';
let isUpdating = false;

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
          console.log('获取版本信息失败: HTTP ' + res.statusCode);
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        resolve(data);
      });
    }).on('error', reject);
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
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(WORKER_PATH);
    
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(WORKER_PATH);
        return reject(new Error(`Download failed: ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.chmodSync(WORKER_PATH, 0o755);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(WORKER_PATH)) fs.unlinkSync(WORKER_PATH);
      reject(err);
    });
  });
}

async function checkUpdate() {
  if (isUpdating) return;
  
  const meta = await fetchVersions();
  if (!meta) return;
  
  if (meta.version !== currentVersion) {
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
    
    console.log(`⬇️ 正在下载新版本: ${meta.version}`);
    await downloadWorker(meta.url);
    
    currentVersion = meta.version;
    process.env.WORKER_VERSION = meta.version;
    
    console.log(`🔄 正在重启...`);
    
    setTimeout(() => {
      spawn(process.execPath, [__dirname + '/index.js'], {
        detached: true,
        stdio: 'ignore'
      }).unref();
      
      process.exit(0);
    }, 1000);
    
    return `更新到 ${meta.version} 成功，重启中...`;
  } catch (e) {
    console.log('更新失败:', e.message);
    return e.message;
  } finally {
    isUpdating = false;
  }
}

let checkInterval = null;

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

export { checkUpdate, forceUpdate, startUpdater, stopUpdater };
