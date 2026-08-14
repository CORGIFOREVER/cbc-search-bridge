# 停止 cbc-search-bridge 服务
$conn = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force
    Write-Host "bridge stopped"
} else {
    Write-Host "bridge not running"
}
