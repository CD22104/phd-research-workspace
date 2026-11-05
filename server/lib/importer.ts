// 导入流程：预览（解析 + 查重 + 合并计划）→ 确认提交（幂等）→ 可整批撤销。
// 网页、MCP、脚本都走这里，规则一致：
//  - 有可靠标识符的重复：保留一条论文，新增推荐记录，只补空字段
//  - 发表信息冲突：列出差异，只有明确选择「用新的」才改
//  - 标题相似但无标识符：疑似重复，不自动合并
//  - 个人字段（备注、我的问题）、阅读状态、笔记：导入永不覆盖
import { all, first, stmt, pick, bad, conflict, type Ctx, type WriteMeta } from '../db';
import {
  finishDraft, findDuplicate, normalizeRecord, parseAny, planMerge, safeJson,
  PAPER_FIELDS, PLACEHOLDER_TITLE, placeholderTitle, type Existing, type PaperDraft,
} from './papers';
import { byIds } from './arxiv';
import { extractPapers } from './llm';
import { nowIso, todayLocal } from './time';

export interface ImportDefaults {
  collection?: string; side?: string; rec_kind?: string; recommender?: string;
  priority?: string; depth?: string; purpose?: string;
  stage?: 'library' | 'candidate';
  create_plan?: boolean;
  project_id?: number | null; idea_id?: number | null;
}

export interface PreviewItem {
  idx: number;
  draft: PaperDraft;
  raw: any;
  origins: Record<string, string>;       // 字段 → 材料来源（例如 arXiv API）
  match?: { id: number; title: string; certain: boolean; why: string; stage?: string | null; batch?: boolean };
  merge?: ReturnType<typeof planMerge>;
  action: 'create' | 'merge' | 'skip' | 'review' | 'candidate';
  note?: string;
}

const DEFAULT_KEYS = ['collection', 'side', 'rec_kind', 'recommender', 'priority', 'depth', 'purpose'] as const;

export async function previewImport(ctx: Ctx, body: { text?: string; items?: any[]; format?: string; use_llm?: boolean; enrich?: boolean; defaults?: ImportDefaults; provider?: string }) {
  let format = body.format || 'auto';
  let parsed: Array<{ draft: PaperDraft; raw: any }>;
  if (Array.isArray(body.items)) {
    // MCP / 脚本直接给结构化条目
    parsed = body.items.map((r) => ({ draft: normalizeRecord(r).draft, raw: r }));
    format = 'items';
  } else {
    const text = String(body.text || '');
    if (!text.trim()) throw bad('没有可导入的内容');
    if (body.use_llm) {
      const recs = await extractPapers(ctx.env, body.provider || 'off', text);
      parsed = recs.map((r) => ({ draft: normalizeRecord(r).draft, raw: r }));
      format = 'llm';
    } else {
      const p = parseAny(text, format);
      parsed = p.items;
      format = p.format;
    }
  }
  const defaults = body.defaults || {};
  const warnings: string[] = [];
  const items: PreviewItem[] = parsed.map(({ draft, raw }, idx) => {
    const d: PaperDraft = { ...draft };
    for (const k of DEFAULT_KEYS) if (d[k] == null && defaults[k]) (d as any)[k] = defaults[k];
    return { idx, draft: finishDraft(d), raw, origins: {}, action: 'create' as const };
  }).filter((it) => it.draft.title || it.draft.arxiv_id || it.draft.url || it.draft.doi);

  // arXiv 补全（一次请求，最多 50 条）；只补空字段，并记下字段来源
  if (body.enrich !== false) {
    const ids = items.map((i) => i.draft.arxiv_id).filter(Boolean) as string[];
    if (ids.length) {
      try {
        const metas = await byIds(ids);
        for (const it of items) {
          const m = it.draft.arxiv_id ? metas.get(it.draft.arxiv_id) : undefined;
          if (!m) continue;
          const fill: Record<string, string | undefined> = {
            title: m.title, authors: m.authors, abstract: m.abstract, published_date: m.published_date,
            url: m.url, pdf_url: m.pdf_url, doi: m.doi, venue: m.venue_hint,
          };
          if (it.draft.title && PLACEHOLDER_TITLE.test(it.draft.title)) delete it.draft.title;
          for (const [k, v] of Object.entries(fill)) {
            if (v && ((it.draft as any)[k] == null || (it.draft as any)[k] === '')) {
              (it.draft as any)[k] = v;
              it.origins[k] = 'arXiv API';
            }
          }
        }
      } catch (e: any) {
        warnings.push(`arXiv 补全失败（${e.message}），不影响导入，之后可以在论文页再补全`);
      }
    }
  }

  const pool = await all<Existing>(ctx.db, 'SELECT * FROM papers');
  const full = new Map<number, any>(pool.map((p) => [p.id, p]));
  const batchPool: Existing[] = [];
  for (const it of items) {
    if (!it.draft.title && it.draft.arxiv_id) it.draft.title = placeholderTitle(it.draft.arxiv_id);
    if (!it.draft.title) {
      it.action = 'skip';
      it.note = '没有标题，也没有 arXiv 号，无法识别';
      continue;
    }
    // 同一批里重复出现
    const inBatch = findDuplicate(it.draft, batchPool);
    if (inBatch?.certain) {
      it.action = 'skip';
      it.match = { ...inBatch, batch: true };
      it.note = `与本批第 ${inBatch.id + 1} 条重复`;
      continue;
    }
    batchPool.push({ id: it.idx, title: it.draft.title, arxiv_id: it.draft.arxiv_id, doi: it.draft.doi, url: it.draft.url });

    const m = findDuplicate(it.draft, pool);
    if (!m) {
      it.action = defaults.stage === 'candidate' ? 'candidate' : 'create';
      continue;
    }
    it.match = m;
    it.merge = planMerge(full.get(m.id), it.draft);
    if (m.certain) {
      if (m.stage === 'rejected') {
        it.action = 'skip';
        it.note = '这篇之前已被你拒绝，不会重新出现在候选区';
      } else it.action = 'merge';
    } else {
      it.action = 'review';
      it.note = '疑似重复：请选择合并到已有论文，或作为新论文';
    }
  }
  return { format, items, warnings, count: items.length };
}

// ───────── 提交 ─────────

const PLAN_STATUS: Record<string, string> = { to_read: 'planned', reading: 'reading', done: 'done', skimmed: 'done', dropped: 'dropped' };

export interface CommitBody {
  import_key?: string;
  source: { kind: string; name?: string; channel?: string; url?: string; raw?: string; feed_item_id?: number };
  items: Array<{
    draft: PaperDraft; raw?: any; origins?: Record<string, string>;
    action: PreviewItem['action']; target_id?: number;
    resolve?: Record<string, 'keep' | 'new'>;  // 发表信息冲突的处理
    new_plan?: boolean;                       // 合并时是否另建一轮阅读计划
  }>;
  defaults?: ImportDefaults;
}

// New IDs are allocated by SQLite inside the transaction. Later statements refer to
// the rows by this transaction's unique source and insertion order, never MAX(id).
class ImportId {
  constructor(readonly sql: string, readonly params: unknown[], readonly resultIndex: number) {}
}
type RowId = number | ImportId;

class ImportBatch {
  readonly statements: D1PreparedStatement[] = [];
  private counts = new Map<string, number>();
  readonly source: ImportId;

  constructor(readonly ctx: Ctx, readonly sourceKey: string, sourceIndex: number, existingSource?: number) {
    this.source = new ImportId(existingSource == null ? '(SELECT id FROM sources WHERE import_key = ?)' : '(SELECT id FROM sources WHERE id = ?)',
      [existingSource ?? sourceKey], sourceIndex);
  }

  add(sql: string, ...params: unknown[]) {
    const values: unknown[] = [];
    let i = 0;
    const expanded = sql.replace(/\?/g, () => {
      const value = params[i++];
      if (value instanceof ImportId) {
        values.push(...value.params);
        return value.sql;
      }
      values.push(value);
      return '?';
    });
    const index = this.statements.length;
    this.statements.push(stmt(this.ctx.db, expanded, ...values));
    return index;
  }

  guard(condition: string, ...params: unknown[]) {
    // sources.kind is NOT NULL: a failed optimistic check aborts the entire batch.
    this.add(`UPDATE sources SET kind = CASE WHEN ${condition} THEN kind ELSE NULL END WHERE id = ?`, ...params, this.source);
  }

  audit(entity: string, id: RowId, op: string, field: string | null, oldValue: unknown, newValue: unknown, meta: WriteMeta = {}) {
    const enc = (v: unknown) => v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
    this.add('INSERT INTO changes(entity, entity_id, op, field, old, new, actor, origin, source_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      entity, id, op, field, enc(oldValue), enc(newValue), this.ctx.actor, meta.origin ?? null, meta.source_id ?? null, nowIso());
  }

  insert(table: 'papers' | 'reading_plans' | 'reading_logs', data: Record<string, any>, meta: WriteMeta = {}): ImportId {
    const row = pick(table, data);
    const ts = nowIso();
    const cols = [...Object.keys(row), 'created_at', 'updated_at'];
    const index = this.add(`INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`, ...Object.values(row), ts, ts);
    const offset = this.counts.get(table) || 0;
    this.counts.set(table, offset + 1);
    // Reading log IDs are only returned, never referenced by another statement.
    const id = new ImportId(table === 'reading_logs' ? '(SELECT last_insert_rowid())'
      : `(SELECT id FROM ${table} WHERE source_id = ${this.source.sql} ORDER BY id LIMIT 1 OFFSET ?)`,
      table === 'reading_logs' ? [] : [...this.source.params, offset], index);
    if (table !== 'reading_logs') this.audit(table === 'papers' ? 'paper' : 'plan', id, 'create', null, null, null, meta);
    return id;
  }

  updatePaper(cur: Record<string, any>, patch: Record<string, any>, meta: WriteMeta = {}) {
    const changed: Record<string, any> = {};
    for (const [k, v] of Object.entries(pick('papers', patch))) {
      const value = v != null && typeof v === 'object' ? JSON.stringify(v) : v;
      if (String(cur[k] ?? '') !== String(value ?? '')) changed[k] = value;
    }
    if (!Object.keys(changed).length) return;
    this.guard(`EXISTS (SELECT 1 FROM papers WHERE id = ? AND ${Object.keys(changed).map((k) => `CAST(COALESCE(${k}, '') AS TEXT) = ?`).join(' AND ')})`,
      cur.id, ...Object.keys(changed).map((k) => String(cur[k] ?? '')));
    this.add(`UPDATE papers SET ${Object.keys(changed).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...Object.values(changed), nowIso(), cur.id);
    for (const [k, v] of Object.entries(changed)) this.audit('paper', cur.id, 'update', k, cur[k], v, meta);
    Object.assign(cur, changed);
  }

  resolve(id: RowId, results: D1Result[]): number {
    if (typeof id === 'number') return id;
    return Number((results[id.resultIndex].results[0] as any).id);
  }
}

export async function commitImport(ctx: Ctx, body: CommitBody) {
  if (!body?.source?.kind) throw bad('缺少来源信息');
  if (!Array.isArray(body.items)) throw bad('缺少条目');
  const prev = body.import_key
    ? await first(ctx.db, 'SELECT id, undone_at FROM sources WHERE import_key = ?', body.import_key) : null;
  if (prev && !prev.undone_at) return { ...(await importSummary(ctx, prev.id)), replayed: true };

  const defaults = body.defaults || {};
  const today = todayLocal(ctx.tz);
  const source = { ...body.source };
  if (source.feed_item_id && !source.url) source.url = `feed_item:${source.feed_item_id}`;
  // Requests without an idempotency key use a private temporary key for SQL row
  // references. The final statement restores NULL before the transaction commits.
  const sourceKey = body.import_key || `__import_transaction_${crypto.randomUUID()}`;
  const batch = new ImportBatch(ctx, sourceKey, prev ? 1 : 0);
  if (prev) batch.add("UPDATE sources SET import_key = import_key || '#undone-' || id WHERE id = ?", prev.id);
  batch.add('INSERT INTO sources(kind, name, channel, url, raw, import_key, actor, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
    source.kind, source.name || null, source.channel || null, source.url || null,
    source.raw ? String(source.raw).slice(0, 400_000) : null, sourceKey, ctx.actor, nowIso());
  const sourceId = batch.source;
  const meta = { source_id: sourceId as unknown as number };
  const label = sourceLabel(source);
  const pool = await all<Existing>(ctx.db, 'SELECT * FROM papers');
  const papers = new Map<RowId, any>(pool.map((p) => [p.id, p]));
  const result = { source_id: sourceId as RowId, created: [] as RowId[], merged: [] as RowId[], candidates: [] as RowId[], skipped: 0, conflicts: [] as any[] };

  for (const it of body.items) {
    const draft = finishDraft(it.draft || {});
    if (!draft.title || it.action === 'skip') {
      result.skipped++;
      continue;
    }
    let action = it.action;
    let targetId: RowId | undefined = it.target_id;
    const m = findDuplicate(draft, pool);
    if (m?.certain && (action === 'create' || action === 'candidate' || action === 'review')) {
      if (m.stage === 'rejected') {
        result.skipped++;
        continue;
      }
      action = 'merge';
      targetId = m.id;
    }
    const raw = it.raw ?? draft;
    if (action === 'merge') {
      targetId ??= m?.id;
      if (!targetId) {
        action = 'create';
      } else {
        const cur = papers.get(targetId);
        if (!cur) throw bad(`要合并的论文 #${targetId} 不存在`);
        mergePaper(batch, cur, draft, it, label, result);
        addRecommendation(batch, targetId, draft, raw, 'merged');
        if (it.new_plan) createPlan(batch, targetId, draft, defaults, true);
        linkDefaults(batch, targetId, defaults);
        result.merged.push(targetId);
        continue;
      }
    }
    const candidate = action === 'candidate' || action === 'review' || defaults.stage === 'candidate' || draft.status === 'inbox';
    const row: Record<string, any> = {};
    for (const f of PAPER_FIELDS) if ((draft as any)[f] != null) row[f] = (draft as any)[f];
    row.tags = draft.tags || [];
    row.links = [];
    row.stage = candidate ? 'candidate' : 'library';
    row.possible_dup_of = action === 'review' && m ? m.id : null;
    row.added_at = draft.added_at || today;
    row.source_id = sourceId;
    const id = batch.insert('papers', row, { origin: label, ...meta });
    // The same object backs duplicate detection and merge planning, including
    // papers created or updated earlier in this transaction.
    const stored = Object.fromEntries(Object.entries(row).map(([k, v]) => [k,
      v != null && typeof v === 'object' && !(v instanceof ImportId) ? JSON.stringify(v) : v]));
    stored.id = id;
    pool.push(stored as Existing);
    papers.set(id, stored);
    addRecommendation(batch, id, draft, raw, action === 'review' ? 'duplicate_candidate' : 'created');
    if (!candidate) createPlan(batch, id, draft, defaults, false);
    linkDefaults(batch, id, defaults);
    (candidate ? result.candidates : result.created).push(id);
  }
  if (source.feed_item_id) {
    batch.add("UPDATE feed_items SET triage = CASE WHEN triage = 'done' THEN 'done' ELSE 'partial' END, source_id = COALESCE(source_id, ?), updated_at = ? WHERE id = ?",
      sourceId, nowIso(), source.feed_item_id);
  }
  if (!body.import_key) batch.add('UPDATE sources SET import_key = NULL WHERE id = ?', sourceId);

  let committed: D1Result[];
  try {
    committed = await ctx.db.batch(batch.statements);
  } catch (error) {
    // A concurrent request with the same key may have won the UNIQUE constraint.
    // Failed batches are rolled back; only a completed source can be replayed.
    if (body.import_key) {
      const winner = await first(ctx.db, 'SELECT id, undone_at FROM sources WHERE import_key = ?', body.import_key);
      if (winner && !winner.undone_at) return { ...(await importSummary(ctx, winner.id)), replayed: true };
    }
    if (String(error).includes('NOT NULL constraint failed: sources.kind')) throw conflict('论文在导入准备期间发生变化，请重新预览后再试');
    throw error;
  }
  return {
    ...result, source_id: batch.resolve(sourceId, committed),
    created: result.created.map((id) => batch.resolve(id, committed)),
    merged: result.merged.map((id) => batch.resolve(id, committed)),
    candidates: result.candidates.map((id) => batch.resolve(id, committed)),
    conflicts: result.conflicts.map((c) => ({ ...c, paper_id: batch.resolve(c.paper_id, committed) })),
  };
}

function sourceLabel(s: CommitBody['source']): string {
  const kinds: Record<string, string> = { feishu: '飞书导入', claude: 'Claude 对话', chatgpt: 'GPT 对话', paste: '粘贴导入', feed: '信息流', manual: '手动录入', api: 'API', mcp: 'MCP' };
  return [kinds[s.kind] || s.kind, s.name].filter(Boolean).join('：');
}

function mergePaper(batch: ImportBatch, cur: any, draft: PaperDraft, it: CommitBody['items'][number], label: string, result: any) {
  const mp = planMerge(cur, draft);
  const patchByOrigin = new Map<string, Record<string, any>>();
  const put = (field: string, v: any) => {
    const origin = it.origins?.[field] || label;
    if (!patchByOrigin.has(origin)) patchByOrigin.set(origin, {});
    patchByOrigin.get(origin)![field] = v;
  };
  for (const [k, v] of Object.entries(mp.fill)) put(k, v);
  for (const c of mp.conflicts) {
    if (it.resolve?.[c.field] === 'new') put(c.field, c.new);
    else if (it.resolve?.[c.field] !== 'keep') result.conflicts.push({ paper_id: cur.id, ...c });
  }
  if (mp.links.length) put('links', [...safeJson<any[]>(cur.links, []), ...mp.links]);
  for (const [origin, patch] of patchByOrigin) batch.updatePaper(cur, patch, { origin, source_id: batch.source as unknown as number });
}

function addRecommendation(batch: ImportBatch, paperId: RowId, d: PaperDraft, raw: any, action: string) {
  batch.add('INSERT INTO recommendations(paper_id, source_id, kind, recommender, reason, raw, action, created_at) VALUES (?,?,?,?,?,?,?,?)',
    paperId, batch.source, d.rec_kind || null, d.recommender || null, d.rec_reason || null,
    raw == null ? null : JSON.stringify(raw).slice(0, 20_000), action, nowIso());
}

function createPlan(batch: ImportBatch, paperId: RowId, d: PaperDraft, defaults: ImportDefaults, force: boolean) {
  const hasPlanInfo = d.status || d.priority || d.depth || d.focus_sections || d.purpose || d.criteria;
  if (!force && !hasPlanInfo && !defaults.create_plan) return;
  const status = PLAN_STATUS[d.status || 'to_read'] || 'planned';
  const depth = d.depth || (d.status === 'skimmed' ? '速览' : null);
  const planId = batch.insert('reading_plans', {
    paper_id: paperId, purpose: d.purpose || defaults.purpose || null, priority: d.priority || defaults.priority || null,
    depth: depth || defaults.depth || null, focus_sections: d.focus_sections || null, criteria: d.criteria || null,
    status, done_at: status === 'done' ? d.finished_at || null : null,
    project_id: defaults.project_id || null, idea_id: defaults.idea_id || null, source_id: batch.source,
  }, { source_id: batch.source as unknown as number });
  if (status === 'done' && d.finished_at) {
    batch.insert('reading_logs', { paper_id: paperId, plan_id: planId, date: d.finished_at, sections: d.focus_sections || null });
  }
}

function linkDefaults(batch: ImportBatch, paperId: RowId, defaults: ImportDefaults) {
  const ts = nowIso();
  if (defaults.project_id) batch.add('INSERT OR IGNORE INTO project_links(project_id, item_type, item_id, created_at) VALUES (?,?,?,?)', defaults.project_id, 'paper', paperId, ts);
  if (defaults.idea_id) batch.add('INSERT OR IGNORE INTO idea_papers(idea_id, paper_id, relation, created_at) VALUES (?,?,?,?)', defaults.idea_id, paperId, '相关工作', ts);
}

export async function importSummary(ctx: Ctx, sourceId: number) {
  const recs = await all(ctx.db, 'SELECT paper_id, action FROM recommendations WHERE source_id = ?', sourceId);
  const src = await first(ctx.db, 'SELECT id, kind, name, undone_at FROM sources WHERE id = ?', sourceId);
  const papers = await all(ctx.db, "SELECT id, stage FROM papers WHERE source_id = ?", sourceId);
  const cand = new Set(papers.filter((p: any) => p.stage === 'candidate').map((p: any) => p.id));
  return {
    source_id: sourceId, source: src,
    created: recs.filter((r: any) => r.action === 'created' && !cand.has(r.paper_id)).map((r: any) => r.paper_id),
    candidates: recs.filter((r: any) => r.action !== 'merged' && cand.has(r.paper_id)).map((r: any) => r.paper_id),
    merged: recs.filter((r: any) => r.action === 'merged').map((r: any) => r.paper_id),
    skipped: 0, conflicts: [],
  };
}

// ───────── 撤销 ─────────

export async function undoImport(ctx: Ctx, sourceId: number) {
  const src = await first(ctx.db, 'SELECT * FROM sources WHERE id = ?', sourceId);
  if (!src) throw bad('来源不存在');
  if (src.undone_at) return { already: true, deleted: [], reverted: [], kept: [] };
  const deleted: number[] = [];
  const kept: Array<{ id: number; why: string }> = [];
  const reverted: Array<{ id: number; field: string }> = [];

  // One snapshot includes both newly created papers and existing merge targets.
  // Correlated checks retain the same protections as the previous per-paper reads.
  const papers = await all(ctx.db, `SELECT p.*,
    (SELECT COUNT(*) FROM changes WHERE entity = 'paper' AND entity_id = p.id AND op = 'update' AND (source_id IS NULL OR source_id != ?1)) AS edits,
    (SELECT COUNT(*) FROM notes WHERE paper_id = p.id) AS notes,
    (SELECT COUNT(*) FROM reading_logs l LEFT JOIN reading_plans rp ON rp.id = l.plan_id WHERE l.paper_id = p.id AND (rp.source_id IS NULL OR rp.source_id != ?1)) AS logs,
    (SELECT COUNT(*) FROM sessions WHERE paper_id = p.id) AS sessions,
    (SELECT COUNT(*) FROM tasks t WHERE t.paper_id = p.id OR EXISTS (SELECT 1 FROM json_each(t.paper_ids) j WHERE j.value = p.id)
      OR t.plan_id IN (SELECT id FROM reading_plans WHERE paper_id = p.id)) AS task_links,
    (SELECT COUNT(*) FROM goal_tasks t WHERE t.paper_id = p.id OR EXISTS (SELECT 1 FROM json_each(t.paper_ids) j WHERE j.value = p.id)
      OR t.plan_id IN (SELECT id FROM reading_plans WHERE paper_id = p.id)) AS goal_task_links,
    (SELECT COUNT(*) FROM recommendations WHERE paper_id = p.id AND (source_id IS NULL OR source_id != ?1)) AS recs,
    (SELECT COUNT(*) FROM reading_plans WHERE paper_id = p.id AND (source_id IS NULL OR source_id != ?1)) AS plans
    FROM papers p WHERE p.source_id = ?1 OR p.id IN
      (SELECT entity_id FROM changes WHERE source_id = ?1 AND entity = 'paper' AND op = 'update')`, sourceId);
  const current = new Map<number, any>(papers.map((p: any) => [p.id, p]));
  const edits = await all(ctx.db, "SELECT * FROM changes WHERE source_id = ? AND entity = 'paper' AND op = 'update' ORDER BY id DESC", sourceId);
  const batch = new ImportBatch(ctx, '', 0, sourceId);
  batch.guard('(SELECT undone_at FROM sources WHERE id = ?) IS NULL', sourceId);

  for (const paper of papers as any[]) {
    if (paper.source_id !== sourceId) continue;
    const id = paper.id;
    const why = [
      paper.edits && '你改过它的字段', paper.notes && '已有笔记', paper.logs && '已有阅读记录', paper.sessions && '有计时记录',
      paper.recs && '也来自其他来源', paper.plans && '有其他阅读计划', paper.task_links && '已安排到日计划', paper.goal_task_links && '已关联周子任务',
    ].filter(Boolean);
    if (why.length) {
      kept.push({ id, why: why.join('、') });
      continue;
    }
    // If a user changed this paper while the batch was being prepared, abort and
    // let the next preview explain why it must be kept. Never delete a stale view.
    batch.guard(`EXISTS (SELECT 1 FROM papers p WHERE p.id = ? AND p.updated_at IS ?
      AND NOT EXISTS (SELECT 1 FROM changes WHERE entity = 'paper' AND entity_id = p.id AND op = 'update' AND (source_id IS NULL OR source_id != ?))
      AND NOT EXISTS (SELECT 1 FROM notes WHERE paper_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM reading_logs l LEFT JOIN reading_plans rp ON rp.id = l.plan_id WHERE l.paper_id = p.id AND (rp.source_id IS NULL OR rp.source_id != ?))
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE paper_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.paper_id = p.id OR EXISTS (SELECT 1 FROM json_each(t.paper_ids) j WHERE j.value = p.id)
        OR t.plan_id IN (SELECT id FROM reading_plans WHERE paper_id = p.id))
      AND NOT EXISTS (SELECT 1 FROM goal_tasks t WHERE t.paper_id = p.id OR EXISTS (SELECT 1 FROM json_each(t.paper_ids) j WHERE j.value = p.id)
        OR t.plan_id IN (SELECT id FROM reading_plans WHERE paper_id = p.id))
      AND NOT EXISTS (SELECT 1 FROM recommendations WHERE paper_id = p.id AND (source_id IS NULL OR source_id != ?))
      AND NOT EXISTS (SELECT 1 FROM reading_plans WHERE paper_id = p.id AND (source_id IS NULL OR source_id != ?)))`,
      id, paper.updated_at, sourceId, sourceId, sourceId, sourceId);
    batch.add('DELETE FROM reading_logs WHERE paper_id = ?', id);
    batch.add('DELETE FROM reading_plans WHERE paper_id = ?', id);
    batch.add('DELETE FROM project_links WHERE item_type = ? AND item_id = ?', 'paper', id);
    batch.add('DELETE FROM idea_papers WHERE paper_id = ?', id);
    batch.add('DELETE FROM papers WHERE id = ?', id);
    batch.audit('paper', id, 'delete', null, null, null, { origin: '撤销导入', source_id: sourceId });
    deleted.push(id);
  }

  const deletedIds = new Set(deleted);
  for (const c of edits as any[]) {
    if (deletedIds.has(c.entity_id)) continue;
    const cur = current.get(c.entity_id);
    if (!cur || String(cur[c.field] ?? '') !== String(c.new ?? '')) continue;
    batch.updatePaper(cur, { [c.field]: c.old }, { origin: '撤销导入', source_id: sourceId });
    reverted.push({ id: c.entity_id, field: c.field });
  }
  batch.add(`DELETE FROM reading_plans WHERE source_id = ? AND status = 'planned'
    AND id NOT IN (SELECT plan_id FROM reading_logs WHERE plan_id IS NOT NULL
      UNION SELECT plan_id FROM tasks WHERE plan_id IS NOT NULL
      UNION SELECT plan_id FROM goal_tasks WHERE plan_id IS NOT NULL
      UNION SELECT plan_id FROM sessions WHERE plan_id IS NOT NULL
      UNION SELECT plan_id FROM notes WHERE plan_id IS NOT NULL)`, sourceId);
  // Remaining papers created by this source are exactly the protected/kept set.
  // Using a subquery also avoids D1's 100-bound-parameter limit for large imports.
  batch.add('DELETE FROM recommendations WHERE source_id = ? AND paper_id NOT IN (SELECT id FROM papers WHERE source_id = ?)', sourceId, sourceId);
  batch.add("UPDATE sources SET undone_at = ?, import_key = CASE WHEN import_key IS NULL THEN NULL ELSE import_key || '#undone-' || id END WHERE id = ?", nowIso(), sourceId);
  try {
    await ctx.db.batch(batch.statements);
  } catch (error) {
    const fresh = await first(ctx.db, 'SELECT undone_at FROM sources WHERE id = ?', sourceId);
    if (fresh?.undone_at) return { already: true, deleted: [], reverted: [], kept: [] };
    if (String(error).includes('NOT NULL constraint failed: sources.kind')) throw conflict('导入记录在撤销准备期间发生变化，请重新预览后再试');
    throw error;
  }
  return { deleted, reverted, kept };
}
