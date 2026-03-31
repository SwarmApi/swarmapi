# Claws (SwarmApi) 项目概览

> 该仓库为一个轻量级 AI 代理集群管理系统，由两个关键服务组成：`swarm-queen`（管理端）和 `swarm-worker`（执行端），以及 `swarmapi` 发行包（版本+二进制发布）。

## 1. 项目结构

- `swarm-queen/`
  - `queen.js`：管理界面与 API 网关，负责认证、节点/账号管理、负载调度、路由 OpenAI 请求与更新 Worker。
  - `data/`：运行时状态文件（`workers.json`, `accounts.json`, `config.json`, `admin.json`）。
  - `package.json`：启动脚本 `npm start`。

- `swarm-worker/`
  - `src/index.js`：Worker 服务主逻辑，包含热更新、版本拉取、OpenAI 请求转发、健康与状态；自带内置 UI。
  - `worker`：已打包的二进制（`pkg` 生成，通常产出到 `swarmapi/worker`）。
  - `build.sh`：用于通过 `pkg` 打包的脚本。`package.json` 内设置了 `npm run build`（`node18-linux-x64`）。

- `swarmapi/`
  - `versions.json`：全局版本元数据，Worker 定期读取该文件判断是否升级。
  - `worker`：发布二进制文件（供 Worker 自升级拉取）。
  - `worker-start.sh`：Worker 启动脚本 - 负责启动进程与更新逻辑（可见项目集成层使用）。
  - `Dockerfile`：构建运行镜像（通常包含 Worker）。

- `update-steps.md`：操作流程、打包与发布说明、代理与镜像配置建议（本仓库内维护的纯文本教程）。
- `rust-swarm-worker/`：当前为空目录（预留/后续 Rust 实现）。

## 2. 核心设计与功能点

### 2.1 Swarm Worker (执行端)
- 提供 HTTP 服务监听 `PORT`（默认 `44444`）。
- 主要路由
  - `GET /health|/healthz`：健康检查。
  - `GET /api/info`：状态与最近请求日志。
  - `POST /api/update`：触发 Worker 自身更新（`VERSION_URL` 出发）。
  - `POST /v1/*`：转发到 OpenAI API 端点（`opencode.ai/zen/v1/chat/completions`），默认模型 `big-pickle`。
- 自动更新机制
  - 读取环境变量 `UPDATE_URL`（默认 `https://raw.githubusercontent.com/SwarmApi/swarmapi/master/versions.json`）。
  - 比对 `meta.version`；有新版本时下载 `worker_url` 和 `worker_start_url`，保存覆盖并重启进程。
  - 支持 `UPDATE_MODE={periodic|manual|none}`。
- 状态与运行信息
  - 请求计数、心跳日志、内存/运行时间统计、请求日志追踪。
  - `/` 和 `/index.html` 提供简易监控页面。
- 内置代理转发逻辑
  - `/v1/` 请求选定或默认模型，并将所有请求转发至 `target.url + pathname`。

### 2.2 Swarm Queen (管理端)
- 提供管理 Web UI (`/login` -> `/admin`) 与 API 扩展。
- 管理功能
  - 节点（Worker）列表：url、账户、模型、状态、权重、成功率、测试/更新按钮。
  - GitHub 账号管理：账户+密码+Copilot状态+Region+标签。
  - 系统状态、日志、管理员密码修改、全量测试/更新。
  - 认证：简单 sessionId Cookie + MD5 password hash 存储（`data/admin.json`）。
- 主要 API
  - `/api/admin/login`、`/api/admin/logout`、`/api/admin/password`
  - `/api/nodes`（GET/POST/DELETE/POST :id/edit）、`/api/nodes/test`、`/api/worker/update`
  - `/api/accounts`（GET/POST/DELETE/POST :id/edit）、账户容器增删
  - `/api/models`、`/api/config`（GET/POST）
  - `/api/logs`、`/api/proxy/test`
  - 代理到 `/v1/*`：负载节点选择 + 请求转发，保持请求统计。
- 负载与健康
  - `selectNode()` 在 `nodes` 中基于 success/fail 权重选择（简化，轮询/权重方式，可扩展）。
  - 真实请求成功率与响应时间记录（`updateNodeStats`）。

### 2.3 swarmapi (发布层)
- 作为统一版本控制与自更新源：`versions.json` + `worker` + `worker-start.sh`。

## 3. 主要运行命令

### 3.1 运行 queen
```bash
cd swarm-queen
npm install
npm start
# 访问 http://localhost:44444
```

### 3.2 运行 worker（源码）
```bash
cd swarm-worker
npm install
npm start
# 默认 44444
```

### 3.3 打包 worker 二进制并发布
```bash
cd swarm-worker
npm run build
# 生成文件: ../swarmapi/worker

cd ../swarmapi
# 更新 versions.json 版本号与 worker_url/worker_start_url
# 后继 Worker 会自动检测并更新
```

### 3.4 Docker 场景
```bash
cd swarmapi
docker build -t swarmapi/swarm-worker:latest .
docker run -d -p 44444:44444 swarmapi/swarm-worker:latest
```

## 4. 环境变量说明

### worker
- `PORT`: 端口（默认 44444）
- `UPDATE_URL`: 版本元数据 URL
- `UPDATE_MODE`: periodic/manual/none（默认 periodic）
- `WORKER_VERSION`: 当前版本号（只读启动标签）
- `WORKER_PATH`: 本地 worker 路径（默认 `../worker`）
- `WORKER_START_PATH`: worker-start 脚本路径
- `HEARTBEAT_INTERVAL`: 心跳日志间隔（分钟，默认 5）

### queen
- `PORT`: 端口（默认 44444）
- `DATA_DIR`: 数据目录（默认 `./data`）

## 5. 推荐开发与调试路径

1. `swarm-queen` 在本机运行，添加可用 Worker URL（`http://localhost:44444`）。
2. `swarm-worker` 运行后，`/api/info` 确认返回。
3. 在 `swarm-queen` UI 里加入节点，点击 `测试全部`；日志显示请求成功。
4. 测试 `/v1/chat/completions` 代理：
   - 对 `swarm-queen` 发送请求（例如 `curl -X POST localhost:44444/v1/chat/completions ...`）。
   - 它会转发给选中的 Worker：`target.url/v1/chat/completions`。
5. 模拟自更新：修改 `swarmapi/versions.json` 版本号；Worker 下一次检测自动下载并重启。

## 6. 设计亮点与扩展点

- 模块化分层：
  - `swarm-queen` 负责调度 & 管理；
  - `swarm-worker` 负责三方请求转发 & 自更新。
- 易扩展：
  - `selectNode` 可替换为可用性 + 权重 +漏斗调度；
  - `worker` 路由可新增 `/api/metrics`、限流、鉴权；
  - 支持更多模型源、节点策略。
- 安全提醒：
  - 当前密码存储 md5 不安全，仅适合内部私有网络。
  - 不要在生产环境使用明文密码字段。

## 7. 术语映射（便于 AI 快速理解）

- Queen = 统一管控节点 & 负载网关 + UI。
- Worker = 执行引擎 + 传递层 + 自更新客户端。
- Topology = Queen 管理 N 个 Worker，Worker 可自动向 `swarmapi/versions.json` 报到更新。
- `swarmapi`  = 可部署镜像 / 发行包存储及版本元数据。

## 8. 关键文件简述

- `swarm-queen/queen.js`：启动入口；HTTP 路由、状态机、调度逻辑、文件持久化。
- `swarm-worker/src/index.js`：Worker 核心功能（`httpGet`, `fetchVersions`, `downloadWorker`,`callOpenCode`, `/v1/` 转发）。
- `swarmapi/versions.json`：版本控制源，Worker 任务同步更新标准。
- `swarmapi/worker-start.sh`：Worker 启动/守护封装。

---

## 9. 对后续 AI 的“快速上手思维”建议

1. 先了解请求入口：`swarm-queen/v1` -> `swarm-worker/v1` -> `opencode.ai`。
2. 关注状态存储：`data/*.json`（节点/账号/配置），非数据库设计。
3. 搜索自更新路径：`UPDATE_URL`、`fetchVersions`、`downloadWorker`、`forceUpdate`。
4. 核查安全/效率：认证机制、密码加密、节点选取、日志轮换、并发处理。
5. 目标优先级：实现稳定调度（多节点可用性评估） + 透明观测（可视化、日志） + 自动一致性（版本同步）。

> README 写完，已覆盖结构、运行、核心流程、扩展建议，足够 AI 与工程人员快速理解与开发。