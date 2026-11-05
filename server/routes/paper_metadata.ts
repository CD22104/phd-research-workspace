// 有预览、字段审计和整批撤销的元数据整理；不修改个人笔记或阅读记录。
import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, stmt, type Ctx } from '../db';
import { finishDraft } from '../lib/papers';
import { nowIso } from '../lib/time';
import { body } from './planning';

const FIELDS = new Set(['title', 'short_name', 'authors', 'team', 'venue', 'published_date', 'url', 'pdf_url', 'code_url',
  'arxiv_id', 'doi', 'abstract', 'summary', 'collection', 'side', 'direction', 'tags',
  'material_type', 'verification_status', 'verification_note', 'verified_at']);
const encode = (value: any) => value != null && typeof value === 'object' ? JSON.stringify(value) : value ?? null;

async function summary(ctx: Ctx, sourceId: number, replayed = false) {
  const rows = await all(ctx.db, "SELECT entity_id, field FROM changes WHERE source_id = ? AND entity = 'paper' AND op = 'update'", sourceId);
  return { source_id: sourceId, changed_papers: [...new Set(rows.map(r => r.entity_id))], changed_fields: rows.length, replayed };
}

export function registerPaperMetadata(app: App) {
  app.post('/papers/metadata-batch', async c => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) throw bad('每批应包含 1–100 篇论文');
    if (typeof b.import_key !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(b.import_key)) throw bad('请提供有效的批次编号');
    const key = 'metadata-' + b.import_key;
    const prior = await first(ctx.db, 'SELECT id, undone_at FROM sources WHERE import_key = ?', key);
    if (prior && !prior.undone_at) return json(c, await summary(ctx, prior.id, true));
    if (prior) throw conflict('这批整理已撤销，请使用新的批次编号重新预览');
    const papers = new Map((await all(ctx.db, 'SELECT * FROM papers')).map(p => [p.id, p]));
    const seen = new Set<number>();
    const changes: Array<{ id: number; title: string; updated_at: string; patch: Record<string, any>; old: any; origins: Record<string, string> }> = [];
    for (const item of b.items) {
      if (!Number.isInteger(item.id) || item.id <= 0 || seen.has(item.id)) throw bad('论文编号必须唯一且为正整数');
      seen.add(item.id);
      const current = papers.get(item.id);
      if (!current) throw bad(`论文 #${item.id} 不存在`);
      if (typeof item.expected_updated_at !== 'string' || item.expected_updated_at !== current.updated_at) throw conflict(`论文 #${item.id} 已有更新，请重新读取后预览`);
      if (!item.patch || typeof item.patch !== 'object' || Array.isArray(item.patch)) throw bad('缺少元数据字段');
      if (Object.keys(item.patch).some(k => !FIELDS.has(k))) throw bad('本接口只能整理资料字段，不能修改个人笔记或阅读状态');
      if ('title' in item.patch && (typeof item.patch.title !== 'string' || !item.patch.title.trim())) throw bad('论文标题不能为空');
      if ('tags' in item.patch && (!Array.isArray(item.patch.tags) || item.patch.tags.length > 30 || item.patch.tags.some((v: any) => typeof v !== 'string'))) throw bad('标签必须是最多30项的文字数组');
      if ('material_type' in item.patch && !['paper','survey','technical_report','official_article','research_post','unknown'].includes(item.patch.material_type)) throw bad('资料类型不正确');
      if ('verification_status' in item.patch && !['verified','partial','unverified'].includes(item.patch.verification_status)) throw bad('核验状态不正确');
      const input = { ...item.patch };
      if (Array.isArray(input.authors)) input.authors = input.authors.join(', ');
      const normalized = finishDraft(input);
      const patch: Record<string, any> = {};
      for (const field of Object.keys(input)) {
        if (input[field] === null) patch[field] = null;
        else if (field in normalized) patch[field] = encode((normalized as any)[field]);
        else throw bad(`论文 #${item.id} 的 ${field} 字段格式不正确`);
        if (String(current[field] ?? '') === String(patch[field] ?? '')) delete patch[field];
      }
      if (Object.keys(patch).length) changes.push({ id: item.id, title: current.title, updated_at: current.updated_at, patch, old: current, origins: item.origins || {} });
    }
    const preview = changes.map(row => ({ id: row.id, title: row.title, fields: Object.entries(row.patch).map(([field, value]) => ({ field, old: row.old[field], new: value })) }));
    if (b.confirm !== true) return json(c, { needs_confirm: true, preview, changed_papers: changes.length, changed_fields: changes.reduce((n, row) => n + Object.keys(row.patch).length, 0) });
    if (!changes.length) return json(c, { source_id: null, changed_papers: [], changed_fields: 0 });
    const ts = nowIso();
    const raw = JSON.stringify({ items: b.items, sources: b.sources || [], note: b.note || '' });
    if (raw.length > 400000) throw bad('批次说明过长，请拆分');
    const statements = [stmt(ctx.db, 'INSERT INTO sources(kind,name,channel,raw,import_key,actor,created_at) VALUES (?,?,?,?,?,?,?) RETURNING id',
      'api', String(b.name || '论文资料整理').slice(0, 200), '资料核验与标签整理', raw, key, ctx.actor, ts)];
    for (const row of changes) {
      // NOT NULL 约束使任何并发字段更新导致整批回滚，避免部分覆盖。
      statements.push(stmt(ctx.db, 'UPDATE sources SET kind = CASE WHEN EXISTS(SELECT 1 FROM papers WHERE id = ? AND updated_at = ?) THEN kind ELSE NULL END WHERE import_key = ?', row.id, row.updated_at, key));
      statements.push(stmt(ctx.db, `UPDATE papers SET ${Object.keys(row.patch).map(k => `${k} = ?`).join(',')}, updated_at = ? WHERE id = ?`, ...Object.values(row.patch), ts, row.id));
      for (const [field, value] of Object.entries(row.patch)) {
        const origin = typeof row.origins[field] === 'string' ? row.origins[field].slice(0, 1000) : '用户授权的资料核验与标签整理';
        statements.push(stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,origin,source_id,created_at)
          VALUES ('paper',?,'update',?,?,?,?,?,(SELECT id FROM sources WHERE import_key = ?),?)`, row.id, field, encode(row.old[field]), value, ctx.actor, origin, key, ts));
      }
    }
    try {
      const results = await ctx.db.batch(statements);
      const id = Number((results[0].results?.[0] as any)?.id);
      return json(c, { source_id: id, changed_papers: changes.map(r => r.id), changed_fields: changes.reduce((n, r) => n + Object.keys(r.patch).length, 0) });
    } catch (error) {
      const winner = await first(ctx.db, 'SELECT id, undone_at FROM sources WHERE import_key = ?', key);
      if (winner && !winner.undone_at) return json(c, await summary(ctx, winner.id, true));
      if (String(error).includes('NOT NULL constraint failed: sources.kind')) throw conflict('资料在提交期间发生变化，整批未写入，请重新预览');
      throw error;
    }
  });
}
