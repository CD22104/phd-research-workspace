#!/usr/bin/env python3
"""导出本地 Miniflare SQLite，支持有外键和触发器的 D1 恢复。

线上请用 wrangler d1 export。用法：sqlite_dump.py <数据目录> <输出.sql>
"""
import re
import sqlite3
import sys
from pathlib import Path

root, out = Path(sys.argv[1]), Path(sys.argv[2])
dbs = [p for p in root.rglob('*.sqlite') if 'D1DatabaseObject' in str(p) and p.name != 'metadata.sqlite']
if len(dbs) != 1:
    sys.exit(f'应只有一个 D1 本地库，实际 {len(dbs)} 个')
src = sqlite3.connect(f'file:{dbs[0]}?mode=ro', uri=True)
mem = sqlite3.connect(':memory:')
src.backup(mem)
# iterdump 按表名交错建表/插入。D1 开启外键后，父表尚未建好就会失败。
# 先建全表，再按外键依赖写数据，最后建立触发器，避免恢复时重算业务状态。
tables = {row[0] for row in mem.execute("SELECT name FROM sqlite_master WHERE type='table'") if not row[0].startswith(('_cf_', 'sqlite_'))}
dependencies = {table: {row[2] for row in mem.execute('PRAGMA foreign_key_list("' + table.replace('"', '""') + '")') if row[2] in tables and row[2] != table} for table in tables}
order = []
while len(order) < len(tables):
    ready = sorted(table for table, deps in dependencies.items() if table not in order and deps.issubset(order))
    if not ready:
        sys.exit('存在跨表循环外键，需先补充恢复顺序处理。')
    order.extend(ready)
create, data, rest = [], {table: [] for table in order}, []
skip = {'BEGIN TRANSACTION;', 'COMMIT;', 'PRAGMA foreign_keys=OFF;'}
sequence = []
for line in mem.iterdump():
    if line in skip or '_cf_' in line.split('(')[0]:
        continue
    if line.startswith('CREATE TABLE'):
        create.append(line)
    elif line.startswith('INSERT INTO'):
        match = re.match(r'INSERT INTO "([^"]+)"', line)
        table = match[1] if match else None
        if table == 'sqlite_sequence': sequence.append(line)
        elif table in data: data[table].append(line)
        else: rest.append(line)
    elif line.startswith('DELETE FROM "sqlite_sequence"') or line.startswith('DELETE FROM sqlite_sequence'):
        sequence.append(line)
    else:
        rest.append(line)
with out.open('w', encoding='utf-8') as stream:
    for line in [*create, *(line for table in order for line in data[table]), *sequence, *rest]:
        stream.write(line + '\n')
print(f'已导出 {len(tables)} 张表 → {out}')
