# swarmapi

Free API swarm proxy.

## 快速开始

```bash
# 安装依赖
npm install

# 运行
GITHUB_TOKEN=your_token node proxy.js
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 44444 | 代理端口 |
| GITHUB_REPO | SwarmApi/swarmapi | GitHub仓库 |
| GITHUB_TOKEN | - | GitHub Token |
| POLL_INTERVAL | 30000 | 拉取节点间隔(ms) |
| PUSH_INTERVAL | 120000 | 推送节点间隔(ms) |

## API

- `GET /health` - 健康检查
- `POST /peer/announce` - 节点广播
- 其他请求 - 转发到可用节点
