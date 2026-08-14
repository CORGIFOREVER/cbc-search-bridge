# 一键停止 deepseek-harness 及其搜索桥接服务
# 用法：  .\stop-harness.ps1
$ErrorActionPreference = 'Stop'

# ── 停止 harness（3080）──
$harness = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($harness) {
    Stop-Process -Id $harness.OwningProcess -Force
    Write-Host "[harness] stopped"
} else {
    Write-Host "[harness] not running"
}

# ── 停止桥接服务（3200）──
$bridge = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
if ($bridge) {
    Stop-Process -Id $bridge.OwningProcess -Force
    Write-Host "[bridge] stopped"
} else {
    Write-Host "[bridge] not running"
}

Write-Host "Done."
