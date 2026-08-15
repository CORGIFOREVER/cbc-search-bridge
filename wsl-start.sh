#!/usr/bin/env bash
# cbc-search-bridge — WSL 一键启动：桥接(后台) + dsh web harness(前台)
# 依赖：已运行过 wsl-setup.sh（有 Linux 原生 node）
set -euo pipefail

# 让 nvm 的 node 在当前 shell 可用
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v node >/dev/null || { echo "未找到 node，请先运行 bash wsl-setup.sh"; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_URL="http://127.0.0.1:3200"
BRIDGE_PID_FILE="$REPO_DIR/.bridge.pid"

# ── 1. 确保桥接在跑（后台）──
if curl -sf --max-time 2 "$BRIDGE_URL/health" >/dev/null 2>&1; then
  echo "==> 桥接已在运行"
else
  echo "==> 启动桥接 (node server.mjs) ..."
  (cd "$REPO_DIR" && nohup node server.mjs > bridge.log 2> bridge.err.log & echo $! > "$BRIDGE_PID_FILE")
  ok=0
  for i in $(seq 1 20); do
    if curl -sf --max-time 2 "$BRIDGE_URL/health" >/dev/null 2>&1; then
      echo "==> 桥接健康: $BRIDGE_URL/health"
      ok=1
      break
    fi
    sleep 0.5
  done
  [ "$ok" = 1 ] || { echo "桥接启动失败，看 bridge.err.log"; exit 1; }
fi

# ── 2. 退出时停掉本次拉起的桥接 ──
cleanup() {
  if [ -f "$BRIDGE_PID_FILE" ]; then
    pid="$(cat "$BRIDGE_PID_FILE")"
    kill "$pid" 2>/dev/null || true
    rm -f "$BRIDGE_PID_FILE"
    echo "==> 已停止本次启动的桥接 (pid $pid)"
  fi
}
trap cleanup EXIT

# ── 3. 启动 DSH harness（前台）──
echo "==> 启动 dsh web（首次会自动创建 ~/.dsh 配置）..."
exec npx -y @deepseek-ai/dsh web
