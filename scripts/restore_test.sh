#!/usr/bin/env bash
# 将快照恢复到临时 D1，并逐表核对完整内容及外键；不接触线上数据库。
# 用法：scripts/restore_test.sh backups/<时间>/research-workspace.sql backups/<时间>/research-workspace.json
set -euo pipefail
cd "$(dirname "$0")/.."
SQL="${1:?需要 .sql 快照}"
JSON="${2:?需要同一时刻的 .json 导出}"
RESTORE_DIR=$(mktemp -d)
trap 'rm -rf "$RESTORE_DIR"' EXIT
node scripts/restore_sql.mjs "$SQL" "$RESTORE_DIR"
python3 - "$JSON" "$RESTORE_DIR" <<'PY'
import json, re, sqlite3, sys
from pathlib import Path
expected = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['tables']
files = [p for p in Path(sys.argv[2]).rglob('*.sqlite') if 'D1DatabaseObject' in str(p) and p.name != 'metadata.sqlite']
if len(files) != 1:
    sys.exit(f'恢复目录应只有一个 D1 数据库，实际 {len(files)} 个')
db = sqlite3.connect(f'file:{files[0]}?mode=ro', uri=True)
db.row_factory = sqlite3.Row
failures = 0
def ordered(rows):
    # D1 JSON emits whole REAL values as integers (1), SQLite reads them as 1.0.
    def normalized(row):
        return {k: int(v) if isinstance(v, float) and v.is_integer() else v for k, v in dict(row).items()}
    return sorted(json.dumps(normalized(r), sort_keys=True, ensure_ascii=False) for r in rows)
for table, rows in expected.items():
    if not re.fullmatch(r'[a-z_]+', table):
        sys.exit('导出包含不合法表名')
    got = list(db.execute(f'SELECT * FROM {table}'))
    ok = ordered(got) == ordered(rows)
    failures += not ok
    print(f"{'✓' if ok else '✗'} {table}: {len(got)} / {len(rows)} 行，完整内容{'一致' if ok else '不一致'}")
foreign_key_errors = list(db.execute('PRAGMA foreign_key_check'))
failures += bool(foreign_key_errors)
print(f"{'✓' if not foreign_key_errors else '✗'} 外键完整性：{len(foreign_key_errors)} 项问题")
# JSON 数组不受 SQLite 外键约束，另验多篇论文关联。
for table in ('goal_tasks', 'tasks'):
    columns = {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
    if 'paper_ids' not in columns:
        continue
    invalid = db.execute(f'''SELECT COUNT(*) FROM {table} t, json_each(t.paper_ids) j
        WHERE j.type NOT IN ('integer', 'real') OR j.value != CAST(j.value AS INTEGER) OR NOT EXISTS(SELECT 1 FROM papers p WHERE p.id = j.value)''').fetchone()[0]
    failures += bool(invalid)
    print(f"{'✓' if not invalid else '✗'} {table} 多论文关联：{invalid} 项悬空")
print('恢复演练通过' if not failures else f'恢复演练失败：{failures} 项不一致')
sys.exit(1 if failures else 0)
PY
