# @dsh-external/dsh-web-search-resilient

DSH 工具层“铁打”联网搜索 provider：让 `web_search` 在 cbc-search-bridge 进程挂掉时依然能自动搜索。

## 降级顺序

```
web_search (tool-web)
  └─ ctx.web.search()
       └─ resilient provider
            1. GET  :3200/health
            2. 通 → POST :3200/search（桥接内部还有 CodeBuddy → Bing → Exa）
            3. 不通/失败 → 工具内部 Shell curl 抓 Bing
            4. Bing 也失败 → 直连 Exa API（需 EXA_API_KEY）
```

## 安装（持久化）

1. 本插件已并入 cbc-search-bridge 仓库：`C:/deepseekharness/cbc-search-bridge/dsh-web-search-resilient`。
2. 用 DSH 装配：
   ```powershell
   # 运行时注入（免重启）
   dev_inject_plugin C:/deepseekharness/cbc-search-bridge/dsh-web-search-resilient
   # 持久化安装（重启后仍生效）
   dev_install_package C:/deepseekharness/cbc-search-bridge/dsh-web-search-resilient
   ```
3. 在 `~/.dsh/profiles/web/cordis.patch.yml` 中：
   ```yaml
   - insert:
       - id: web-search-resilient
         name: '@dsh-external/dsh-web-search-resilient'
         config:
           bridgeBaseURL: 'http://127.0.0.1:3200'
           apiKey: 'local-bridge'

   - id: web
     config:
       searchProvider: resilient
   ```

## 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `bridgeBaseURL` | `http://127.0.0.1:3200` | cbc-search-bridge 地址 |
| `apiKey` | `local-bridge` | 桥接忽略的占位 key |
| `active` | `true` | 注册后立即切换 `ctx.web.searchProviderId` |
| `numResults` | `5` | 默认返回条数 |
| `bridgeHealthTimeoutMs` | `3000` | 桥接健康探测超时 |
| `bridgeSearchTimeoutMs` | `60000` | 桥接搜索超时 |
| `bingTimeoutMs` | `20000` | Bing curl 超时 |
| `exaBaseURL` | `https://api.exa.ai` | Exa 直连地址 |
| `exaApiKey` | `''` | 留空则读取 `EXA_API_KEY` 环境变量 |

## 依赖

- `curl` 在 PATH 中（Windows 10+ 自带 `C:/Windows/System32/curl.exe`）
- `@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-launch-environment`、`@deepseek-ai/schemastery`（DSH 自带）
