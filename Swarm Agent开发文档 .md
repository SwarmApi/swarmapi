Swarm Agent 完整开发：从设计到实现
Swarm Agent 完整开发文档
（可直接丢给 Copilot / OpenCode 一键实现）

1. 项目概述
本项目是一个无数据库、无共享存储、云容器原生、多角色自治的 AI 蜂群开发系统，基于 DeerFlow + GStack + Ralph 循环 构建，所有节点运行同一套程序，通过角色区分能力，支持在免费容器平台（RunClaw 等）多开部署。
核心设计原则
•无 SQL、无共享磁盘、无分布式存储
•容器内文件系统正常使用，不跨容器共享
•双 Git 分离：业务代码仓库 + 蜂群状态仓库
•专职 Secretary 角色管理状态、Git、节点、端口
•所有节点通过 HTTP + WebSocket 通信
•支持多端口暴露、服务发现、热更新
•内置 Harness 做 Lint 规范 + Git 安全白名单

2. 角色体系（GStack 风格）
所有角色运行同一程序，通过 --role 指定
角色	数量	核心职责
secretary	1	节点注册、端口地址管理、状态 Git 唯一写入、配置中心、快照
queen	1	需求拆解、任务调度、决策、人工交互入口
leader:frontend	n	前端领域负责人、代码验收、Lint 把关、分支管理
leader:backend	n	后端领域负责人、代码验收、Lint 把关、分支管理
worker	n	执行编码、调用 LLM CLI、本地工作区操作、Harness 校验

3. Git 双仓库规范（强制分离）
3.1 业务代码仓库 project.git
存放人类可维护、可发布的内容
•源代码（src/）
•[AGENT.md](AGENT.md)、[SKILLS.md](SKILLS.md)、规范文档
•.eslintrc、prettier、Harness 规则
•Dockerfile、构建脚本
•禁止：任务、状态、节点、日志、端口信息
3.2 蜂群状态仓库 swarm-state.git
仅 Secretary 可写，系统内部使用
Plain Text
swarm-state/
├── nodes.json          # 节点地址、端口、角色、在线状态
├── tasks.json          # 全局任务清单（Ralph 格式）
├── skills.json         # 所有 LLM CLI 能力注册
├── memory/
│   ├── long-term/      # 项目规范、历史经验
│   └── short-term/     # 任务上下文、迭代快照
├── harness/
│   └── lint-history.json
└── logs/
    └── heartbeat.log

4. 网络与端口设计（云容器原生）
每个节点允许暴露多个端口，通过 Secretary 统一管理
4.1 端口分配
•8080：HTTP / WebSocket 通信（任务、指令、消息）
•8081：管理端口（健康检查、日志、调试）
•8082：LLM CLI 内部服务端口（opencode / copilot）
4.2 节点注册流程
1.容器启动 → 加载 Secretary 地址（环境变量）
2.节点启动服务 → 向 Secretary 发送注册请求
JSON
{
  "nodeId": "worker-f4b21",
  "role": "worker",
  "model": "opencode",
  "skills": ["frontend", "lint"],
  "addr": "xxx.runclaw.app",
  "ports": { "http": 8080, "admin": 8081, "llm": 8082 },
  "token": "SWARM_TOKEN"
}
3.Secretary 验证 → 写入 nodes.json → 同步 Git
4.所有节点互相发现必须通过 Secretary 查询

5. 存储规则（无 SQL、无共享盘）
5.1 容器本地文件（可自由使用）
•工作区代码
•临时缓存
•本地日志
•当前任务上下文
•重启丢失，不存全局状态
5.2 全局状态存储
•内存：Secretary + Queen
•持久化：swarm-state.git
•唯一可信源：Git

6. Harness 规范（仅做 Lint + Git 白名单）
每个节点内置，不独立部署
6.1 Lint 检查
•eslint
•prettier
•自动修复
•不通过不可提交 Git
6.2 Git 安全白名单
允许：
•clone / pull / checkout / commit
•push 到自己分支
禁止：
•push 到 main/master
•强制推送
•删除远程分支
•直接合并代码

7. 核心流程（Ralph 循环）
1.Queen 从 Secretary 拉取配置 → 拆解任务
2.Queen 向 Secretary 查询可用 Worker
3.Worker 领取任务 → 本地拉代码
4.调用 OpenCode / Copilot 编写代码
5.Harness.lint() 检查
6.本地 Git 提交（业务仓库）
7.上报结果给 Queen
8.Queen 通知 Leader 验收
9.Secretary 定时同步状态到 Git

8. Docker 架构（永不重构镜像）
基础镜像（仅运行时）
Dockerfile
FROM node:20-alpine
WORKDIR /workspace
RUN apk add --no-cache git curl jq bash
RUN npm install -g opencode-cli eslint prettier
ENV PATH="/agent:$PATH"
CMD ["bash", "-c", "git clone $AGENT_REPO /agent || git -C /agent pull && node /agent/index.js"]
环境变量
Plain Text
AGENT_ROLE=worker
AGENT_REPO=https://github.com/xx/agent.git
SECRETARY_ADDR=http://xxx.runclaw.app:8080
SWARM_TOKEN=******
PROJECT_GIT=https://github.com/xx/project.git
STATE_GIT=https://github.com/xx/swarm-state.git

9. CLI 命令集（AI 可直接调用）
Bash
agent init               # 初始化项目 + 双 Git
agent start --role xxx   # 启动节点
agent register           # 向 Secretary 注册
agent task list          # 查看任务
agent task assign        # 领取任务
agent task report        # 上报进度
agent lint run           # 执行规范检查
agent git safe-commit    # 安全提交（Harness 校验）
agent node list          # 查询节点列表（从 Secretary）
agent memory sync        # 同步长短期记忆

10. 文件结构（AI 生成代码用）
Plain Text
/agent
├── index.js                # 程序入口
├── cli/                    # 命令解析
├── core/
│   ├── role.js             # 角色逻辑
│   ├── secretary.js        # 秘书核心逻辑
│   ├── queen.js            # 蜂王调度
│   ├── worker.js           # 工蜂执行
│   ├── harness.js          # Lint + Git 护栏
│   └── ralph.js            # Ralph 循环
├── transport/              # HTTP + WebSocket
│   ├── client.js
│   └── server.js
├── storage/                # Git 操作封装
│   ├── project-git.js
│   └── state-git.js
└── config/                 # 规范与规则

11. 交付要求（给 Copilot 的指令）
请严格按本文档实现，遵循：
•无 SQL、无共享存储、无第三方服务依赖
•双 Git 分离
•Secretary 单例、唯一写状态 Git
•节点通过 WebSocket 通信
•容器本地文件可自由使用，但不跨节点共享
•Harness 只做 Lint + Git 白名单
•所有角色同一二进制包
•支持云容器多端口、服务发现
•代码轻量、低内存、可无限多开

你现在只需要做 2 件事：
1.复制本文档 → 粘贴给 Copilot / OpenCode
2.说：按这份文档完整实现，不要提问、直接生成代码
需要我再帮你生成 启动脚本、部署命令、[AGENT.md](AGENT.md)、[SKILLS.md](SKILLS.md) 吗？
|（注：文档部分内容可能由 AI 生成)