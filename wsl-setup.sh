#!/usr/bin/env bash
# cbc-search-bridge — WSL (Ubuntu) 一键环境准备
# 用法（在 WSL Ubuntu 里）：
#   bash wsl-setup.sh
set -euo pipefail

echo "==> [1/4] 检查/安装 Linux 原生 Node.js (nvm)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if ! command -v node >/dev/null 2>&1; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "==> 安装 nvm ..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  echo "==> 安装 Node LTS ..."
  nvm install --lts
  nvm alias default 'lts/*'
else
  echo "==> 已检测到 node: $(node -v)"
fi

# 确保当前 shell 能用到 nvm 里的 node（新终端也要 source ~/.bashrc）
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
echo "==> node $(node -v) / npm $(npm -v)"

echo "==> [2/4] 检查 curl / git"
command -v curl >/dev/null || { echo "缺少 curl，请先 apt install curl"; exit 1; }
command -v git  >/dev/null || { echo "缺少 git，请先 apt install git"; exit 1; }

echo "==> [3/4] 准备仓库"
REPO_DIR="${CBC_BRIDGE_DIR:-$HOME/cbc-search-bridge}"
if [ ! -f "$REPO_DIR/server.mjs" ]; then
  echo "==> clone 到 $REPO_DIR"
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone https://github.com/CORGIFOREVER/cbc-search-bridge.git "$REPO_DIR"
else
  echo "==> 仓库已存在: $REPO_DIR"
fi

echo "==> [4/4] 环境检查"
if [ -z "${EXA_API_KEY:-}" ]; then
  echo "==> 提示：未检测到 EXA_API_KEY。"
  echo "    - Bing 兜底不需要 key；"
  echo "    - 如需 Exa 最后兜底，请先: export EXA_API_KEY=你的key"
fi

cat <<'NEXT'

✅ WSL 环境准备完成。下一步：

  1) 启动桥接（前台，方便看日志）：
       cd ~/cbc-search-bridge
       node server.mjs

  2) 另开一个 WSL 终端，一键启动桥接 + harness：
       cd ~/cbc-search-bridge
       bash wsl-start.sh

  3) 详细配置（profile / searchProvider）见 README.md 的 “在 WSL 上运行” 章节。
NEXT
