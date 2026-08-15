# cbc-search-bridge

Local Exa-compatible search bridge that routes DeepSeek harness search queries through CodeBuddy's web search, with automatic smart routing and fallback.

A local bridge service that lets the DeepSeek harness (`dsh web`) perform web searches through CodeBuddy CLI's web search capability, automatically selecting the search channel based on the API key type.

## Why do you need it

The `dsh web` harness's built-in web search requires a DeepSeek **official** API key (native `web_search_20250305` tool). If you use an OpenAI-compatible proxy such as apikey.fun, the model has no native search tool and will only "fake search" and fabricate data.

This bridge takes over the harness's search requests and routes them to an available search channel:

```
harness (searchProvider: exa) → cbc-search-bridge (:3200) → search channel
```

## Smart routing

Upon receiving a search request, the bridge picks a channel in this order:

1. **DeepSeek official channel** — If `DEEPSEEK_API_KEY` is an official key (probe of `api.deepseek.com/anthropic/v1` passes), it calls DeepSeek's native web search directly (via the `web_search_20250305` tool), with zero extra dependencies.
2. **CodeBuddy channel** — Otherwise it invokes the web_search tool through CodeBuddy CLI (non-interactive `-p` mode) and parses the JSON output.
3. **Exa fallback** — If both of the above are unavailable, it calls the Exa API directly (requires `EXA_API_KEY`), guaranteeing search always works.

Probe results are cached for 10 minutes to avoid repeated probing.

## Directory structure and file reference

```
cbc-search-bridge/
├── server.mjs            # Core: the bridge service (Node native http, no framework deps, ~430 lines)
├── ensure-codebuddy.ps1  # Ensures the CodeBuddy CLI daemon is running (Step 0 of start-harness)
├── start-bridge.ps1      # Starts the bridge service alone
├── stop-bridge.ps1       # Stops the bridge service
├── start-harness.ps1     # One-shot start: CodeBuddy CLI + bridge + dsh web harness
├── stop-harness.ps1      # One-shot stop: harness + bridge
├── package.json          # npm metadata (node server.mjs to start)
├── package-lock.json     # Dependency lock file
├── .gitignore            # Excludes node_modules/, logs, credentials, etc.
├── README.md             # This document (Chinese)
├── README.en.md          # This document (English)
└── tests/                # Channel test scripts (see the "Testing" section below)
```

### File responsibilities

| File | Responsibility |
|------|----------------|
| `server.mjs` | The bridge service. Listens on 127.0.0.1:3200 and mimics the Exa `POST /search` endpoint; implements the three search channels (DeepSeek official / CodeBuddy CLI / Exa) plus smart routing and key-type probing (10-minute cache). |
| `ensure-codebuddy.ps1` | **Keeps the CodeBuddy CLI in service.** Checks `codebuddy daemon status`; starts it via `daemon start` if not running; then does a lightweight `-p "hi"` probe. Automatically invoked as Step 0 of `start-harness.ps1`. |
| `start-bridge.ps1` | Starts only the bridge service (for standalone debugging, or when the harness is already running and you don't want to restart it). |
| `stop-bridge.ps1` | Stops the bridge service on port 3200. |
| `start-harness.ps1` | Full one-shot start: 0) ensure the CodeBuddy CLI daemon → 1) ensure the bridge service → 2) ensure the dsh web harness, each step with readiness waiting and failure hints. |
| `stop-harness.ps1` | Stops both the harness (3080) and the bridge (3200); pairs with start. |

### Usage

**Scenario A: fresh start (recommended)**

```powershell
# One command does everything: ensure CodeBuddy CLI is running → start bridge → start harness
.\start-harness.ps1
```

**Scenario B: debug the bridge alone**

```powershell
.\start-bridge.ps1
# Health check
Invoke-RestMethod http://127.0.0.1:3200/health
# Stop when done
.\stop-bridge.ps1
```

**Scenario C: start the harness only (bridge already running elsewhere)**

```powershell
# Just start the harness (the bridge is reused on port 3200)
node <dsh-bin> web   # or launch it your own way
```

**Scenario D: stop all services**

```powershell
.\stop-harness.ps1
```

## Startup order and the CodeBuddy CLI keep-alive mechanism

`start-harness.ps1` starts services in three steps to guarantee a working search pipeline:

```
Step 0: ensure-codebuddy.ps1  →  ensure the CodeBuddy CLI daemon is running
Step 1: start the bridge      →  listens on 127.0.0.1:3200
Step 2: start dsh web harness →  listens on 127.0.0.1:3080
```

**Why Step 0?** The harness's web search defaults to the CodeBuddy channel (when `DEEPSEEK_API_KEY` is not an official key), and the bridge performs searches by invoking the CodeBuddy CLI from the command line. If the CLI were launched on every use, the first search would suffer extra cold-start latency; worse, if the CLI is not logged in, searches fail outright.

`ensure-codebuddy.ps1` does three things:

1. **Locate the CLI** — finds `codebuddy` on PATH and resolves the real `node.exe` + `bin/codebuddy` entry (bypassing the `.ps1/.cmd` wrapper issue on Windows).
2. **Keep the daemon alive** — runs `codebuddy daemon status`; if not running, starts it with `codebuddy daemon start`, retrying up to 3 times.
3. **Lightweight probe** — runs `codebuddy -p "hi"` to verify the CLI is usable; failure is only a warning (the Exa fallback still exists).

You can run it standalone to verify:

```powershell
.\ensure-codebuddy.ps1
# Expected output:
# [codebuddy] using: node C:\...\bin\codebuddy
# [codebuddy] daemon already running      (or "daemon started")
# [codebuddy] CLI probe OK                (or a warning)
```

You can also check the daemon status directly:

```powershell
codebuddy daemon status
# Returns JSON: {"status": "running", "pid": 42288, "endpoint": "http://127.0.0.1:9527", ...}
```

## Quick start

### Prerequisites

- Node.js 18+
- CodeBuddy CLI installed (`npm install -g @tencent-ai/codebuddy-code`) and logged in, or `EXA_API_KEY` configured as a fallback
- (Optional) DeepSeek official key: environment variable `DEEPSEEK_API_KEY` or `~/.dsh/.credentials.yaml`

### Start

```powershell
# One-shot start (recommended): CodeBuddy CLI keep-alive + bridge + harness
.\start-harness.ps1

# Or step by step:
.\ensure-codebuddy.ps1   # 1. ensure the CodeBuddy CLI is ready
.\start-bridge.ps1       # 2. start the bridge service
node <dsh-bin> web       # 3. start the harness

# Health check
Invoke-RestMethod http://127.0.0.1:3200/health
```

### Enable it in the harness

Edit `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
# Register the bridge as an exa-compatible provider
- id: web-search-exa
  name: '@deepseek-ai/dsh-web-search-exa'
  config:
    baseURL: 'http://127.0.0.1:3200'
    apiKey: 'local-bridge'

# Make the harness use the exa provider (the bridge takes over)
- id: web
  config:
    searchProvider: exa
```

When you switch API keys you don't need to change any configuration; the bridge automatically detects the key type and switches the search channel.

## Search request format

The bridge mimics the Exa `POST /search` endpoint:

```bash
curl -X POST http://127.0.0.1:3200/search \
  -H 'content-type: application/json' \
  -d '{"query": "DeepSeek API", "numResults": 5}'
```

Response format:

```json
{
  "results": [
    {
      "url": "https://...",
      "title": "...",
      "publishedDate": "2026-08-01",
      "highlights": ["snippet text"]
    }
  ],
  "truncated": false
}
```

Test hook: the request header `x-force-fallback: 1` forces the Exa fallback channel, useful for verifying the degradation path.

## Environment variables

| Variable | Description |
|----------|-------------|
| `DEEPSEEK_API_KEY` | DeepSeek API key (official or proxy; the bridge auto-detects) |
| `EXA_API_KEY` | Key for the Exa fallback channel (optional) |
| `BRIDGE_PORT` | Bridge listen port, default `3200` |
| `BRIDGE_NODE_PATH` | Override for the node executable path |
| `BRIDGE_DSH_BIN` | Override for the dsh bin.js path |
| `BRIDGE_HARNESS_DIR` | Override for the harness working directory |
| `BRIDGE_CODEBUDDY_BIN` | Override for the real codebuddy bin entry (used by `ensure-codebuddy.ps1`) |

## Testing

```powershell
node tests/bridge-exa-format-test.mjs   # Simulates a full harness request
node tests/test-router.mjs              # Smart routing test
node tests/test-probe.mjs               # Key-type probing test
```

## Changelog

### 2026-08-15: Fix `$ErrorActionPreference` in `ensure-codebuddy.ps1` that aborted the whole startup chain

**Problem**: `ensure-codebuddy.ps1` previously set `$ErrorActionPreference = 'Stop'`. During the probe step (`codebuddy -p "hi"`), the external `node.exe` command writes normal probe output to stderr; when the network is unavailable (e.g. a TLS 502), a non-zero native stderr is treated by PowerShell as a **terminating error** under `Stop`, which aborted the entire `start-harness.ps1` startup chain at Step 0 — neither the bridge service nor the harness would start.

**Changes**:
- `ensure-codebuddy.ps1`: `$ErrorActionPreference` changed from `Stop` to `Continue`. The script already has explicit exit-code checks (`$LASTEXITCODE`) and retry logic, so `Continue` is completely safe and no longer escalates probe failures into terminating errors.
- `start-harness.ps1`: the step that invokes `ensure-codebuddy.ps1` is now wrapped in `try/catch`, so even if the child script throws any exception, the bridge and harness still start normally.

**Why**: Probe failures (CLI not logged in, network unreachable) are an **expected** degradation scenario — the bridge still has the Exa fallback channel. The correct behavior is to warn and continue, not to abort the whole harness. After this fix the startup chain becomes "Step 0 failed → warning → continue", which is more fault-tolerant.

## License

MIT
