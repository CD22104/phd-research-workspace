import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, idParam, insert, int, notFound, remove, run, stmt, update } from '../db';
import { body } from './planning';
import { nowIso } from '../lib/time';
import { safeJson, splitTags } from '../lib/papers';
import { readingState } from '../lib/reading';

const IDEA_STATUSES = ['seed', 'exploring', 'drafting', 'experimenting', 'mature', 'shelved', 'dropped'];

/** 一篇关联论文对这个 Idea 的阅读情况：是否已完成「为本 Idea」的阅读计划 */
function forIdea(plans: any[], ideaId: number) {
  const mine = plans.filter((p) => p.idea_id === ideaId);
  const general = readingState(plans);
  if (mine.some((p) => p.status === 'done')) {
    const d = mine.filter((p) => p.status === 'done').pop();
    return { state: 'satisfied', depth: d.depth, general };
  }
  const open = mine.find((p) => p.status === 'planned' || p.status === 'reading');
  if (open) return { state: open.status === 'reading' ? 'reading' : 'planned', depth: open.depth, plan_id: open.id, general };
  return { state: 'no_plan', general };
}

export function registerIdeas(app: App) {
  app.get('/ideas', async (c) => {
    const ctx = c.get('ctx');
    const ideas = await all(ctx.db, `SELECT i.id, i.title, i.one_liner, i.kind, i.status, i.priority, i.tags, i.project_id, i.no_llm, i.version, i.created_at, i.updated_at,
        pr.name AS project_name, LENGTH(i.content) AS content_length
      FROM ideas i LEFT JOIN projects pr ON pr.id = i.project_id ORDER BY i.updated_at DESC`);
    const links = await all(ctx.db, 'SELECT idea_id, paper_id FROM idea_papers');
    const plans = await all(ctx.db, 'SELECT id, paper_id, idea_id, status, depth, priority, done_at, updated_at FROM reading_plans');
    const plansByPaper = new Map<number, any[]>();
    for (const p of plans as any[]) {
      if (!plansByPaper.has(p.paper_id)) plansByPaper.set(p.paper_id, []);
      plansByPaper.get(p.paper_id)!.push(p);
    }
    return json(c, {
      ideas: ideas.map((i: any) => {
        const ps = links.filter((l: any) => l.idea_id === i.id);
        const satisfied = ps.filter((l: any) => forIdea(plansByPaper.get(l.paper_id) || [], i.id).state === 'satisfied').length;
        return { ...i, tags: safeJson(i.tags, []), paper_count: ps.length, satisfied_count: satisfied };
      }),
    });
  });

  app.get('/ideas/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const idea = await first(ctx.db, 'SELECT i.*, pr.name AS project_name FROM ideas i LEFT JOIN projects pr ON pr.id = i.project_id WHERE i.id = ?', id);
    if (!idea) throw notFound('Idea');
    const papers = await all(ctx.db, `SELECT p.id, p.title, p.short_name, p.venue, p.published_date, p.url, p.stage, ip.relation, ip.note
      FROM idea_papers ip JOIN papers p ON p.id = ip.paper_id WHERE ip.idea_id = ? ORDER BY ip.created_at`, id);
    const ids = papers.map((p: any) => p.id);
    const plans = ids.length ? await all(ctx.db, `SELECT * FROM reading_plans WHERE paper_id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
    const [versions, notes, minutes] = await Promise.all([
      all(ctx.db, "SELECT id, label, title, LENGTH(content) AS length, created_at FROM doc_versions WHERE entity = 'idea' AND entity_id = ? ORDER BY id DESC", id),
      all(ctx.db, 'SELECT * FROM notes WHERE idea_id = ? ORDER BY id', id),
      first(ctx.db, `SELECT ROUND(COALESCE(SUM((julianday(COALESCE(end_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(start_at)) * 1440), 0)) AS m FROM sessions WHERE idea_id = ?`, id),
    ]);
    const withState = papers.map((p: any) => ({ ...p, reading: forIdea(plans.filter((x: any) => x.paper_id === p.id), id) }));
    return json(c, {
      idea: { ...idea, tags: safeJson(idea.tags, []) },
      papers: withState,
      satisfied: withState.filter((p) => p.reading.state === 'satisfied').length,
      versions, notes, minutes: minutes?.m || 0,
    });
  });

  app.post('/ideas', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.title || !String(b.title).trim()) throw bad('标题不能为空');
    const id = await insert(ctx, 'ideas', {
      title: String(b.title).trim(), one_liner: b.one_liner || null, kind: b.kind === 'proposal' ? 'proposal' : 'idea',
      status: IDEA_STATUSES.includes(b.status) ? b.status : 'seed', priority: b.priority || null, tags: splitTags(b.tags),
      content: b.content || '', project_id: int(b.project_id), no_llm: b.no_llm === false ? 0 : 1,
    }, { origin: ctx.actor === 'web' ? '在线编辑' : ctx.actor });
    return json(c, await first(ctx.db, 'SELECT * FROM ideas WHERE id = ?', id), 201);
  });

  // 保存：带 base_version，别处改过就返回冲突；自动保存不产生正式版本
  app.patch('/ideas/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const cur = await first(ctx.db, 'SELECT * FROM ideas WHERE id = ?', id);
    if (!cur) throw notFound('Idea');
    if (b.base_version != null && Number(b.base_version) !== cur.version) throw conflict('这个 Idea 在别处已经被修改过，请先对比再保存', { current: cur });
    if ('content' in b && ctx.actor !== 'web' && cur.content && !b.confirm) {
      throw conflict('覆盖 Idea 正文需要确认：请查看预览后带 confirm: true 再提交', { needs_confirm: true, preview: { old_length: String(cur.content).length, new_length: String(b.content ?? '').length } });
    }
    const patch: Record<string, any> = {};
    for (const k of ['title', 'one_liner', 'priority', 'content']) if (k in b) patch[k] = b[k] ?? null;
    if ('kind' in b) patch.kind = b.kind === 'proposal' ? 'proposal' : 'idea';
    if ('status' in b) {
      if (!IDEA_STATUSES.includes(b.status)) throw bad('状态不正确');
      patch.status = b.status;
    }
    if ('tags' in b) patch.tags = splitTags(b.tags);
    if ('project_id' in b) patch.project_id = int(b.project_id);
    if ('no_llm' in b) patch.no_llm = b.no_llm ? 1 : 0;
    const changed = await update(ctx, 'ideas', id, patch);
    if (Object.keys(changed).length) await run(ctx.db, 'UPDATE ideas SET version = version + 1 WHERE id = ?', id);
    return json(c, await first(ctx.db, 'SELECT * FROM ideas WHERE id = ?', id));
  });

  app.delete('/ideas/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除 Idea 需要确认', { needs_confirm: true });
    await remove(ctx, 'ideas', id, [
      stmt(ctx.db, 'DELETE FROM idea_papers WHERE idea_id = ?', id),
      stmt(ctx.db, 'UPDATE reading_plans SET idea_id = NULL WHERE idea_id = ?', id),
      stmt(ctx.db, 'UPDATE tasks SET idea_id = NULL WHERE idea_id = ?', id),
      stmt(ctx.db, 'UPDATE sessions SET idea_id = NULL WHERE idea_id = ?', id),
      stmt(ctx.db, 'UPDATE notes SET idea_id = NULL WHERE idea_id = ?', id),
    ]);
    return json(c, { ok: true });
  });

  app.post('/ideas/:id/papers', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const pid = int(b.paper_id);
    if (!pid) throw bad('缺少论文');
    await run(ctx.db, `INSERT INTO idea_papers(idea_id, paper_id, relation, note, created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(idea_id, paper_id) DO UPDATE SET relation = excluded.relation, note = COALESCE(excluded.note, idea_papers.note)`,
      id, pid, b.relation || '相关工作', b.note || null, nowIso());
    return json(c, { ok: true }, 201);
  });

  app.delete('/ideas/:id/papers/:pid', async (c) => {
    const ctx = c.get('ctx');
    await run(ctx.db, 'DELETE FROM idea_papers WHERE idea_id = ? AND paper_id = ?', idParam(c.req.param('id')), idParam(c.req.param('pid')));
    return json(c, { ok: true });
  });

  // 为这个 Idea 再读一次：新建一轮阅读计划（已读过的论文也可以）
  app.post('/ideas/:id/reread', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const pid = int(b.paper_id);
    const idea = await first(ctx.db, 'SELECT title, project_id FROM ideas WHERE id = ?', id);
    if (!idea || !pid) throw notFound();
    const planId = await insert(ctx, 'reading_plans', {
      paper_id: pid, idea_id: id, project_id: idea.project_id, status: 'planned',
      purpose: b.purpose || `为 Idea「${idea.title}」核对`, depth: b.depth || '精读验证', focus_sections: b.focus_sections || null,
      criteria: b.criteria || null, priority: b.priority || null,
    });
    await run(ctx.db, 'INSERT OR IGNORE INTO idea_papers(idea_id, paper_id, relation, created_at) VALUES (?,?,?,?)', id, pid, '相关工作', nowIso());
    await run(ctx.db, "UPDATE papers SET stage = 'library' WHERE id = ? AND stage = 'candidate'", pid);
    return json(c, await first(ctx.db, 'SELECT * FROM reading_plans WHERE id = ?', planId), 201);
  });

  // 正式版本（Idea / 笔记通用）
  app.post('/versions', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const entity = b.entity === 'note' ? 'note' : 'idea';
    const eid = int(b.entity_id);
    const cur = eid ? await first(ctx.db, `SELECT * FROM ${entity === 'note' ? 'notes' : 'ideas'} WHERE id = ?`, eid) : null;
    if (!cur) throw notFound();
    const r = await run(ctx.db, 'INSERT INTO doc_versions(entity, entity_id, label, title, content, created_at) VALUES (?,?,?,?,?,?)',
      entity, eid, b.label || null, cur.title, cur.content, nowIso());
    return json(c, { id: Number(r.meta.last_row_id) }, 201);
  });

  app.get('/versions', async (c) => {
    const ctx = c.get('ctx');
    const entity = c.req.query('entity') === 'note' ? 'note' : 'idea';
    const eid = int(c.req.query('entity_id'));
    return json(c, { versions: await all(ctx.db, 'SELECT id, label, title, LENGTH(content) AS length, created_at FROM doc_versions WHERE entity = ? AND entity_id = ? ORDER BY id DESC', entity, eid) });
  });

  app.get('/versions/:id', async (c) => {
    const ctx = c.get('ctx');
    const v = await first(ctx.db, 'SELECT * FROM doc_versions WHERE id = ?', idParam(c.req.param('id')));
    if (!v) throw notFound('版本');
    return json(c, v);
  });
}
