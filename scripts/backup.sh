#!/usr/bin/env bash
# 备份（单向）：
#   1. 一致的数据库快照（wrangler d1 export → .sql）：用于完整恢复
#   2. 完整 JSON 导出：所有表，含来源、变更记录、笔记正文
#   3. Markdown 阅读版：方便在 Git 里浏览和看历史，不用于恢复
# 另有 Cloudflare D1 自带的 Time Travel（任意时间点恢复：免费版 7 天、付费版 30 天）。
#
# 用法：scripts/backup.sh                    # 远程数据库
#       scripts/backup.sh --local <数据目录>  # 本地开发库（测试用）
# 设置 HONEY_BACKUP_REPO=<私有仓库本地路径> 时，会把这次备份提交并推送过去。
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP=$(date +%Y-%m-%d_%H%M)
OUT="backups/$STAMP"
mkdir -p "$OUT"
if [ "${1:-}" = "--local" ]; then
  python3 scripts/sqlite_dump.py "${2:?需要数据目录}" "$OUT/research-workspace.sql"
else
  npx wrangler d1 export DB --remote --output "$OUT/research-workspace.sql" >/dev/null
fi
python3 scripts/honey.py export "$OUT/research-workspace.json"
python3 scripts/honey.py markdown "$OUT/research-workspace.json" "$OUT/markdown"
( cd "$OUT" && sha256sum research-workspace.sql research-workspace.json > SHA256SUMS )
echo "备份完成：$OUT"

if [ -n "${HONEY_BACKUP_REPO:-}" ]; then
  mkdir -p "$HONEY_BACKUP_REPO/snapshots"
  cp "$OUT/research-workspace.sql" "$HONEY_BACKUP_REPO/snapshots/research-workspace-$STAMP.sql"
  rm -rf "$HONEY_BACKUP_REPO/markdown" && cp -r "$OUT/markdown" "$HONEY_BACKUP_REPO/markdown"
  ( cd "$HONEY_BACKUP_REPO" && git add -A && git commit -qm "备份 $STAMP" && git push -q ) && echo "已推送到备份仓库"
fi
