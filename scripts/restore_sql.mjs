// Restore a SQLite export to isolated local D1 with bound values. Large source/audit
// fields can exceed D1's 100 KB SQL-text limit when restored as INSERT literals.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
const [sqlFile, destination] = process.argv.slice(2);
if (!sqlFile || !destination) throw new Error('Usage: node scripts/restore_sql.mjs snapshot.sql temporary-directory');
const parsed = join(destination, 'parsed-snapshot.json');
execFileSync('python3', ['-c', `import json,sqlite3,sys
from pathlib import Path
con=sqlite3.connect(':memory:')
con.executescript(Path(sys.argv[1]).read_text())
con.row_factory=sqlite3.Row
objects=list(con.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"))
tables=[dict(x) for x in objects if x['type']=='table']
rows=[]
for table in tables:
    name=table['name']
    quoted='"'+name.replace('"','""')+'"'
    columns=[c['name'] for c in con.execute('PRAGMA table_info('+quoted+')')]
    rows.append({'name':name,'columns':columns,'values':[list(r) for r in con.execute('SELECT * FROM '+quoted)]})
sequence=[list(x) for x in con.execute('SELECT name,seq FROM sqlite_sequence')]
Path(sys.argv[2]).write_text(json.dumps({'tables':tables,'rows':rows,'sequence':sequence,'after':[dict(x) for x in objects if x['type']!='table']}))
`, sqlFile, parsed]);
const snapshot = JSON.parse(readFileSync(parsed, 'utf8'));
const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("restore");}}', compatibilityDate: '2025-07-18', d1Persist: join(destination, 'v3/d1'), d1Databases: { RESTORE: 'restore-validation' } });
const quote = s => '"' + s.replaceAll('"','""') + '"';
try {
  const db = await mf.getD1Database('RESTORE');
  await db.batch(snapshot.tables.map(t => db.prepare(t.sql)));
  // Deferred constraints cover data order, including self references and cycles.
  const statements = [db.prepare('PRAGMA defer_foreign_keys=ON')];
  for (const table of snapshot.rows) {
    const insert = `INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`;
    for (const row of table.values) statements.push(db.prepare(insert).bind(...row));
  }
  await db.batch(statements);
  await db.prepare('DELETE FROM sqlite_sequence').run();
  if (snapshot.sequence.length) await db.batch(snapshot.sequence.map(row => db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)').bind(...row)));
  if (snapshot.after.length) await db.batch(snapshot.after.map(x => db.prepare(x.sql)));
} finally { await mf.dispose(); }
