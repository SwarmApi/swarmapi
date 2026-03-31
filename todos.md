# Claws (SwarmApi) 设计完善方案 - TODOs

## 背景与问题分析

当前 `swarm-queen` 设计为主动管理蜂群模式，但存在以下痛点：
- **Workers 管理成本高**：Workers 多时，手动添加/维护 URL 繁琐，无自动发现机制。
- **URL 识别技术缺失**：部署容器时需手动将生成的 URL 添加到 Queen。
- **代理服务局限性**：Queen 本地部署，代理 API 仅限本地访问，无法提供互联网代理服务。
- **GitHub 账号管理**：Queen 管理大量 GitHub 账号，进一步增加本地部署的复杂性。

## 新架构设计：引入 Leader 角色

为解决上述问题，引入 **Leader** 角色，实现分布式代理与指令下发：

### Leader 角色定义
- **运行环境**：单 JS 代码，部署在 Cloudflare Workers 上，支持绑定固定域名。
- **发现机制**：Workers 通过 `versions.json` 中的 `leaders` 字段（加密字符串）主动发现 Leader。
- **代理服务**：提供互联网代理服务，固定域名可供非本地环境使用。
- **指令下发**：接收本地 Queen 的任务/指令，通过长连接转发给 Workers。
- **安全隔离**：Leader 无法识别 Workers 的实际 URL，仅通过加密通道通信。

### 架构拓扑
```
[本地 Queen] <---指令发布---> [Leader (Cloudflare)] <---长连接---> [Workers]
     |                                              |
     +---本地代理 (原生蜂群)                    +---互联网代理 (固定域名)
     +---管理 Workers/Github 账号
```

### 代理模式选择
- **本地环境**：继续使用原生蜂群代理，或可选使用 Leader 的代理地址。
- **非本地环境**：使用 Leader 的固定代理地址。

## TODO 任务清单

### 1. Leader 实现 (Cloudflare Workers)
- [ ] 创建单 JS 文件 (`leader.js`)，实现 Cloudflare Workers 兼容代码。
- [ ] 实现代理转发逻辑：接收 `/v1/*` 请求，转发到连接的 Workers。
- [ ] 实现 WS 长连接管理：维护与 Workers 的持久连接池。
- [ ] 实现指令接收：从 Queen 接收任务/更新指令，转发给 Workers。
- [ ] 实现加密认证：使用 `versions.json` 中的加密字符串验证 Workers。
- [ ] 部署到 Cloudflare Workers，绑定固定域名 (e.g., `api.claws.example.com`)。

### 2. versions.json 扩展
- [ ] 添加 `leaders` 字段：数组形式，包含 Leader 域名 + 加密密钥。
  ```json
  {
    "version": "1.0.8",
    "worker_url": "...",
    "worker_start_url": "...",
    "leaders": [
      {
        "domain": "api.claws.example.com",
        "key": "encrypted_string_for_auth"
      }
    ]
  }
  ```
- [ ] 更新发布流程：每次更新时同步 `leaders` 配置。

### 3. Worker 发现与连接逻辑
- [ ] 修改 `src/index.js`：在 `fetchVersions()` 时解析 `leaders` 字段。
- [ ] 实现 Leader 发现：Workers 定期尝试连接 `leaders` 中的域名，建立 WS 长连接。
- [ ] 实现连接池：每个 Worker 连接到多个 Leader（负载均衡）。
- [ ] 实现心跳机制：WS 连接保持活跃，断线重连。
- [ ] 实现代理模式切换：本地 vs Leader 代理，根据环境变量或配置选择。

### 4. Queen 指令发布机制
- [ ] 在 `queen.js` 中添加 Leader 管理界面：显示/编辑 `leaders` 列表。
- [ ] 实现指令发布 API：`/api/leaders/:id/command`，向指定 Leader 发送任务/更新指令。
- [ ] 实现批量操作：全量更新 Workers 时，通过 Leader 转发。
- [ ] 更新 UI：添加 Leader 管理标签页，显示连接状态、指令历史。

### 5. 安全与加密
- [ ] 实现加密字符串生成：Queen 生成 Leader 认证密钥，写入 `versions.json`。
- [ ] 实现 WS 认证：Workers 使用加密字符串连接 Leader。
- [ ] 防止逆向识别：Leader 不存储/暴露 Workers URL，仅通过 WS 通道通信。
- [ ] 添加日志审计：记录 Leader 指令下发与 Worker 响应。

### 6. 部署与测试
- [ ] 创建 Leader 部署脚本：自动化发布到 Cloudflare Workers。
- [ ] 更新 Docker 配置：`swarmapi/Dockerfile` 支持 Leader 环境变量。
- [ ] 本地测试：模拟 Leader + Workers 集群，验证代理与指令下发。
- [ ] 互联网测试：部署 Leader 到 Cloudflare，验证固定域名代理。
- [ ] 性能测试：评估 WS 长连接在高并发下的稳定性。

### 7. 兼容性与迁移
- [ ] 保持向后兼容：原生蜂群代理模式继续可用。
- [ ] 迁移脚本：现有 Workers 无缝切换到 Leader 模式。
- [ ] 文档更新：更新 `README.md` 和 `update-steps.md`，说明新架构。
- [ ] 用户指南：添加 Leader 配置与使用教程。

### 8. 高级功能 (可选扩展)
- [ ] Leader 负载均衡：多个 Leader 实例，支持 DNS 轮询。
- [ ] 地理分布：Leader 支持多区域部署，优化延迟。
- [ ] 监控面板：集成 Leader 状态监控 (连接数、流量、错误率)。
- [ ] 故障转移：Leader 宕机时自动切换备用实例。

## 实施优先级

1. **核心实现**：Leader JS 代码 + WS 长连接 (任务 1, 3)。
2. **配置扩展**：versions.json + Queen UI (任务 2, 4)。
3. **安全加固**：加密认证 + 审计 (任务 5)。
4. **测试部署**：本地/互联网验证 (任务 6)。
5. **兼容迁移**：向后兼容 + 文档 (任务 7)。

## 预期收益

- **降低管理成本**：Workers 自动发现 Leader，无需手动添加 URL。
- **扩展代理服务**：固定域名支持互联网访问，突破本地限制。
- **提高可靠性**：WS 长连接确保实时指令下发与状态同步。
- **增强安全性**：加密通道防止 URL 泄露，Leader 隔离 Workers 身份。

---

*最后更新: 2026-03-31 | 设计者: AI Assistant*</content>
<parameter name="filePath">d:\code\claws\todos.md