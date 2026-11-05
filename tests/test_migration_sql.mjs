import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { unstable_splitSqlQuery } from 'wrangler';
test('Wrangler splits migrations into individually executable SQLite statements', () => {
  const statements = readdirSync(new URL('../migrations/', import.meta.url)).filter(x => x.endsWith('.sql')).sort()
    .flatMap(x => unstable_splitSqlQuery(readFileSync(new URL('../migrations/' + x, import.meta.url), 'utf8')));
  execFileSync('python3', ['-c', `import json,sqlite3,sys
con=sqlite3.connect(':memory:')
con.execute('PRAGMA foreign_keys=ON')
for statement in json.load(sys.stdin):
    con.execute(statement)
assert len(list(con.execute("SELECT name FROM sqlite_master WHERE type='trigger'"))) >= 12
`], { input: JSON.stringify(statements), encoding: 'utf8' });
});
