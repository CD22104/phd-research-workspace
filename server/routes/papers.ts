import { readingState } from '../lib/reading';
import { PROJECT_PAPER } from '../lib/paper-groups';
import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, idParam, insert, int, notFound, remove, run, stmt, update, type Ctx } from '../db';
import { body } from './planning';
import { nowIso, todayLocal, isDate } from '../lib/time';
import { byIds, byTitle } from '../lib/arxiv';
import { commitImport, importSummary, previewImport, undoImport } from '../lib/importer';
import { arxivFromText, finishDraft, normTitle, planMerge, safeJson, similarity, splitTags, PERSONAL_FIELDS, PLACEHOLDER_TITLE } from '../lib/papers';
import { getSettings } from '../db';
import { llmAvailable } from '../lib/llm';

// Keep multi-paper selections attached to the surviving paper when records merge.
function remapTaskPaper(ctx: Ctx, table: 'tasks' | 'goal_tasks', source: number, target: number) {
  const ids = `(SELECT json_group_array(value) FROM
    (SELECT DISTINCT CASE WHEN value = ?1 THEN CAST(?2 AS INTEGER) ELSE value END AS value FROM json_each(${table}.paper_ids)))`;
  return stmt(ctx.db, `UPDATE ${table} SET paper_ids = ${ids},
    paper_id = CASE WHEN json_array_length(${ids}) = 1 THEN json_extract(${ids}, '$[0]') ELSE NULL END
    WHERE EXISTS (SELECT 1 FROM json_each(${table}.paper_ids) WHERE value = ?1)`, source, target);
}

const PLAN_STATUSES = ['planned', 'reading', 'done', 'dropped'];
/** 非网页入口（MCP / API）改个人字段、批量修改、删除时，需要先看预览再带 confirm 提交 */
function needConfirm(ctx: Ctx, b: Record<string, any>, preview: unknown) {
  if (ctx.actor !== 'web' && !b.confirm) throw conflict('这个操作需要确认：请查看变更预览，确认后带 confirm: true 再提交一次', { preview, needs_confirm: true });
}

export function registerPapers(app: App) {
  app.get('/papers', async (c) => {
    const ctx = c.get('ctx');
    const stage = c.req.query('stage');
    const where = stage ? 'WHERE p.stage = ?' : "WHERE p.stage != 'rejected'";
    const rows = await all(ctx.db, `
      SELECT p.id, p.title, p.short_name, p.authors, p.team, p.venue, p.published_date, p.url, p.pdf_url, p.arxiv_id, p.doi,
             p.collection, p.side, p.direction, p.tags, p.material_type, p.verification_status, p.verification_note, p.verified_at, p.stage, p.possible_dup_of, p.added_at, p.summary, p.my_question,
             (p.my_note IS NOT NULL AND p.my_note != '') AS has_note, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM notes n WHERE n.paper_id = p.id) AS notes_count,
             (SELECT COUNT(*) FROM idea_papers ip WHERE ip.paper_id = p.id) AS ideas_count,
             (SELECT GROUP_CONCAT(DISTINCT r.kind) FROM recommendations r WHERE r.paper_id = p.id) AS rec_kinds,
             (SELECT GROUP_CONCAT(pr.id) FROM projects pr WHERE ${PROJECT_PAPER}) AS project_ids,
             (SELECT ROUND(COALESCE(SUM((julianday(COALESCE(s.end_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(s.start_at)) * 1440), 0)) FROM sessions s WHERE s.paper_id = p.id) AS minutes
      FROM papers p ${where} ORDER BY p.id`, ...(stage ? [stage] : []));
    const plans = await all(ctx.db, 'SELECT id, paper_id, status, depth, priority, purpose, focus_sections, idea_id, project_id, due_date, done_at, updated_at FROM reading_plans');
    const byPaper = new Map<number, any[]>();
    for (const p of plans as any[]) {
      if (!byPaper.has(p.paper_id)) byPaper.set(p.paper_id, []);
      byPaper.get(p.paper_id)!.push(p);
    }
    return json(c, {
      papers: rows.map((r: any) => ({
        ...r, tags: safeJson(r.tags, []), has_note: !!r.has_note,
        rec_kinds: r.rec_kinds ? String(r.rec_kinds).split(',') : [],
        project_ids: r.project_ids ? String(r.project_ids).split(',').map(Number) : [],
        reading: readingState(byPaper.get(r.id) || []),
      })),
    });
  });

  app.get('/papers/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const paper = await first(ctx.db, 'SELECT * FROM papers WHERE id = ?', id);
    if (!paper) throw notFound('论文');
    const [plans, logs, notes, ideas, projects, recs, changes, minutes, dup] = await Promise.all([
      all(ctx.db, `SELECT rp.*, i.title AS idea_title, pr.name AS project_name,
          (SELECT ROUND(COALESCE(SUM((julianday(COALESCE(s.end_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(s.start_at)) * 1440), 0)) FROM sessions s WHERE s.plan_id = rp.id) AS minutes
        FROM reading_plans rp LEFT JOIN ideas i ON i.id = rp.idea_id LEFT JOIN projects pr ON pr.id = rp.project_id
        WHERE rp.paper_id = ? ORDER BY rp.id`, id),
      all(ctx.db, 'SELECT * FROM reading_logs WHERE paper_id = ? ORDER BY date DESC, id DESC', id),
      all(ctx.db, 'SELECT * FROM notes WHERE paper_id = ? ORDER BY id', id),
      all(ctx.db, 'SELECT i.id, i.title, i.status, i.kind, ip.relation, ip.note FROM idea_papers ip JOIN ideas i ON i.id = ip.idea_id WHERE ip.paper_id = ?', id),
      all(ctx.db, `SELECT pr.id, pr.name, pr.status FROM projects pr JOIN papers p ON p.id = ? WHERE ${PROJECT_PAPER}`, id),
      all(ctx.db, `SELECT r.*, s.kind AS source_kind, s.name AS source_name, s.channel AS source_channel, s.url AS source_url, s.undone_at
        FROM recommendations r LEFT JOIN sources s ON s.id = r.source_id WHERE r.paper_id = ? ORDER BY r.id`, id),
      all(ctx.db, "SELECT * FROM changes WHERE entity = 'paper' AND entity_id = ? ORDER BY id DESC LIMIT 200", id),
      first(ctx.db, `SELECT ROUND(COALESCE(SUM((julianday(COALESCE(end_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(start_at)) * 1440), 0)) AS m FROM sessions WHERE paper_id = ?`, id),
      paper.possible_dup_of ? first(ctx.db, 'SELECT id, title, arxiv_id, venue FROM papers WHERE id = ?', paper.possible_dup_of) : null,
    ]);
    return json(c, {
      paper: { ...paper, tags: safeJson(paper.tags, []), links: safeJson(paper.links, []) },
      plans, logs, notes, ideas, projects, recommendations: recs, changes, minutes: minutes?.m || 0, possible_dup: dup,
      reading: readingState(plans),
    });
  });

  // 新增一篇（网页「手动添加」、MCP「加入候选」都走导入流程，查重规则一致）
  app.post('/papers', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const { source, defaults, ...fields } = b;
    const pv = await previewImport(ctx, { items: [fields], defaults, enrich: b.enrich !== false });
    if (!pv.items.length) throw bad('需要标题、链接、arXiv 号或 DOI 至少一项');
    const it = pv.items[0];
    if (it.action === 'skip') return json(c, { skipped: true, note: it.note, match: it.match });
    const res = await commitImport(ctx, {
      import_key: c.req.header('Idempotency-Key') ? undefined : b.import_key,
      source: { kind: source?.kind || (ctx.actor === 'mcp' ? 'mcp' : 'manual'), name: source?.name, channel: source?.channel, url: source?.url, raw: source?.raw ?? JSON.stringify(fields) },
      items: [{ draft: it.draft, raw: fields, origins: it.origins, action: it.action }],
      defaults,
    });
    return json(c, { ...res, match: it.match || null, action: it.action }, 201);
  });

  // 对话入口一次调用完成「预览 + 提交」（ChatGPT Actions 用；规则与网页导入完全相同）。
  // 默认进候选区；同样内容重复提交只导入一次。
  app.post('/quick/papers', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!Array.isArray(b.papers) || !b.papers.length) throw bad('papers 不能为空');
    const stage = b.stage === 'library' ? 'library' : 'candidate';
    const defaults = { stage, rec_kind: b.rec_kind || (ctx.actor === 'mcp' ? 'Claude' : 'GPT'), recommender: b.recommender, collection: b.collection, create_plan: stage === 'library' } as any;
    const pv = await previewImport(ctx, { items: b.papers, defaults });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([b.papers, b.source_name, stage])));
    const key = 'quick-' + [...new Uint8Array(digest)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join('');
    const res = await commitImport(ctx, {
      import_key: key,
      source: { kind: ctx.actor === 'mcp' ? 'claude' : 'chatgpt', name: b.source_name || (ctx.actor === 'mcp' ? 'Claude 对话' : 'GPT 对话'), channel: b.channel, raw: b.raw_excerpt || JSON.stringify(b.papers) },
      items: pv.items.map((i) => ({ draft: i.draft, raw: i.raw, origins: i.origins, action: i.action, target_id: i.match?.id })),
      defaults,
    });
    return json(c, {
      ...res,
      items: pv.items.map((i) => ({ title: i.draft.title, action: i.action, match: i.match ? { id: i.match.id, title: i.match.title, why: i.match.why } : null, note: i.note || null })),
      warnings: pv.warnings,
    });
  });

  app.patch('/papers/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const cur = await first(ctx.db, 'SELECT * FROM papers WHERE id = ?', id);
    if (!cur) throw notFound('论文');
    const patch: Record<string, any> = { ...b };
    delete patch.source_id;
    delete patch.confirm;
    if ('tags' in b) patch.tags = splitTags(b.tags);
    if ('material_type' in b && !['paper','survey','technical_report','official_article','research_post','unknown'].includes(b.material_type)) throw bad('资料类型不正确');
    if ('verification_status' in b && !['verified','partial','unverified'].includes(b.verification_status)) throw bad('核验状态不正确');
    if ('links' in b) patch.links = Array.isArray(b.links) ? b.links.filter((l: any) => l && l.url) : [];
    if ('stage' in b && !['candidate', 'library', 'rejected'].includes(b.stage)) throw bad('stage 只能是 candidate / library / rejected');
    if ('arxiv_id' in b && b.arxiv_id) patch.arxiv_id = arxivFromText('arxiv:' + b.arxiv_id) || arxivFromText(b.arxiv_id) || null;
    if ('title' in b && !String(b.title || '').trim()) throw bad('标题不能为空');
    const personal = PERSONAL_FIELDS.filter((f) => f in patch && cur[f] && String(cur[f]) !== String(patch[f] ?? ''));
    if (personal.length) needConfirm(ctx, b, personal.map((f) => ({ field: f, old: cur[f], new: patch[f] })));
    const changed = await update(ctx, 'papers', id, patch, { origin: b.origin || (ctx.actor === 'web' ? '手动编辑' : undefined) });
    return json(c, { changed, paper: await first(ctx.db, 'SELECT * FROM papers WHERE id = ?', id) });
  });

  app.delete('/papers/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = { confirm: c.req.query('confirm') === '1' };
    const counts = await first(ctx.db, `SELECT (SELECT COUNT(*) FROM notes WHERE paper_id = ?1) AS notes, (SELECT COUNT(*) FROM reading_plans WHERE paper_id = ?1) AS plans,
      (SELECT COUNT(*) FROM reading_logs WHERE paper_id = ?1) AS logs`, id);
    needConfirm(ctx, b, { delete_paper: id, ...counts });
    await remove(ctx, 'papers', id, [
      stmt(ctx.db, 'DELETE FROM reading_logs WHERE paper_id = ?', id),
      stmt(ctx.db, 'UPDATE tasks SET plan_id = NULL WHERE plan_id IN (SELECT id FROM reading_plans WHERE paper_id = ?)', id),
      stmt(ctx.db, 'UPDATE sessions SET plan_id = NULL WHERE plan_id IN (SELECT id FROM reading_plans WHERE paper_id = ?)', id),
      stmt(ctx.db, 'DELETE FROM reading_plans WHERE paper_id = ?', id),
      stmt(ctx.db, 'DELETE FROM notes WHERE paper_id = ?', id),
      stmt(ctx.db, 'DELETE FROM recommendations WHERE paper_id = ?', id),
      stmt(ctx.db, 'DELETE FROM idea_papers WHERE paper_id = ?', id),
      stmt(ctx.db, "DELETE FROM project_links WHERE item_type = 'paper' AND item_id = ?", id),
      stmt(ctx.db, 'UPDATE tasks SET paper_id = NULL, plan_id = NULL WHERE paper_id = ?', id),
      stmt(ctx.db, 'UPDATE sessions SET paper_id = NULL, plan_id = NULL WHERE paper_id = ?', id),
    ]);
    return json(c, { ok: true });
  });

  // 候选区：接受（可同时建阅读计划）或拒绝（之后同一篇不再出现在候选区）
  app.post('/papers/:id/stage', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    if (!['candidate', 'library', 'rejected'].includes(b.stage)) throw bad('stage 不正确');
    await update(ctx, 'papers', id, b.stage === 'library' ? { stage: b.stage, possible_dup_of: null } : { stage: b.stage });
    if (b.stage === 'library' && b.plan) await insert(ctx, 'reading_plans', { ...cleanPlan(b.plan), paper_id: id, status: 'planned' });
    return json(c, { ok: true });
  });

  // 疑似重复：确认合并到另一篇（只补空字段，推荐记录迁过去，这一条删除）
  app.post('/papers/:id/merge-into/:target', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const target = idParam(c.req.param('target'));
    if (id === target) throw bad('不能合并到自己');
    const b = await body(c);
    const [src, dst] = await Promise.all([first(ctx.db, 'SELECT * FROM papers WHERE id = ?', id), first(ctx.db, 'SELECT * FROM papers WHERE id = ?', target)]);
    if (!src || !dst) throw notFound('论文');
    const mp = planMerge(dst, { ...src, tags: safeJson(src.tags, []) });
    needConfirm(ctx, b, { merge: id, into: target, fill: mp.fill, conflicts: mp.conflicts });
    const patch: Record<string, any> = { ...mp.fill };
    for (const cf of mp.conflicts) if (b.resolve?.[cf.field] === 'new') patch[cf.field] = cf.new;
    if (mp.links.length) patch.links = [...safeJson<any[]>(dst.links, []), ...mp.links];
    await update(ctx, 'papers', target, patch, { origin: `合并自 #${id}` });
    await ctx.db.batch([
      stmt(ctx.db, 'UPDATE recommendations SET paper_id = ? WHERE paper_id = ?', target, id),
      stmt(ctx.db, 'UPDATE reading_plans SET paper_id = ? WHERE paper_id = ?', target, id),
      stmt(ctx.db, 'UPDATE reading_logs SET paper_id = ? WHERE paper_id = ?', target, id),
      stmt(ctx.db, 'UPDATE notes SET paper_id = ? WHERE paper_id = ?', target, id),
      stmt(ctx.db, 'UPDATE OR IGNORE idea_papers SET paper_id = ? WHERE paper_id = ?', target, id),
      stmt(ctx.db, "UPDATE OR IGNORE project_links SET item_id = ? WHERE item_type = 'paper' AND item_id = ?", target, id),
      stmt(ctx.db, 'UPDATE tasks SET paper_id = ? WHERE paper_id = ?', target, id),
      stmt(ctx.db, 'UPDATE goal_tasks SET paper_id = ? WHERE paper_id = ?', target, id),
      remapTaskPaper(ctx, 'tasks', id, target),
      remapTaskPaper(ctx, 'goal_tasks', id, target),
      stmt(ctx.db, 'UPDATE sessions SET paper_id = ? WHERE paper_id = ?', target, id),
    ]);
    await remove(ctx, 'papers', id, [
      stmt(ctx.db, 'DELETE FROM idea_papers WHERE paper_id = ?', id),
      stmt(ctx.db, "DELETE FROM project_links WHERE item_type = 'paper' AND item_id = ?", id),
    ], { origin: `合并到 #${target}` });
    return json(c, { ok: true, target });
  });

  // arXiv 补全：只补空字段并记下来源；与已有发表信息冲突的列出来等你确认
  app.post('/papers/:id/enrich', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const p = await first(ctx.db, 'SELECT * FROM papers WHERE id = ?', id);
    if (!p) throw notFound('论文');
    let meta;
    let origin = 'arXiv API';
    if (p.arxiv_id) meta = (await byIds([p.arxiv_id])).get(p.arxiv_id);
    else {
      meta = await byTitle(p.title);
      if (meta) origin = `arXiv 标题检索（相似度 ≥ 90%，${meta.arxiv_id}）`;
    }
    if (!meta) return json(c, { found: false });
    const draft = finishDraft({ arxiv_id: meta.arxiv_id, authors: meta.authors, abstract: meta.abstract, published_date: meta.published_date, url: meta.url, pdf_url: meta.pdf_url, doi: meta.doi, venue: meta.venue_hint });
    const mp = planMerge(p, draft);
    const patch: Record<string, any> = { ...mp.fill };
    if (mp.links.length) patch.links = [...safeJson<any[]>(p.links, []), ...mp.links];
    if (PLACEHOLDER_TITLE.test(p.title)) patch.title = meta.title;
    const changed = await update(ctx, 'papers', id, patch, { origin });
    return json(c, { found: true, arxiv_title: meta.title, changed, conflicts: mp.conflicts, origin });
  });

  // 批量补全（有 arXiv 号的，一次请求）
  app.post('/papers/enrich', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const ids: number[] = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 50);
    const rows = ids.length
      ? await all(ctx.db, `SELECT * FROM papers WHERE id IN (${ids.map(() => '?').join(',')}) AND arxiv_id IS NOT NULL`, ...ids)
      : await all(ctx.db, "SELECT * FROM papers WHERE arxiv_id IS NOT NULL AND (abstract IS NULL OR authors IS NULL OR title LIKE 'arXiv:%（待补全标题）') AND stage != 'rejected' LIMIT 50");
    const metas = await byIds(rows.map((r: any) => r.arxiv_id));
    const out: any[] = [];
    for (const p of rows as any[]) {
      const meta = metas.get(p.arxiv_id);
      if (!meta) continue;
      const draft = finishDraft({ authors: meta.authors, abstract: meta.abstract, published_date: meta.published_date, pdf_url: meta.pdf_url, doi: meta.doi, venue: meta.venue_hint });
      const mp = planMerge(p, draft);
      const patch: Record<string, any> = { ...mp.fill };
      if (PLACEHOLDER_TITLE.test(p.title)) patch.title = meta.title;
      const changed = await update(ctx, 'papers', p.id, patch, { origin: 'arXiv API' });
      out.push({ id: p.id, changed: Object.keys(changed), conflicts: mp.conflicts });
    }
    return json(c, { checked: rows.length, results: out });
  });

  app.post('/papers/:id/recommendations', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const src = await run(ctx.db, 'INSERT INTO sources(kind, name, channel, raw, actor, created_at) VALUES (?,?,?,?,?,?)',
      'manual', b.kind ? `${b.kind}推荐` : '手动记录', b.channel || null, JSON.stringify(b), ctx.actor, nowIso());
    await run(ctx.db, 'INSERT INTO recommendations(paper_id, source_id, kind, recommender, reason, raw, action, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, Number(src.meta.last_row_id), b.kind || null, b.recommender || null, b.reason || null, JSON.stringify(b), 'merged', nowIso());
    return json(c, { ok: true }, 201);
  });

  // ───────── 阅读计划 ─────────
  app.post('/plans', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const paperId = int(b.paper_id);
    if (!paperId || !(await first(ctx.db, 'SELECT id FROM papers WHERE id = ?', paperId))) throw notFound('论文');
    const id = await insert(ctx, 'reading_plans', { ...cleanPlan(b), paper_id: paperId, status: 'planned' });
    // 为候选论文建计划 = 接受进入正式清单
    await run(ctx.db, "UPDATE papers SET stage = 'library', updated_at = ? WHERE id = ? AND stage = 'candidate'", nowIso(), paperId);
    if (b.idea_id) await run(ctx.db, 'INSERT OR IGNORE INTO idea_papers(idea_id, paper_id, relation, created_at) VALUES (?,?,?,?)', int(b.idea_id), paperId, '相关工作', nowIso());
    return json(c, await first(ctx.db, 'SELECT * FROM reading_plans WHERE id = ?', id), 201);
  });

  app.patch('/plans/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const patch: Record<string, any> = cleanPlan(b);
    if ('status' in b) {
      if (!PLAN_STATUSES.includes(b.status)) throw bad('计划状态不正确');
      patch.status = b.status;
      patch.done_at = b.status === 'done' ? (isDate(b.done_at) ? b.done_at : todayLocal(ctx.tz)) : null;
    }
    await update(ctx, 'reading_plans', id, patch);
    return json(c, await first(ctx.db, 'SELECT * FROM reading_plans WHERE id = ?', id));
  });

  app.delete('/plans/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    await remove(ctx, 'reading_plans', id, [
      stmt(ctx.db, 'UPDATE reading_logs SET plan_id = NULL WHERE plan_id = ?', id),
      stmt(ctx.db, 'UPDATE tasks SET plan_id = NULL WHERE plan_id = ?', id),
      stmt(ctx.db, 'UPDATE sessions SET plan_id = NULL WHERE plan_id = ?', id),
    ]);
    return json(c, { ok: true });
  });

  // ───────── 阅读记录 ─────────
  app.post('/logs', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const paperId = int(b.paper_id);
    if (!paperId) throw bad('缺少论文');
    const id = await insert(ctx, 'reading_logs', {
      paper_id: paperId, plan_id: int(b.plan_id), date: isDate(b.date) ? b.date : todayLocal(ctx.tz),
      sections: b.sections || null, content: b.content || null, questions: b.questions || null, minutes: int(b.minutes),
    });
    return json(c, await first(ctx.db, 'SELECT * FROM reading_logs WHERE id = ?', id), 201);
  });

  app.patch('/logs/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const patch: Record<string, any> = {};
    for (const k of ['sections', 'content', 'questions']) if (k in b) patch[k] = b[k] || null;
    if ('minutes' in b) patch.minutes = int(b.minutes);
    if ('date' in b && isDate(b.date)) patch.date = b.date;
    if ('plan_id' in b) patch.plan_id = int(b.plan_id);
    await update(ctx, 'reading_logs', id, patch);
    return json(c, await first(ctx.db, 'SELECT * FROM reading_logs WHERE id = ?', id));
  });

  app.delete('/logs/:id', async (c) => {
    const ctx = c.get('ctx');
    await remove(ctx, 'reading_logs', idParam(c.req.param('id')));
    return json(c, { ok: true });
  });

  // ───────── 笔记（Markdown） ─────────
  app.get('/notes/:id', async (c) => {
    const ctx = c.get('ctx');
    const note = await first(ctx.db, `SELECT n.*, p.title AS paper_title, pr.name AS project_name, i.title AS idea_title
      FROM notes n LEFT JOIN papers p ON p.id = n.paper_id
      LEFT JOIN projects pr ON pr.id = n.project_id LEFT JOIN ideas i ON i.id = n.idea_id
      WHERE n.id = ?`, idParam(c.req.param('id')));
    if (!note) throw notFound('笔记');
    return json(c, note);
  });

  app.post('/notes', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.content && b.content !== '') throw bad('笔记内容为空');
    if (!b.paper_id && !b.idea_id && !b.project_id) throw bad('笔记需要关联到论文、Idea 或项目');
    const id = await insert(ctx, 'notes', {
      paper_id: int(b.paper_id), plan_id: int(b.plan_id), idea_id: int(b.idea_id), project_id: int(b.project_id),
      title: b.title || null, filename: b.filename || null, content: String(b.content), no_llm: b.no_llm === false ? 0 : 1,
    }, { origin: b.filename ? `上传文件 ${b.filename}` : '在线编辑' });
    return json(c, await first(ctx.db, 'SELECT * FROM notes WHERE id = ?', id), 201);
  });

  // 保存带版本号：如果别的设备已经改过，返回冲突，而不是悄悄覆盖
  app.patch('/notes/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const cur = await first(ctx.db, 'SELECT * FROM notes WHERE id = ?', id);
    if (!cur) throw notFound('笔记');
    if (b.base_version != null && Number(b.base_version) !== cur.version) {
      throw conflict('这篇笔记在别处已经被修改过，请先对比再保存', { current: cur });
    }
    if ('content' in b && ctx.actor !== 'web') needConfirm(ctx, b, { note: id, old_length: String(cur.content).length, new_length: String(b.content ?? '').length });
    const patch: Record<string, any> = {};
    for (const k of ['title', 'content', 'plan_id', 'paper_id', 'idea_id', 'project_id']) if (k in b) patch[k] = b[k];
    if ('no_llm' in b) patch.no_llm = b.no_llm ? 1 : 0;
    const changed = await update(ctx, 'notes', id, patch);
    if (Object.keys(changed).length) await run(ctx.db, 'UPDATE notes SET version = version + 1 WHERE id = ?', id);
    return json(c, await first(ctx.db, 'SELECT * FROM notes WHERE id = ?', id));
  });

  app.delete('/notes/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    needConfirm(ctx, { confirm: c.req.query('confirm') === '1' }, { delete_note: id });
    await remove(ctx, 'notes', id);
    return json(c, { ok: true });
  });

  // 批量上传 MD 时的匹配建议：文件内写了论文 ID / arXiv / DOI 为高置信；只靠文件名的相似度低于 0.9 时进入待确认
  app.post('/notes/match', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const files: Array<{ filename: string; text?: string }> = Array.isArray(b.files) ? b.files.slice(0, 100) : [];
    const papers = await all(ctx.db, "SELECT id, title, short_name, arxiv_id, doi FROM papers WHERE stage != 'rejected'");
    const out = files.map((f) => {
      const head = String(f.text || '').slice(0, 3000);
      const fm = head.match(/^---\s*\n([\s\S]*?)\n---/);
      const meta: Record<string, string> = {};
      if (fm) for (const line of fm[1].split('\n')) {
        const m = line.match(/^(\w+)\s*:\s*(.+)$/);
        if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      const pid = int(meta.paper_id || meta.paper);
      if (pid && papers.some((p: any) => p.id === pid)) return { filename: f.filename, paper_id: pid, confidence: 'high', why: '文件里写了论文 ID' };
      const ax = arxivFromText(meta.arxiv ? 'arxiv:' + meta.arxiv : head);
      const byAx = ax && papers.find((p: any) => p.arxiv_id === ax);
      if (byAx) return { filename: f.filename, paper_id: byAx.id, confidence: 'high', why: `arXiv ${ax}` };
      const doi = meta.doi;
      const byDoi = doi && papers.find((p: any) => p.doi && p.doi.toLowerCase() === doi.toLowerCase());
      if (byDoi) return { filename: f.filename, paper_id: byDoi.id, confidence: 'high', why: `DOI ${doi}` };
      const heading = head.replace(/^---[\s\S]*?---/, '').match(/^#\s+(.+)$/m)?.[1] || '';
      const cands = [meta.title, heading, f.filename.replace(/\.(md|markdown|txt)$/i, '')].filter(Boolean).map(normTitle);
      let best: any = null;
      let bestSim = 0;
      for (const p of papers as any[]) {
        for (const t of [normTitle(p.title), normTitle(p.short_name)]) {
          if (!t) continue;
          for (const cnd of cands) {
            let sim = similarity(cnd, t);
            if (cnd.length >= 8 && t.length >= 8 && (cnd.includes(t) || t.includes(cnd))) sim = Math.max(sim, 0.88);
            if (sim > bestSim) {
              bestSim = sim;
              best = p;
            }
          }
        }
      }
      if (best && bestSim >= 0.6) return { filename: f.filename, paper_id: best.id, confidence: bestSim >= 0.9 ? 'high' : 'low', why: `标题 / 文件名相似 ${Math.round(bestSim * 100)}%` };
      return { filename: f.filename, paper_id: null, confidence: 'none', why: '没有找到匹配' };
    });
    return json(c, { matches: out });
  });

  // ───────── 导入 ─────────
  app.post('/import/preview', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const s = await getSettings(ctx.db);
    if (b.use_llm && !llmAvailable(ctx.env, s.llm_provider)) throw bad('服务器没有配置大模型，请改用 JSON / 表格 / BibTeX / 链接列表格式');
    return json(c, await previewImport(ctx, { ...b, provider: s.llm_provider } as any));
  });

  app.post('/import/commit', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    return json(c, await commitImport(ctx, b as any));
  });

  app.get('/sources', async (c) => {
    const ctx = c.get('ctx');
    const rows = await all(ctx.db, `SELECT s.id, s.kind, s.name, s.channel, s.url, s.actor, s.undone_at, s.created_at, LENGTH(s.raw) AS raw_length,
        (SELECT COUNT(*) FROM recommendations r WHERE r.source_id = s.id) AS rec_count,
        (SELECT COUNT(*) FROM papers p WHERE p.source_id = s.id) AS created_count
      FROM sources s ORDER BY s.id DESC LIMIT 200`);
    return json(c, { sources: rows });
  });

  app.get('/sources/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const src = await first(ctx.db, 'SELECT * FROM sources WHERE id = ?', id);
    if (!src) throw notFound('来源');
    const recs = await all(ctx.db, 'SELECT r.*, p.title FROM recommendations r LEFT JOIN papers p ON p.id = r.paper_id WHERE r.source_id = ? ORDER BY r.id', id);
    const changes = await all(ctx.db, 'SELECT * FROM changes WHERE source_id = ? ORDER BY id', id);
    return json(c, { source: src, recommendations: recs, changes, summary: await importSummary(ctx, id) });
  });

  app.post('/sources/:id/undo', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const src = await first(ctx.db, 'SELECT id, name, kind FROM sources WHERE id = ?', id);
    if (!src) throw notFound('来源');
    needConfirm(ctx, b, { undo_source: src, summary: await importSummary(ctx, id) });
    return json(c, await undoImport(ctx, id));
  });
}

function cleanPlan(b: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const k of ['purpose', 'focus_sections', 'criteria']) if (k in b) out[k] = b[k] ? String(b[k]) : null;
  for (const k of ['idea_id', 'project_id']) if (k in b) out[k] = int(b[k]);
  if ('priority' in b) out.priority = /^P[0-3]$/.test(b.priority || '') ? b.priority : null;
  if ('depth' in b) out.depth = b.depth || null;
  if ('due_date' in b) out.due_date = isDate(b.due_date) ? b.due_date : null;
  return out;
}
