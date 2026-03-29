# Swarm Queen 项目规划

## 项目概述
Swarm Queen GitHub 账户管理 UI 和 API 后端系统

## 核心文件
- `D:\code\claws\swarm-queen\queen.js` — 主后端和前端 HTML/JS
- `D:\code\claws\swarm-queen\data\admin.json` — 管理员配置
- `D:\code\claws\swarm-queen\data\accounts.json` — GitHub 账户数据

## 目标

### 1. 字段映射
- "邮箱"显示值 = 原"username"字段
- "账户"显示值 = 原"label"字段
- 真实邮箱存储在原"email"字段

### 2. Copilot 配额逻辑
- 如果 Copilot 重置日期 ≤ 今天 → 可用（绿色）
- 如果 Copilot 重置日期 > 今天 → 已用（红色）

### 3. 编辑功能
- 点击"编辑"打开完整添加账户表单
- 预填当前记录的所有字段值
- 保存更新对应记录

### 4. 表头过滤器
- 地区统计按钮可点击过滤
- 可用/已用状态按钮可点击过滤

## 当前问题
queen.js 存在语法错误，node --check 报错：
```
SyntaxError: Unexpected identifier 'style'
at line 444
```
需要修复模板字符串语法。

## 技术栈
- 纯 HTML/JS/CSS（无框架）
- Node.js 后端
- 内存中的前端状态管理
