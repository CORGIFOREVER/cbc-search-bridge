# 启动 cbc-search-bridge 服务（后台运行）
# 用法:  .\start-bridge.ps1   （首次需先完成 codebuddy CLI 登录）
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = $env:BRIDGE_NODE_PATH
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$log = Join-Path $dir 'bridge.log'
$err = Join-Path $dir 'bridge.err.log'

# 检查是否已在运行
$existing = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "bridge already running (PID $($existing.OwningProcess))"
    exit 0
}

Start-Process -FilePath $node -ArgumentList "`"$dir\server.mjs`"" -WorkingDirectory $dir `
    -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden
Start-Sleep -Seconds 2
$conn = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "bridge started (PID $($conn.OwningProcess))"
    Write-Host "health: http://127.0.0.1:3200/health"
} else {
    Write-Host "bridge failed to start - check $err"
    if (Test-Path $err) { Get-Content $err -Tail 10 }
    exit 1
}
