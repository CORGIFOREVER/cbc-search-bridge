# Ensure CodeBuddy CLI daemon (supervisor) is running.
#
# Purpose:
#   Called BEFORE starting deepseek-harness to guarantee the CodeBuddy CLI
#   daemon is up, so harness web-search via the CodeBuddy channel responds
#   fast and reliably.
#
# Logic:
#   1. Locate the codebuddy entry (PATH or BRIDGE_CODEBUDDY_BIN override)
#   2. Check daemon status (codebuddy daemon status -> JSON)
#   3. Start it if not running (codebuddy daemon start)
#   4. Re-check; exit non-zero on failure
#   5. Light probe (codebuddy -p "hi") to warn if CLI is not usable
#
# Usage:  .\ensure-codebuddy.ps1    (called automatically by start-harness.ps1)
$ErrorActionPreference = 'Stop'

# Locate codebuddy. On Windows the bin/codebuddy file has no extension and
# must be invoked via node.exe, so resolve BOTH node and the real bin path.
$codebuddy = $env:BRIDGE_CODEBUDDY_BIN
if (-not $codebuddy) {
    $cmd = Get-Command codebuddy -ErrorAction SilentlyContinue
    if ($cmd) {
        $codebuddy = $cmd.Source
        # npm global installs a .ps1/.cmd wrapper; fall back to the real bin entry
        $wrapperDir = Split-Path $codebuddy
        $candidates = @(
            (Join-Path $wrapperDir 'node_modules\@tencent-ai\codebuddy-code\bin\codebuddy'),
            (Join-Path $wrapperDir '@tencent-ai\codebuddy-code\bin\codebuddy')
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { $codebuddy = $c; break }
        }
    }
}
if (-not $codebuddy -or -not (Test-Path $codebuddy)) {
    Write-Error "codebuddy CLI not found. Install it with: npm install -g @tencent-ai/codebuddy-code"
    exit 1
}
# Resolve node executable
$node = $env:BRIDGE_NODE_PATH
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
Write-Host "[codebuddy] using: node $codebuddy"

# Read daemon status as JSON
function Get-DaemonStatus {
    $out = & $node $codebuddy daemon status 2>$null | Out-String
    try {
        $json = $out | ConvertFrom-Json
        return $json.status   # "running" or "stopped"
    } catch {
        return $null
    }
}

$status = Get-DaemonStatus
if ($status -eq 'running') {
    Write-Host "[codebuddy] daemon already running"
} else {
    Write-Host "[codebuddy] daemon not running, starting..."
    & $node $codebuddy daemon start 2>&1 | Out-String | Write-Host
    Start-Sleep -Seconds 2

    $retry = 0
    while ($retry -lt 3) {
        $status = Get-DaemonStatus
        if ($status -eq 'running') { break }
        Start-Sleep -Seconds 2
        $retry++
    }
    if ($status -ne 'running') {
        Write-Error "[codebuddy] failed to start daemon. Please run 'codebuddy daemon start' manually and check login."
        exit 1
    }
    Write-Host "[codebuddy] daemon started"
}

# Light probe: daemon running does not imply logged in. A failure here is a
# warning only, because the bridge still has the Exa fallback.
Write-Host "[codebuddy] verifying CLI availability (codebuddy -p 'hi')..."
$probeOut = & $node $codebuddy -p "hi" 2>&1 | Out-String
$probeExit = $LASTEXITCODE
if ($probeExit -eq 0 -and $probeOut -notmatch 'login|sign|auth|401|403|502|socket|network|error') {
    Write-Host "[codebuddy] CLI probe OK"
} else {
    Write-Warning "[codebuddy] CLI probe failed (exit=$probeExit). The CLI may not be logged in or the network is unreachable. Search will degrade to the Exa fallback if EXA_API_KEY is set."
}
