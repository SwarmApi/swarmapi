# Claws Workspace Git Structure

## 目录结构与 Git 配置

### 1. `d:/code/claws/` - 本地开发工作目录
- **类型**: Git repo（仅本地，无 remote）
- **作用**: 整个项目的开发工作区
- **特点**: 
  - 不推送到任何远程地址
  - 用于本地版本控制和快照
  - 包含 swarm-queen、swarm-worker、swarmapi 等子目录

### 2. `d:/code/claws/swarm-worker/` - 源码开发目录
- **类型**: 普通文件夹（NOT git repo）
- **作用**: Node.js 源码和打包脚本
- **包含文件**:
  - `src/index.js` - 主程序，代理核心代码及热更新逻辑
  - `package.json` - npm 配置（仅 commonjs，node18-linux-x64）
  - `build.sh` - 打包脚本

### 3. `d:/code/claws/swarmapi/` - 运行包发布目录
- **类型**: Git repo，指向 GitHub
- **Remote**: `https://github.com/SwarmApi/swarmapi.git`
- **Branch**: `master`
- **作用**: 发布 worker 二进制和版本元数据
- **包含文件**:
  - `worker` - pkg 二进制文件（42MB）
  - `versions.json` - 版本信息
  - `worker-start.sh` - 启动脚本
  - `Dockerfile` - 生产镜像定义（node:20-slim，基于 Debian）

---

## 标准工作流程

### 开发阶段
```bash
cd d:/code/claws/swarm-worker
# 修改 src/*.js、package.json 等
# 本地测试：node src/index.js 
```

### 打包与发布
```bash
# 1. 在源码目录打包
cd d:/code/claws/swarm-worker
npm run build  # 输出 worker 二进制

# 2. 复制到运行包目录
# worker 已直接打包到 swarmapi/

# （可选）更新版本
# 编辑 ../swarmapi/versions.json

# 3. 推送到 GitHub（ONLY 在 swarmapi 目录）
cd ../swarmapi
git add .
git commit -m "update worker to vX.X.X"
git push origin master

# 4. 构建 Docker 镜像（在 swarmapi 目录，因为 Dockerfile 在那里）
cd ../swarmapi
docker build -t swarmapi/swarm-worker:latest .

# 5. 推送 Docker 镜像
docker push swarmapi/swarm-worker:latest
```

---

## GitHub 远程地址

- **SwarmApi/swarmapi**
  - API: `https://api.github.com/repos/SwarmApi/swarmapi/contents`
  - 根目录文件: `.gitignore`, `versions.json`, `worker`
  - 通过容器  worker 自动检查更新

---

## 代理与镜像配置

### npm/pkg：使用淘宝国内源（推荐 ✨）

不需要代理，直接使用国内淘宝源更快：

```bash
# 临时使用淘宝源（推荐）
npm install --registry https://registry.npmmirror.com
npm run build --registry https://registry.npmmirror.com

# 或者全局配置淘宝源（永久）
npm config set registry https://registry.npmmirror.com
# 恢复官方源
npm config set registry https://registry.npmjs.org/
```

**注意**: 如果 `pkg` 打包时卡住（下载 Node.js runtime），需要设置代理：
```bash
set HTTP_PROXY=http://127.0.0.1:10808
set HTTPS_PROXY=http://127.0.0.1:10808
npm run build --registry https://registry.npmmirror.com
```

### GitHub / Docker Hub：必须使用代理

这两个平台没有好用的国内镜像，必须通过代理访问：

| 操作 | 方案 | 需要代理 |
|-----|------|--------|
| npm install / npm run | 淘宝源 | ❌ 否 |
| git clone/pull/push | 代理 | ✅ 是 |
| docker pull | 代理 | ✅ 是 |
| docker push | 代理 | ✅ 是 |
| docker build | 取决于基础镜像 | ℹ️ 可能 |

### 标准代理设置（仅 GitHub 和 Docker）

```bash
# Windows PowerShell - 仅在需要时设置
set HTTP_PROXY=http://127.0.0.1:10808
set HTTPS_PROXY=http://127.0.0.1:10808

# Git 操作（如果需要访问 GitHub）
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && git push origin master

# Docker 命令（如果需要访问 Docker Hub）
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && docker push swarmapi/swarm-worker:latest
```

### 常见操作的完整命令

```bash
# ✅ npm 打包 - 使用淘宝源（无需代理）
cd d:/code/claws/swarm-worker
npm install --registry https://registry.npmmirror.com
npm run build --registry https://registry.npmmirror.com

# ✅ Docker 构建 - pkg从淘宝源下载，基础镜像从Docker pull（需要代理）
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && docker build --network host -t swarmapi/swarm-worker:latest .

# ✅ Docker 推送 - 需要代理
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && docker push swarmapi/swarm-worker:latest

# ✅ Git 推送 - 需要代理
cd ../swarmapi
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && git push origin master
```

### 何时无需任何配置

- **本地 Node.js 执行**：`node src/index.js`（源码直接运行）
- **Docker 容器运行（跳过自动更新）**：`docker run -e UPDATE_MODE=none ...`
- **本地文件操作**：`cp`, 编辑文件等

> **注意**：云容器通常可以直接访问外网，无需代理。本地测试时可设置 `UPDATE_MODE=none` 跳过自动更新。

---

## 重要提示

1. **只在 swarmapi/ 做 git push**
   - 其他目录的修改通过本地 cp 同步

2. **swarm-worker 不是 git repo**
   - 避免不小心推送源码

3. **claws 本身没有 remote**
   - 仅用于本地工作区管理

4. **Docker 构建包含完整的 worker 二进制**
   - build后输出在swarmapi目录下。

5. **npm 使用淘宝源，GitHub/Docker 使用代理**
   - npm install/build 优先用淘宝源：`--registry https://registry.npmmirror.com`
   - git push/pull、docker push/pull 需要代理 `127.0.0.1:10808`
   - Docker build 拉基础镜像也需要代理

---

## 完整更新流程（从头到尾）

```bash
# ========== 开发阶段 ==========
cd d:/code/claws/swarm-worker

# 编辑代码和版本号
# 文件: src/index.js, package.json (Dockerfile 在 swarmapi 目录)

# 本地测试（无需代理）
node src/index.js
timeout 5 node src/index.js  # 5秒后自动退出

# ========== 打包阶段（使用淘宝源，无需代理） ==========
npm install --registry https://registry.npmmirror.com
npm run build --registry https://registry.npmmirror.com

# ========== 发布阶段（swarmapi目录） ==========
cd ../swarmapi

# 复制最新的 worker-start.sh（如有更新）
# worker 已通过 npm run build 直接输出到 ../swarmapi/worker
# 编辑 versions.json 更新版本号

# 提交到 GitHub（需要代理）
git add .
git commit -m "update worker to vX.X.X"
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && git push origin master

# ========== Docker 构建（需要代理拉取基础镜像，在 swarmapi 目录） ==========
cd ../swarmapi
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && docker build --network host -t swarmapi/swarm-worker:latest .

# ========== Docker 推送（需要代理） ==========
set HTTP_PROXY=http://127.0.0.1:10808 && set HTTPS_PROXY=http://127.0.0.1:10808 && docker push swarmapi/swarm-worker:latest

# ========== 本地测试（设置 UPDATE_MODE=none 跳过自动更新） ==========
docker run -d --name test-worker -p 44444:44444 -e UPDATE_MODE=none swarmapi/swarm-worker:latest
docker logs test-worker --tail 50
powershell -Command "(Invoke-WebRequest -UseBasicParsing -Uri http://localhost:44444).StatusCode"
```

---

## 快速参考

| 步骤 | 目录 | 命令 | 代理 |
|-----|-----|------|------|
| 编辑代码 | swarm-worker | `code src/` | - |
| 本地测试 | swarm-worker | `node src/index.js` | ❌ |
| 打包二进制 | swarm-worker | `npm run build --registry https://registry.npmmirror.com` | ❌ |
| 复制文件 | swarmapi | `# 已自动（npm run build 输出到 swarmapi/worker）` | ❌ |
| Git 推送 | swarmapi | `git push origin master` | ✅ |
| Docker 构建 | swarmapi | `docker build` | ✅（拉基础镜像） |
| Docker 推送 | - | `docker push` | ✅ |
| Docker 运行 | - | `docker run -e UPDATE_MODE=none` | ❌ (本地测试) |

