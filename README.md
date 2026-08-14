# cbc-search-bridge

Local Exa-compatible search bridge that routes DeepSeek harness search queries through CodeBuddy's web search, with automatic smart routing and fallback.

让 DeepSeek harness（`dsh web`）的联网搜索走 CodeBuddy CLI 的 web search 能力，并按 API key 类型自动选择搜索通道的本地桥接服务。

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

## 目录结构

```
cbc-search-bridge/
├── server.mjs          # 桥接服务（Node 原生 http，无框架依赖）
├── start-bridge.ps1    # 单独启动桥接服务
├── stop-bridge.ps1     # 停止桥接服务
├── start-harness.ps1   # 一键启动 桥接 + dsh web harness
├── stop-harness.ps1    # 一键停止两者
└── tests/              # 各通道测试脚本
```

## 快速开始

### 前置要求

- Node.js 18+
- 已安装并登录 CodeBuddy CLI（`codebuddy -p "hi"` 可用），或配置 `EXA_API_KEY` 作为兜底
- （可选）DeepSeek 官方 key：环境变量 `DEEPSEEK_API_KEY` 或 `~/.dsh/.credentials.yaml`

### 启动

```powershell
# 启动桥接服务
.\start-bridge.ps1

# 健康检查
Invoke-RestMethod http://127.0.0.1:3200/health

# 一键启动桥接 + harness
.\start-harness.ps1
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

## 测试

```powershell
node tests/bridge-exa-format-test.mjs   # 模拟 harness 完整请求
node tests/test-router.mjs              # 智能路由测试
node tests/test-probe.mjs               # key 类型探测测试
```

## 许可

MIT
