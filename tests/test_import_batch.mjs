// Isolated D1 integration tests. Run: node --test tests/test_import_batch.mjs
// Nothing here reads credentials, calls the network, or uses a persistent database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('../', import.meta.url));
const tables = ['sources', 'papers', 'recommendations', 'reading_plans', 'reading_logs', 'changes', 'project_links', 'idea_papers'];
const budget = 45; // Leave room below the free-plan limit for request middleware.
let temporaryDirectory;
let mf;
let importer;
let schemaStatements;

before(async () => {
  // SQLite recognizes whole trigger bodies; splitting at semicolons corrupts migrations.
  schemaStatements = JSON.parse(execFileSync('python3', ['-c', `
import json, pathlib, sqlite3, sys
statements = []
for path in sorted((pathlib.Path(sys.argv[1]) / 'migrations').glob('*.sql')):
    pending = ''
    for line in path.read_text().splitlines(True):
        pending += line
        if sqlite3.complete_statement(pending):
            statements.append(pending)
            pending = ''
    assert not pending.strip(), path
print(json.dumps(statements))
`, root], { encoding: 'utf8' }));
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'honey-import-batch-'));
  const bundle = join(temporaryDirectory, 'importer.mjs');
  await build({
    entryPoints: [join(root, 'server/lib/importer.ts')], outfile: bundle,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  });
  importer = await import(pathToFileURL(bundle).href);
  mf = new Miniflare({
    modules: true, script: 'export default { fetch() { return new Response("test"); } };',
    compatibilityDate: '2025-07-18',
    d1Databases: { BULK: 'bulk', FAILED: 'failed', MERGE: 'merge', SAME_BATCH: 'same-batch', CONCURRENT: 'concurrent', GUARD: 'guard', GUARD_UNDO: 'guard-undo', LINKS: 'links', GUARD_LINKS: 'guard-links' },
  });
});

after(async () => {
  await mf?.dispose();
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

// Count actual binding executions, not individual SQL statements inside a batch.
// Native D1 receives its original statement objects, never the counting proxies.
function countedDatabase(database) {
  const nativeStatements = new WeakMap();
  let calls = 0;
  function wrap(statement) {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...values) => wrap(target.bind(...values));
        if (['first', 'all', 'run', 'raw'].includes(property)) {
          return (...args) => { calls++; return target[property](...args); };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    nativeStatements.set(proxy, statement);
    return proxy;
  }
  const db = new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') return (sql) => wrap(target.prepare(sql));
      if (property === 'batch') return (statements) => {
        calls++;
        return target.batch(statements.map((s) => nativeStatements.get(s) ?? s));
      };
      if (property === 'exec') return (...args) => { calls++; return target.exec(...args); };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db, reset: () => { calls = 0; }, count: () => calls };
}

async function fixture(binding) {
  const raw = await mf.getD1Database(binding);
  await raw.batch(schemaStatements.map((sql) => raw.prepare(sql)));
  const counter = countedDatabase(raw);
  const ctx = { db: counter.db, env: { DB: counter.db }, actor: 'script', tz: 'Asia/Singapore' };
  return { raw, ctx, counter };
}

async function withinBudget(t, fixture, label, action) {
  fixture.counter.reset();
  const result = await action();
  const calls = fixture.counter.count();
  t.diagnostic(`${label}: ${calls} D1 binding calls`);
  assert.ok(calls <= budget, `${label} used ${calls} binding calls (budget ${budget})`);
  return result;
}

async function snapshot(db) {
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table,
    (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results,
  ])));
}

async function counts(db) {
  return Object.fromEntries(await Promise.all(tables.map(async (table) => [table,
    await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'),
  ])));
}

function bulkItems() {
  return Array.from({ length: 72 }, (_, i) => ({
    title: `Paper ${i + 1}: ${['Retrieval', 'Planning', 'Tools', 'Reasoning'][i % 4]} research`,
    arxiv_id: `2609.${String(i + 1).padStart(5, '0')}`,
    status: i < 9 ? 'done' : i === 9 ? 'dropped' : 'to_read',
    ...(i < 4 || i === 9 ? { finished_at: '2026-09-25' } : {}),
    rec_kind: '飞书迁移', tags: ['Agent'], priority: 'P1',
  }));
}

function commitBody(items, key) {
  return {
    import_key: key, source: { kind: 'feishu', name: '批量测试', raw: '原文\n第二行' },
    items: items.map((item) => ({ draft: item.draft ?? item, action: item.action ?? 'create', raw: item.raw ?? item })),
  };
}

test('72-paper preview, commit, replay and atomic undo stay within the binding budget', async (t) => {
  const f = await fixture('BULK');
  const input = bulkItems();
  const preview = await withinBudget(t, f, 'empty preview', () => importer.previewImport(f.ctx, { items: input, enrich: false }));
  assert.equal(preview.count, 72);
  assert.ok(preview.items.every((item) => item.action === 'create'));

  const body = commitBody(preview.items, 'bulk-72');
  const committed = await withinBudget(t, f, 'commit 72', () => importer.commitImport(f.ctx, structuredClone(body)));
  assert.equal(committed.created.length, 72);
  assert.equal(new Set(committed.created).size, 72);
  assert.deepEqual(committed.merged, []);
  assert.deepEqual(await counts(f.raw), {
    sources: 1, papers: 72, recommendations: 72, reading_plans: 72, reading_logs: 4, changes: 144, project_links: 0, idea_papers: 0,
  });
  assert.deepEqual((await f.raw.prepare('SELECT status, COUNT(*) AS n FROM reading_plans GROUP BY status ORDER BY status').all()).results,
    [{ status: 'done', n: 9 }, { status: 'dropped', n: 1 }, { status: 'planned', n: 62 }]);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM reading_logs l JOIN reading_plans p ON p.id = l.plan_id JOIN papers a ON a.id = l.paper_id WHERE p.paper_id = a.id AND p.source_id = a.source_id').first('n'), 4);
  assert.equal(await f.raw.prepare("SELECT COUNT(*) AS n FROM changes WHERE source_id = ? AND actor = 'script' AND op = 'create'").bind(committed.source_id).first('n'), 144);
  assert.equal(await f.raw.prepare('SELECT raw FROM sources WHERE id = ?').bind(committed.source_id).first('raw'), body.source.raw);

  const secondPreview = await withinBudget(t, f, 'existing preview 72', () => importer.previewImport(f.ctx, { items: input, enrich: false }));
  assert.ok(secondPreview.items.every((item) => item.action === 'merge' && item.match.certain));
  const beforeReplay = await snapshot(f.raw);
  const replay = await withinBudget(t, f, 'same-key replay', () => importer.commitImport(f.ctx, structuredClone(body)));
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.created, committed.created);
  assert.deepEqual(await snapshot(f.raw), beforeReplay);

  // Fail halfway through the deletions; earlier deletions and audits must roll back.
  await f.raw.prepare(`CREATE TRIGGER fail_undo BEFORE DELETE ON papers WHEN OLD.id = ${committed.created[35]} BEGIN SELECT RAISE(ABORT, 'test undo failure'); END`).run();
  await assert.rejects(importer.undoImport(f.ctx, committed.source_id), /test undo failure/);
  assert.deepEqual(await snapshot(f.raw), beforeReplay);
  assert.equal(await f.raw.prepare('SELECT undone_at FROM sources WHERE id = ?').bind(committed.source_id).first('undone_at'), null);
  await f.raw.prepare('DROP TRIGGER fail_undo').run();

  const undone = await withinBudget(t, f, 'undo 72', () => importer.undoImport(f.ctx, committed.source_id));
  assert.deepEqual([...undone.deleted].sort((a, b) => a - b), [...committed.created].sort((a, b) => a - b));
  assert.deepEqual(undone.kept, []);
  assert.deepEqual(await counts(f.raw), {
    sources: 1, papers: 0, recommendations: 0, reading_plans: 0, reading_logs: 0, changes: 216, project_links: 0, idea_papers: 0,
  });
  const source = await f.raw.prepare('SELECT import_key, undone_at FROM sources WHERE id = ?').bind(committed.source_id).first();
  assert.ok(source.undone_at);
  assert.equal(source.import_key, `bulk-72#undone-${committed.source_id}`);
  const afterUndo = await snapshot(f.raw);
  assert.equal((await importer.undoImport(f.ctx, committed.source_id)).already, true);
  assert.deepEqual(await snapshot(f.raw), afterUndo);
  const reimport = await withinBudget(t, f, 'reimport after undo', () => importer.commitImport(f.ctx, structuredClone(body)));
  assert.equal(reimport.created.length, 72);
  assert.notEqual(reimport.source_id, committed.source_id);
  assert.ok(!reimport.replayed);
});

test('a mid-import D1 failure rolls back papers, plans, audits and the idempotency key', async (t) => {
  const f = await fixture('FAILED');
  const body = commitBody(bulkItems(), 'retry-after-failure');
  body.items[35].draft.recommender = 'fail-here';
  const before = await snapshot(f.raw);
  await f.raw.prepare("CREATE TRIGGER fail_import BEFORE INSERT ON recommendations WHEN NEW.recommender = 'fail-here' BEGIN SELECT RAISE(ABORT, 'test import failure'); END").run();
  await assert.rejects(importer.commitImport(f.ctx, structuredClone(body)), /test import failure/);
  assert.deepEqual(await snapshot(f.raw), before);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM sources WHERE import_key = ?').bind(body.import_key).first('n'), 0);
  await f.raw.prepare('DROP TRIGGER fail_import').run();
  const committed = await withinBudget(t, f, 'retry failed commit', () => importer.commitImport(f.ctx, structuredClone(body)));
  assert.equal(committed.created.length, 72);
  assert.ok(!committed.replayed);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM recommendations').first('n'), 72);
});

test('concurrent commits with the same key create exactly one complete source', async () => {
  const f = await fixture('CONCURRENT');
  const body = commitBody(bulkItems(), 'concurrent-72');
  const results = await Promise.all([
    importer.commitImport(f.ctx, structuredClone(body)),
    importer.commitImport(f.ctx, structuredClone(body)),
  ]);
  assert.equal(results[0].source_id, results[1].source_id);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.deepEqual(results[0].created, results[1].created);
  assert.deepEqual(await counts(f.raw), {
    sources: 1, papers: 72, recommendations: 72, reading_plans: 72, reading_logs: 4, changes: 144, project_links: 0, idea_papers: 0,
  });
});

test('same-batch duplicate merges refer to the newly created paper and preserve the field audit', async (t) => {
  const f = await fixture('SAME_BATCH');
  const body = commitBody([
    { title: 'A newly created paper', arxiv_id: '2609.90001', status: 'to_read' },
    { title: 'A newly created paper', arxiv_id: '2609.90001', abstract: 'Filled by its second recommendation', status: 'to_read' },
  ], 'same-batch');
  body.items[1].origins = { abstract: 'arXiv API' };
  body.items[1].new_plan = true;
  const result = await withinBudget(t, f, 'same-batch create and merge', () => importer.commitImport(f.ctx, body));
  assert.equal(result.created.length, 1);
  assert.deepEqual(result.merged, result.created);
  const id = result.created[0];
  assert.equal(await f.raw.prepare('SELECT abstract FROM papers WHERE id = ?').bind(id).first('abstract'), body.items[1].draft.abstract);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM reading_plans WHERE paper_id = ?').bind(id).first('n'), 2);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM recommendations WHERE paper_id = ?').bind(id).first('n'), 2);
  const audit = await f.raw.prepare("SELECT entity_id, old, new, origin, source_id FROM changes WHERE entity = 'paper' AND field = 'abstract'").first();
  assert.deepEqual(audit, { entity_id: id, old: null, new: body.items[1].draft.abstract, origin: 'arXiv API', source_id: result.source_id });
  const undo = await withinBudget(t, f, 'undo same-batch merge', () => importer.undoImport(f.ctx, result.source_id));
  assert.deepEqual(undo.deleted, [id]);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM papers').first('n'), 0);
});

test('merge keeps personal fields and unresolved conflicts; undo restores untouched imported fields', async (t) => {
  const f = await fixture('MERGE');
  const base = await importer.commitImport(f.ctx, commitBody([
    { title: 'Existing paper', arxiv_id: '2609.90002', venue: 'ICLR 2026', my_note: 'My own note', my_question: 'My own question', tags: ['original'] },
  ], 'base'));
  const id = base.created[0];
  const body = {
    import_key: 'merge-existing', source: { kind: 'chatgpt', name: 'Merge source' },
    items: [{ action: 'merge', target_id: id, origins: { abstract: 'arXiv API' }, new_plan: true,
      draft: { title: 'Existing paper', arxiv_id: '2609.90002', venue: 'NeurIPS 2026', abstract: 'Imported abstract', summary: 'Imported summary', my_note: 'Do not replace', my_question: 'Do not replace', tags: ['additional'] } }],
  };
  const result = await withinBudget(t, f, 'merge existing paper', () => importer.commitImport(f.ctx, body));
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].field, 'venue');
  let paper = await f.raw.prepare('SELECT * FROM papers WHERE id = ?').bind(id).first();
  assert.equal(paper.venue, 'ICLR 2026');
  assert.equal(paper.my_note, 'My own note');
  assert.equal(paper.my_question, 'My own question');
  assert.equal(paper.abstract, 'Imported abstract');
  assert.deepEqual(JSON.parse(paper.tags), ['original', 'additional']);
  assert.equal(await f.raw.prepare("SELECT origin FROM changes WHERE source_id = ? AND field = 'abstract'").bind(result.source_id).first('origin'), 'arXiv API');
  assert.equal(await f.raw.prepare("SELECT origin FROM changes WHERE source_id = ? AND field = 'summary'").bind(result.source_id).first('origin'), 'GPT 对话：Merge source');

  // A later user change survives even when this import's other changes are undone.
  await f.raw.prepare('UPDATE papers SET summary = ? WHERE id = ?').bind('Later personal summary', id).run();
  const undone = await withinBudget(t, f, 'undo existing merge', () => importer.undoImport(f.ctx, result.source_id));
  assert.deepEqual(undone.deleted, []);
  assert.ok(undone.reverted.some((r) => r.id === id && r.field === 'abstract'));
  assert.ok(!undone.reverted.some((r) => r.field === 'summary'));
  paper = await f.raw.prepare('SELECT * FROM papers WHERE id = ?').bind(id).first();
  assert.equal(paper.abstract, null);
  assert.equal(paper.summary, 'Later personal summary');
  assert.equal(paper.venue, 'ICLR 2026');
  assert.equal(paper.my_note, 'My own note');
  assert.deepEqual(JSON.parse(paper.tags), ['original']);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM reading_plans WHERE source_id = ?').bind(result.source_id).first('n'), 0);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM recommendations WHERE source_id = ?').bind(base.source_id).first('n'), 1);
});


// Inject a real concurrent write after pre-reads and immediately before the
// transaction reaches D1. The statements still execute against native D1.
function beforeNextBatch(ctx, beforeBatch) {
  let injected = false;
  const db = new Proxy(ctx.db, {
    get(target, property) {
      if (property === 'batch') return async (statements) => {
        if (!injected) {
          injected = true;
          await beforeBatch();
        }
        return target.batch(statements);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...ctx, db, env: { ...ctx.env, DB: db } };
}

test('a concurrent field edit rejects stale import with 409 and leaves no partial source', async () => {
  const f = await fixture('GUARD');
  const base = await importer.commitImport(f.ctx, commitBody([
    { title: 'Concurrent field update', arxiv_id: '2609.90003' },
  ], 'guard-base'));
  const id = base.created[0];
  const body = {
    import_key: 'guard-merge', source: { kind: 'api', name: 'Stale merge' },
    items: [
      { action: 'create', draft: { title: 'Must roll back too', arxiv_id: '2609.90004', status: 'to_read' } },
      { action: 'merge', target_id: id, draft: { title: 'Concurrent field update', arxiv_id: '2609.90003', abstract: 'Stale imported abstract' } },
    ],
  };
  let afterConcurrentEdit;
  const ctx = beforeNextBatch(f.ctx, async () => {
    await f.raw.prepare('UPDATE papers SET abstract = ? WHERE id = ?').bind('Written by the user', id).run();
    afterConcurrentEdit = await snapshot(f.raw);
  });
  await assert.rejects(importer.commitImport(ctx, body),
    (error) => error.status === 409 && /重新/.test(error.message));
  assert.ok(afterConcurrentEdit, 'the concurrent write was injected before the transaction');
  assert.deepEqual(await snapshot(f.raw), afterConcurrentEdit);
  assert.equal(await f.raw.prepare('SELECT abstract FROM papers WHERE id = ?').bind(id).first('abstract'), 'Written by the user');
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM sources WHERE import_key = ?').bind(body.import_key).first('n'), 0);
});

test('a note added during undo preparation rejects deletion with 409 and preserves the whole batch', async () => {
  const f = await fixture('GUARD_UNDO');
  const base = await importer.commitImport(f.ctx, commitBody([
    { title: 'First concurrent undo paper', arxiv_id: '2609.90005', status: 'to_read' },
    { title: 'Second concurrent undo paper', arxiv_id: '2609.90006', status: 'to_read' },
  ], 'guard-undo'));
  let afterConcurrentNote;
  const ctx = beforeNextBatch(f.ctx, async () => {
    await f.raw.prepare('INSERT INTO notes(paper_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .bind(base.created[1], 'A note written while undo was preparing', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z').run();
    afterConcurrentNote = await snapshot(f.raw);
  });
  await assert.rejects(importer.undoImport(ctx, base.source_id),
    (error) => error.status === 409 && /重新/.test(error.message));
  assert.ok(afterConcurrentNote, 'the concurrent note was inserted before the transaction');
  assert.deepEqual(await snapshot(f.raw), afterConcurrentNote);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM papers').first('n'), 2);
  assert.deepEqual((await f.raw.prepare('SELECT paper_id, content FROM notes').all()).results,
    [{ paper_id: base.created[1], content: 'A note written while undo was preparing' }]);
  assert.equal(await f.raw.prepare('SELECT undone_at FROM sources WHERE id = ?').bind(base.source_id).first('undone_at'), null);
});


test('undo keeps papers selected by weekly subtasks and multi-paper daily tasks', async (t) => {
  const f = await fixture('LINKS');
  const base = await importer.commitImport(f.ctx, commitBody([
    { title: 'Weekly selected paper', arxiv_id: '2609.90101', status: 'to_read' },
    { title: 'Daily selected paper', arxiv_id: '2609.90102', status: 'to_read' },
    { title: 'Unused paper', arxiv_id: '2609.90103', status: 'to_read' },
  ], 'selected-papers'));
  const stamp = '2026-09-26T00:00:00.000Z';
  const g = await f.raw.prepare("INSERT INTO goals(week_id,title,created_at,updated_at) VALUES ('2026-09-21','Weekly research',?,?)").bind(stamp,stamp).run();
  const plan = await f.raw.prepare('SELECT id FROM reading_plans WHERE paper_id = ?').bind(base.created[0]).first('id');
  await f.raw.prepare('INSERT INTO goal_tasks(goal_id,title,paper_ids,plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(g.meta.last_row_id,'Read selected papers',JSON.stringify([base.created[0]]),plan,stamp,stamp).run();
  await f.raw.prepare("INSERT INTO tasks(date,title,paper_ids,created_at,updated_at) VALUES ('2026-09-26','Read today',?,?,?)")
    .bind(JSON.stringify([base.created[1]]),stamp,stamp).run();
  const undone = await withinBudget(t,f,'undo with task references',()=>importer.undoImport(f.ctx,base.source_id));
  assert.deepEqual(undone.deleted,[base.created[2]]);
  assert.deepEqual(undone.kept.map(p=>p.id).sort(),base.created.slice(0,2).sort());
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM reading_plans WHERE id = ?').bind(plan).first('n'),1);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM papers').first('n'),2);
});

test('a concurrent task selection aborts undo rather than deleting the selected paper', async () => {
  const f = await fixture('GUARD_LINKS');
  const base = await importer.commitImport(f.ctx,commitBody([{title:'Concurrent task paper',arxiv_id:'2609.90104'}],'task-selection-race'));
  const ctx = beforeNextBatch(f.ctx,async()=> {
    await f.raw.prepare("INSERT INTO tasks(date,title,paper_ids,created_at,updated_at) VALUES ('2026-09-26','Selected during undo',?,'2026-09-26','2026-09-26')")
      .bind(JSON.stringify(base.created)).run();
  });
  await assert.rejects(importer.undoImport(ctx,base.source_id),error=>error.status===409);
  assert.equal(await f.raw.prepare('SELECT COUNT(*) AS n FROM papers').first('n'),1);
  assert.equal(await f.raw.prepare('SELECT undone_at FROM sources WHERE id=?').bind(base.source_id).first('undone_at'),null);
});
