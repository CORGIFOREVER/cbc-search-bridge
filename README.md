# cbc-search-bridge

Local Exa-compatible search bridge that routes DeepSeek harness search queries through CodeBuddy's web search, with automatic smart routing and fallback.

让 DeepSeek harness（`dsh web`）的联网搜索走 CodeBuddy CLI 的 web search 能力，并按 API key 类型自动选择搜索通道的本地桥接服务。

> **Language / 语言**: [English](README.en.md) | [简体中文](README.md)

## 为什么需要它

`dsh web` harness 内置的联网搜索要求使用 DeepSeek **官方** API key（`web_search_20250305` 原生工具）。如果使用 apikey.fun 等 OpenAI 兼容代理，模型没有原生搜索工具，只会"假装搜索"编造数据。

本桥接服务把 harness 的搜索请求接管过来，自动路由到可用的搜索通道：

```
harness (searchProvider: exa) → cbc-search-bridge (:3200) → 搜索通道
```

## 智能路由

收到搜索请求后按以下顺序选择通道：

1. **DeepSeek 官方通道** — 若 `DEEPSEEK_API_KEY` 是官方 key（探测 `api.deepseek.com/anthropic/v1` 通过），直接调用 DeepSeek 官方原生搜索（`web_search_20250305` 工具），零额外依赖。
2. **CodeBuddy 通道** — 否则通过 CodeBuddy CLI（非交互 `-p` 模式）调用 web_search 工具，解析 JSON 结果。
3. **Exa 兜底** — 前两者均不可用时，直接调用 Exa API（需 `EXA_API_KEY`），保证搜索始终可用。

每次探测结果缓存 10 分钟，不会反复探测。

## 目录结构与文件说明

```
cbc-search-bridge/
├── server.mjs            # 核心：桥接服务（Node 原生 http，无框架依赖，约 430 行）
├── ensure-codebuddy.ps1  # 确保 CodeBuddy CLI daemon 运行（start-harness 的前置步骤）
├── start-bridge.ps1      # 单独启动桥接服务
├── stop-bridge.ps1       # 停止桥接服务
├── start-harness.ps1     # 一键启动：CodeBuddy CLI + 桥接 + dsh web harness
├── stop-harness.ps1      # 一键停止：harness + 桥接
├── package.json          # npm 元数据（node server.mjs 启动）
├── package-lock.json     # 依赖锁定文件
├── .gitignore            # 排除 node_modules/ 日志 凭据等
├── README.md             # 本文档
└── tests/                # 各通道测试脚本（见下方"测试"章节）
```

### 各文件职责

| 文件 | 职责 |
|------|------|
| `server.mjs` | 桥接服务主体。监听 127.0.0.1:3200，模拟 Exa `POST /search` 端点；内部实现三条搜索通道（DeepSeek 官方 / CodeBuddy CLI / Exa）及智能路由、key 类型探测（10 分钟缓存） |
| `ensure-codebuddy.ps1` | **保证 CodeBuddy CLI 处于服务状态**。检查 `codebuddy daemon status`，未运行则 `daemon start` 拉起，再做一次 `-p "hi"` 轻量探活。作为 `start-harness.ps1` 的第 0 步自动调用 |
| `start-bridge.ps1` | 只启动桥接服务（供单独调试 / 已有 harness 不想重启时使用） |
| `stop-bridge.ps1` | 停掉 3200 端口的桥接服务 |
| `start-harness.ps1` | 完整一键启动：0) 确保 CodeBuddy CLI daemon → 1) 确保桥接服务 → 2) 确保 dsh web harness，每步都带就绪等待和失败提示 |
| `stop-harness.ps1` | 同时停掉 harness（3080）和桥接（3200），配合 start 使用 |

### 使用方式

**场景 A：全新启动（推荐）**

```powershell
# 一条命令完成全部：确保 CodeBuddy CLI 运行 → 启动桥接 → 启动 harness
.\start-harness.ps1
```

**场景 B：只想单独调试桥接服务**

```powershell
.\start-bridge.ps1
# 健康检查
Invoke-RestMethod http://127.0.0.1:3200/health
# 结束后停止
.\stop-bridge.ps1
```

**场景 C：只启动 harness，桥接已有别人在跑**

```powershell
# 直接启动 harness 即可（桥接在 3200 端口复用）
node <dsh-bin> web   # 或通过你自己的方式
```

**场景 D：停止所有服务**

```powershell
.\stop-harness.ps1
```

## 启动顺序与 CodeBuddy CLI 保活机制

`start-harness.ps1` 按三步顺序启动，保证整个搜索链路可用：

```
Step 0: ensure-codebuddy.ps1  →  确保 CodeBuddy CLI daemon 在运行
Step 1: 启动桥接服务          →  监听 127.0.0.1:3200
Step 2: 启动 dsh web harness  →  监听 127.0.0.1:3080
```

**为什么需要 Step 0？** harness 的联网搜索默认走 CodeBuddy 通道（当 `DEEPSEEK_API_KEY` 不是官方 key 时），而桥接服务是通过命令行调用 CodeBuddy CLI 完成搜索的。如果 CLI 是"用一次启动一次"，第一次搜索会有额外冷启动延迟；而且 CLI 未登录时搜索会直接失败。

`ensure-codebuddy.ps1` 做三件事：

1. **定位 CLI** — 在 PATH 中查找 `codebuddy`，并解析出真实的 `node.exe` + `bin/codebuddy` 入口（绕开 Windows 下 `.ps1/.cmd` 包装器的问题）
2. **保活 daemon** — 执行 `codebuddy daemon status` 检查守护进程；若未运行则 `codebuddy daemon start` 拉起，最多重试 3 次
3. **轻量探活** — 执行 `codebuddy -p "hi"` 验证 CLI 可用；失败仅警告不中断（因为还有 Exa 兜底）

你可以单独运行它来验证：

```powershell
.\ensure-codebuddy.ps1
# 期望输出:
# [codebuddy] using: node C:\...\bin\codebuddy
# [codebuddy] daemon already running      (或 "daemon started")
# [codebuddy] CLI probe OK                (或 warning)
```

验证 daemon 状态也可以直接执行：

```powershell
codebuddy daemon status
# 返回 JSON: {"status": "running", "pid": 42288, "endpoint": "http://127.0.0.1:9527", ...}
```

## 快速开始

### 前置要求

- Node.js 18+
- 已安装 CodeBuddy CLI（`npm install -g @tencent-ai/codebuddy-code`）且完成登录，或配置 `EXA_API_KEY` 作为兜底
- （可选）DeepSeek 官方 key：环境变量 `DEEPSEEK_API_KEY` 或 `~/.dsh/.credentials.yaml`

### 启动

```powershell
# 一键启动（推荐）：自动完成 CodeBuddy CLI 保活 + 桥接 + harness
.\start-harness.ps1

# 或者分开操作：
.\ensure-codebuddy.ps1   # 1. 确保 CodeBuddy CLI 就绪
.\start-bridge.ps1       # 2. 启动桥接服务
node <dsh-bin> web       # 3. 启动 harness

# 健康检查
Invoke-RestMethod http://127.0.0.1:3200/health
```

### 在 harness 中启用

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
# 桥接服务注册为 exa 兼容 provider
- id: web-search-exa
  name: '@deepseek-ai/dsh-web-search-exa'
  config:
    baseURL: 'http://127.0.0.1:3200'
    apiKey: 'local-bridge'

# 让 harness 使用 exa provider（桥接服务接管）
- id: web
  config:
    searchProvider: exa
```

切换 API key 时无需修改任何配置，桥接服务会自动识别 key 类型并切换搜索通道。

## 搜索请求格式

桥接服务模拟 Exa 的 `POST /search` 端点：

```bash
curl -X POST http://127.0.0.1:3200/search \
  -H 'content-type: application/json' \
  -d '{"query": "DeepSeek API", "numResults": 5}'
```

响应格式：

```json
{
  "results": [
    {
      "url": "https://...",
      "title": "...",
      "publishedDate": "2026-08-01",
      "highlights": ["摘要文字"]
    }
  ],
  "truncated": false
}
```

测试钩子：请求头 `x-force-fallback: 1` 可强制走 Exa 兜底通道，用于验证降级链路。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API key（官方或代理均可，桥接自动识别） |
| `EXA_API_KEY` | Exa 兜底通道的 key（可选） |
| `BRIDGE_PORT` | 桥接监听端口，默认 `3200` |
| `BRIDGE_NODE_PATH` | node 可执行文件路径覆盖 |
| `BRIDGE_DSH_BIN` | dsh bin.js 路径覆盖 |
| `BRIDGE_HARNESS_DIR` | harness 工作目录覆盖 |
| `BRIDGE_CODEBUDDY_BIN` | codebuddy 真实 bin 入口路径覆盖（`ensure-codebuddy.ps1` 使用） |

## 测试

```powershell
node tests/bridge-exa-format-test.mjs   # 模拟 harness 完整请求
node tests/test-router.mjs              # 智能路由测试
node tests/test-probe.mjs               # key 类型探测测试
```

## 变更记录

### 2026-08-15: 修复 `ensure-codebuddy.ps1` 的 `$ErrorActionPreference` 导致启动链中断

**问题**：`ensure-codebuddy.ps1` 之前设置了 `$ErrorActionPreference = 'Stop'`。在探活阶段（`codebuddy -p "hi"`），外部命令 `node.exe` 会把正常的探活输出写入 stderr；当网络不可用（如 TLS 502）时，非零退出的原生 stderr 在 `Stop` 模式下会被 PowerShell 当作**终止错误**抛出，导致整个 `start-harness.ps1` 启动链在 Step 0 就中断，桥接服务和 harness 都不会启动。

**修改**：
- `ensure-codebuddy.ps1`：`$ErrorActionPreference` 从 `Stop` 改为 `Continue`。脚本内部已有显式的退出码检查（`$LASTEXITCODE`）和重试逻辑，`Continue` 模式完全安全，且不会把探活失败升级为终止错误。
- `start-harness.ps1`：调用 `ensure-codebuddy.ps1` 的步骤增加 `try/catch` 保护，即使子脚本抛出任何异常，桥接服务和 harness 仍会照常启动。

**原因**：探活失败（CLI 未登录、网络不可达）是**预期内**的降级场景——桥接服务还有 Exa 兜底通道。此时应该只输出警告并继续启动，而不是中止整个 harness。修复后启动链变为"Step 0 失败 → 警告 → 继续"，更符合容错设计。

## 许可

MIT
