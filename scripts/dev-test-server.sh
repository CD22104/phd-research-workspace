#!/usr/bin/env bash
# 用一份全新的本地数据库启动开发服务器（测试用）。用法：scripts/dev-test-server.sh <数据目录> [端口]
set -euo pipefail
DIR="${1:?需要数据目录}"; PORT="${2:-8799}"
rm -rf "$DIR"; mkdir -p "$DIR"
npx wrangler d1 migrations apply DB --local --persist-to "$DIR" >/dev/null
exec npx wrangler pages dev --port "$PORT" --ip 127.0.0.1 --persist-to "$DIR" --binding DEV_NO_AUTH=1
