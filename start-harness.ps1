# 一键启动 deepseek-harness（含搜索桥接服务）
#
# 逻辑：
#   0. 确保 CodeBuddy CLI daemon 在运行（调用 ensure-codebuddy.ps1）
#   1. 确保 cbc-search-bridge（端口 3200）在运行，未运行则启动
#   2. 确保 dsh web harness（端口 3080）在运行，未运行则启动
#
# 用法：  .\start-harness.ps1
# 提示：  harness 的联网搜索走 CodeBuddy 通道（需 CLI 已登录），
#         若 CodeBuddy 不可用则自动降级到 Exa（需 EXA_API_KEY 环境变量）。
$ErrorActionPreference = 'Stop'

$bridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# 路径可经环境变量覆盖，默认值适用于常见安装位置
$node = $env:BRIDGE_NODE_PATH
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$dshBin = $env:BRIDGE_DSH_BIN
if (-not $dshBin) { $dshBin = 'C:\Users\23006\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js' }
$harnessWorkDir = $env:BRIDGE_HARNESS_DIR
if (-not $harnessWorkDir) { $harnessWorkDir = 'C:\deepseekharness\deepseek-harness' }

# ── 0. 确保 CodeBuddy CLI daemon 运行（搜索通道依赖它）──
$ensureScript = Join-Path $bridgeDir 'ensure-codebuddy.ps1'
if (Test-Path $ensureScript) {
    Write-Host "--- Step 0: ensure CodeBuddy CLI is running ---"
    try {
        & $ensureScript
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "[harness] CodeBuddy CLI not ready. Search will degrade to Exa fallback (if EXA_API_KEY set)."
        }
    } catch {
        Write-Warning "[harness] ensure-codebuddy.ps1 raised an error: $($_.Exception.Message)"
    }
} else {
    Write-Warning "[harness] ensure-codebuddy.ps1 not found next to start-harness.ps1; skipping CodeBuddy readiness check."
}

# ── 1. 确保桥接服务运行 ──
$bridge = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
if ($bridge) {
    Write-Host "[bridge] already running (PID $($bridge.OwningProcess))"
} else {
    Write-Host "[bridge] starting cbc-search-bridge..."
    $bridgeLog = Join-Path $bridgeDir 'bridge.log'
    $bridgeErr = Join-Path $bridgeDir 'bridge.err.log'
    Start-Process -FilePath $node -ArgumentList "`"$bridgeDir\server.mjs`"" -WorkingDirectory $bridgeDir `
        -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErr -WindowStyle Hidden
    # 等待就绪（最多 10 秒）
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        $c = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
        if ($c) { $ready = $true; Write-Host "[bridge] ready (PID $($c.OwningProcess))"; break }
    }
    if (-not $ready) {
        Write-Warning "[bridge] failed to start within 10s - check $bridgeErr"
        if (Test-Path $bridgeErr) { Get-Content $bridgeErr -Tail 15 }
    }
}

# ── 2. 确保 harness 运行 ──
$harness = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($harness) {
    Write-Host "[harness] already running (PID $($harness.OwningProcess))"
} else {
    Write-Host "[harness] starting dsh web..."
    Start-Process -FilePath $node -ArgumentList "`"$dshBin`" web" -WorkingDirectory $harnessWorkDir `
        -RedirectStandardOutput 'C:\deepseekharness\dsh-web.log' -RedirectStandardError 'C:\deepseekharness\dsh-web.err.log' `
        -WindowStyle Hidden
    # 等待就绪（最多 60 秒）
    $ready = $false
    for ($i = 0; $i -lt 120; $i++) {
        Start-Sleep -Milliseconds 500
        $c = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
        if ($c) {
            $ready = $true
            Write-Host "[harness] ready (PID $($c.OwningProcess))"
            Write-Host "[harness] open http://127.0.0.1:3080"
            break
        }
    }
    if (-not $ready) {
        Write-Warning "[harness] failed to start within 60s - check C:\deepseekharness\dsh-web.err.log"
        if (Test-Path 'C:\deepseekharness\dsh-web.err.log') { Get-Content 'C:\deepseekharness\dsh-web.err.log' -Tail 15 }
    }
}

Write-Host "`nDone. bridge=3200 harness=3080"
