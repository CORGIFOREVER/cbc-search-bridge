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
3. **Bing fallback** — If CodeBuddy fails, it fetches `https://www.bing.com/search` with Shell curl and parses `b_algo` results into the Exa format (requires `curl` in PATH; Windows 10+ ships it).
4. **Exa fallback** — If Bing also fails, it finally calls the Exa API directly (requires `EXA_API_KEY`), guaranteeing search always works.

Probe results are cached for 10 minutes to avoid repeated probing.

## Directory structure and file reference

```
cbc-search-bridge/
├── server.mjs            # Core: the bridge service (Node native http, no framework deps, ~540 lines)
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
├── dsh-web-search-resilient/  # Optional DSH plugin: tool-layer Bing/Exa fallback when the bridge is down
└── tests/                # Channel test scripts (see the "Testing" section below)
```

### File responsibilities

| File | Responsibility |
|------|----------------|
| `server.mjs` | The bridge service. Listens on 127.0.0.1:3200 and mimics the Exa `POST /search` endpoint; implements the four search channels (DeepSeek official / CodeBuddy CLI / Bing curl / Exa) plus smart routing and key-type probing (10-minute cache). |
| `ensure-codebuddy.ps1` | **Keeps the CodeBuddy CLI in service.** Checks `codebuddy daemon status`; starts it via `daemon start` if not running; then does a lightweight `-p "hi"` probe. Automatically invoked as Step 0 of `start-harness.ps1`. |
| `start-bridge.ps1` | Starts only the bridge service (for standalone debugging, or when the harness is already running and you don't want to restart it). |
| `stop-bridge.ps1` | Stops the bridge service on port 3200. |
| `start-harness.ps1` | Full one-shot start: 0) ensure the CodeBuddy CLI daemon → 1) ensure the bridge service → 2) ensure the dsh web harness, each step with readiness waiting and failure hints. |
| `stop-harness.ps1` | Stops both the harness (3080) and the bridge (3200); pairs with start. |
| `dsh-web-search-resilient/` | Optional DSH plugin: keeps `web_search` alive with automatic curl-Bing / direct-Exa fallback even when the bridge process is down. |

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
- CodeBuddy CLI installed (`npm install -g @tencent-ai/codebuddy-code`) and logged in
- `curl` available in PATH (Windows 10+ ships `C:WindowsSystem32curl.exe`) for the Bing fallback; or `EXA_API_KEY` configured as the last-resort fallback
- (Optional) DeepSeek official key: environment variable `DEEPSEEK_API_KEY` or `~/.dsh/.credentials.yaml`

### What if CodeBuddy CLI is not installed at all?

**No problem — the bridge automatically skips CodeBuddy and falls back to Bing/Exa.**

The routing order is:

```
DeepSeek official → CodeBuddy CLI → Bing (Shell curl) → Exa
```

If CodeBuddy CLI was **never installed** on the machine (or is not logged in / its backend is unreachable), the bridge does not get stuck:

1. `cbcSearch()` tries to spawn `codebuddy` and immediately gets an `ENOENT`/spawn error;
2. The error is caught and the bridge automatically enters the **Bing fallback**: it fetches `https://www.bing.com/search` with the system `curl` and parses `b_algo` blocks;
3. Only if Bing also fails does it enter the **Exa fallback** (requires `EXA_API_KEY`).

Minimum working setup:

- Have `curl` (Windows 10+ ships it; Git Bash also has it) → no CodeBuddy and no Exa key needed;
- Want extra resilience → also configure `EXA_API_KEY`;
- Want the CodeBuddy channel → install the CLI and log in.

Scenario table:

| Machine state | Search available? | Actual channel |
|---|---|---|
| Only curl | ✅ | Bing |
| curl + EXA_API_KEY | ✅ | Bing → Exa |
| CodeBuddy installed and logged in | ✅ | CodeBuddy → Bing → Exa |
| Nothing installed | ❌ | All fail |

**To enable the CodeBuddy channel** (optional):

```powershell
# 1. Install CodeBuddy CLI globally
npm install -g @tencent-ai/codebuddy-code

# 2. Log in (follow the prompts)
codebuddy

# 3. Verify
codebuddy -p "hi"
# Should reply normally instead of 502/ENOENT

# 4. The startup chain keeps the daemon alive automatically
.start-harness.ps1
```

> Note: `ensure-codebuddy.ps1` only **warns and continues** when the CLI is missing or not logged in, because the Bing/Exa fallback still exists. A missing CodeBuddy CLI will never abort startup.

**Even stronger "tool-layer" fallback** (optional, DSH plugin):

Even if the `cbc-search-bridge` process itself is down, the `web_search` tool will not fail — the companion
`dsh-web-search-resilient/` plugin (a subdirectory of this repo) runs inside the DSH process: it probes `:3200/health` first,
uses the bridge when it is healthy, and when the bridge is down it directly fetches Bing with Shell curl,
then Exa if Bing also fails. This removes the need to rely on the model manually running curl per AGENTS.md.

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

Test hooks: `x-force-fallback: 1` forces the Exa fallback channel; `x-force-bing: 1` forces the Bing fallback channel; `x-force-codebuddy-fail: 1` forces CodeBuddy to fail (verifies automatic fallback to Bing); `x-force-bing-fail: 1` forces Bing to fail (verifies automatic fallback to Exa).

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

**Why**: Probe failures (CLI not logged in, network unreachable) are an **expected** degradation scenario — the bridge still has the Bing/Exa fallback channels. The correct behavior is to warn and continue, not to abort the whole harness. After this fix the startup chain becomes "Step 0 failed → warning → continue", which is more fault-tolerant.

## License

MIT
