import { feedDay, feedTaskTiming } from '../lib/feed-day';
import { saveFeedRun } from '../lib/feed-runs';
import { conferenceList } from './conferences';
import { currentFocus } from '../lib/focus-timer';
import { activeBackground } from './background';
import { PROJECT_PAPER } from '../lib/paper-groups';
import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, getSettings, idParam, insert, int, notFound, putSettings, remove, run, stmt, update, DEFAULT_SETTINGS, THEME_IDS } from '../db';
import { body } from './planning';
import { isDate, nowIso, todayLocal } from '../lib/time';
import { safeJson } from '../lib/papers';
import { llmAvailable } from '../lib/llm';

const PROJECT_STATUSES = ['active', 'paused', 'done', 'archived'];
const MINUTES = `ROUND(COALESCE(SUM((julianday(COALESCE(s.end_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(s.start_at)) * 1440), 0))`;

export function registerMisc(app: App) {
  app.get('/bootstrap', async (c) => {
    const ctx = c.get('ctx');
    const s = await getSettings(ctx.db);
    const [projects, counts, running, paperGroups, background, conferences] = await Promise.all([
      all(ctx.db, "SELECT id, name, kind, status, color FROM projects WHERE status != 'archived' ORDER BY sort, id"),
      first(ctx.db, `SELECT
        (SELECT COUNT(*) FROM captures WHERE status = 'new') AS captures,
        (SELECT COUNT(*) FROM papers WHERE stage = 'candidate') AS candidates,
        (SELECT COUNT(*) FROM papers WHERE possible_dup_of IS NOT NULL) AS dup_suspects,
        (SELECT COUNT(*) FROM feed_items WHERE triage != 'done' AND archived = 0) AS feed_items`),
      currentFocus(ctx),
      all(ctx.db, `SELECT pg.*, (SELECT COUNT(*) FROM papers p WHERE p.collection = pg.name AND p.stage = 'library') AS paper_count FROM paper_groups pg ORDER BY pg.name`),
      activeBackground(ctx),
      conferenceList(ctx),
    ]);
    s.options.collections = paperGroups.map(g => g.name);
    return json(c, {
      conferences, paper_groups: paperGroups, settings: s, projects, counts, running, background, today: todayLocal(ctx.tz), timezone: ctx.tz, who: ctx.who,
      llm: { provider: s.llm_provider, available: llmAvailable(ctx.env, s.llm_provider) },
    });
  });

  app.get('/settings', async (c) => json(c, await getSettings(c.get('ctx').db)));

  // 修改评分权重不会改动历史：追加一个从今天起生效的新公式版本
  app.put('/settings', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const cur = await getSettings(ctx.db);
    const patch: Record<string, any> = { ...b };
    delete patch.scoring_versions;
    delete patch.workday_versions;
    if (b.scoring) {
      const today = todayLocal(ctx.tz);
      const versions = [...cur.scoring_versions].filter((v) => v.effective_from !== today || v.version === 1);
      const last = versions[versions.length - 1];
      const num = (o: any, keys: string[], base: any): any => Object.fromEntries(keys.map((k) => [k, Math.max(0, Number(o?.[k] ?? base[k]) || 0)]));
      const next = {
        version: Math.max(...cur.scoring_versions.map((v) => v.version)) + 1,
        effective_from: today,
        day: num(b.scoring.day, ['plan', 'hours'], last.day),
        period: num(b.scoring.period, ['goals', 'hours', 'checkin'], last.period),
      };
      if (JSON.stringify(next.day) !== JSON.stringify(last.day) || JSON.stringify(next.period) !== JSON.stringify(last.period)) versions.push(next);
      patch.scoring_versions = versions;
      delete patch.scoring;
    }
    if ('workdays' in patch) {
      patch.workdays = [...new Set((Array.isArray(patch.workdays) ? patch.workdays : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
      const today = todayLocal(ctx.tz);
      const versions = [...cur.workday_versions].filter(v => v.effective_from !== today);
      versions.push({ effective_from: today, workdays: patch.workdays });
      patch.workday_versions = versions.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    }
    if ('pinned_collections' in patch) {
      if (!Array.isArray(patch.pinned_collections) || patch.pinned_collections.length > 50 || patch.pinned_collections.some((v: unknown) => typeof v !== 'string' || !v.trim() || v.length > 200)) throw bad('置顶集合必须是最多50项的集合名称');
      patch.pinned_collections = [...new Set(patch.pinned_collections.map((v: string) => v.trim()))];
    }
    if ('daily_target_minutes' in patch) patch.daily_target_minutes = Math.max(0, int(patch.daily_target_minutes) || 0);
    if ('llm_provider' in patch && !['off', 'deepseek', 'anthropic'].includes(patch.llm_provider)) throw bad('大模型只能是 off / deepseek / anthropic');
    if ('theme' in patch && !THEME_IDS.includes(patch.theme)) throw bad('没有这个皮肤');
    if ('options' in patch) patch.options = { ...cur.options, ...patch.options };
    await putSettings(ctx.db, patch);
    return json(c, await getSettings(ctx.db));
  });

  // 快速搜索（关联选择器、MCP 搜索共用）
  app.get('/search', async (c) => {
    const ctx = c.get('ctx');
    const q = (c.req.query('q') || '').trim();
    if (!q) return json(c, { papers: [], ideas: [], projects: [] });
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const [papers, ideas, projects] = await Promise.all([
      all(ctx.db, `SELECT id, title, short_name, venue, arxiv_id, stage FROM papers
        WHERE title LIKE ?1 ESCAPE '\\' OR short_name LIKE ?1 ESCAPE '\\' OR authors LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\' OR arxiv_id LIKE ?1 ESCAPE '\\' OR summary LIKE ?1 ESCAPE '\\'
        ORDER BY stage = 'rejected', id DESC LIMIT 30`, like),
      all(ctx.db, "SELECT id, title, status, kind FROM ideas WHERE title LIKE ?1 ESCAPE '\\' OR one_liner LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\' LIMIT 20", like),
      all(ctx.db, "SELECT id, name, status FROM projects WHERE name LIKE ?1 ESCAPE '\\' OR question LIKE ?1 ESCAPE '\\' LIMIT 20", like),
    ]);
    return json(c, { papers, ideas, projects });
  });

  // ───────── 项目 / 探索主题 ─────────
  app.get('/projects', async (c) => {
    const ctx = c.get('ctx');
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const rows = await all(ctx.db, `SELECT pr.*,
        (SELECT COUNT(*) FROM papers p WHERE ${PROJECT_PAPER}) AS paper_count,
        (SELECT COUNT(*) FROM project_links pl WHERE pl.project_id = pr.id AND pl.item_type = 'paper_group') AS group_count,
        (SELECT COUNT(*) FROM ideas i WHERE i.project_id = pr.id) AS idea_count,
        (SELECT COUNT(*) FROM notes n WHERE n.project_id = pr.id) AS note_count,
        (SELECT COUNT(*) FROM goals g WHERE g.project_id = pr.id AND g.status = 'open') AS open_goals,
        (SELECT ${MINUTES} FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id LEFT JOIN goals g ON g.id = t.goal_id
           WHERE COALESCE(s.project_id, t.project_id, g.project_id) = pr.id AND s.start_at >= ?) AS minutes_30d
      FROM projects pr ORDER BY pr.pinned DESC, CASE pr.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, pr.sort, pr.id`, since);
    const [notes,ideas]=await Promise.all([
      all(ctx.db,`SELECT id,project_id,title,filename,updated_at FROM (SELECT id,project_id,title,filename,updated_at,ROW_NUMBER() OVER(PARTITION BY project_id ORDER BY updated_at DESC,id DESC) AS rank FROM notes WHERE project_id IS NOT NULL) WHERE rank<=5 ORDER BY project_id,updated_at DESC,id DESC`),
      all(ctx.db,`SELECT id,project_id,title,status,updated_at FROM (SELECT id,project_id,title,status,updated_at,ROW_NUMBER() OVER(PARTITION BY project_id ORDER BY updated_at DESC,id DESC) AS rank FROM ideas WHERE project_id IS NOT NULL) WHERE rank<=5 ORDER BY project_id,updated_at DESC,id DESC`)
    ]);
    return json(c, { projects: rows.map(p=>({...p,notes:notes.filter(n=>n.project_id===p.id),ideas:ideas.filter(i=>i.project_id===p.id)})) });
  });

  app.get('/projects/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const project = await first(ctx.db, 'SELECT * FROM projects WHERE id = ?', id);
    if (!project) throw notFound('项目');
    const [papers, ideas, notes, goals, tasks, minutes, paperGroups] = await Promise.all([
      all(ctx.db, `SELECT p.id, p.title, p.venue, p.stage, p.collection,
          (SELECT GROUP_CONCAT(rp.status) FROM reading_plans rp WHERE rp.paper_id = p.id) AS plan_statuses
        FROM papers p JOIN projects pr ON pr.id = ? WHERE ${PROJECT_PAPER} ORDER BY p.added_at DESC, p.id DESC`, id),
      all(ctx.db, 'SELECT id, title, status, kind, one_liner FROM ideas WHERE project_id = ? ORDER BY updated_at DESC', id),
      all(ctx.db, 'SELECT id, title, filename, content, version, created_at, updated_at FROM notes WHERE project_id = ? ORDER BY updated_at DESC', id),
      all(ctx.db, 'SELECT * FROM goals WHERE project_id = ? ORDER BY week_id DESC, sort LIMIT 60', id),
      all(ctx.db, `SELECT t.id, t.date, t.title, t.status FROM tasks t LEFT JOIN goals g ON g.id = t.goal_id
        WHERE COALESCE(t.project_id, g.project_id) = ? ORDER BY t.date DESC LIMIT 60`, id),
      first(ctx.db, `SELECT ${MINUTES} AS m FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id LEFT JOIN goals g ON g.id = t.goal_id
        WHERE COALESCE(s.project_id, t.project_id, g.project_id) = ?`, id),
      all(ctx.db, `SELECT pg.*, (SELECT COUNT(*) FROM papers p WHERE p.collection = pg.name) AS paper_count FROM project_links pl JOIN paper_groups pg ON pg.id = pl.item_id WHERE pl.project_id = ? AND pl.item_type = 'paper_group' ORDER BY pg.name`, id),
    ]);
    return json(c, { project, papers, paper_groups: paperGroups, ideas, notes, goals, tasks, minutes: minutes?.m || 0 });
  });

  app.post('/projects', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.name || !String(b.name).trim()) throw bad('名称不能为空');
    const id = await insert(ctx, 'projects', {
      name: String(b.name).trim(), kind: ['explore', 'research', 'course', 'other'].includes(b.kind) ? b.kind : 'explore',
      question: b.question || null, status: 'active', next_step: b.next_step || null, description: b.description || null, color: b.color || null,
    });
    return json(c, await first(ctx.db, 'SELECT * FROM projects WHERE id = ?', id), 201);
  });

  app.patch('/projects/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    if ('pinned' in b && ![true,false,0,1].includes(b.pinned)) throw bad('置顶状态不正确');
    if ('status' in b && !PROJECT_STATUSES.includes(b.status)) throw bad('项目状态不正确');
    await update(ctx, 'projects', id, b);
    return json(c, await first(ctx.db, 'SELECT * FROM projects WHERE id = ?', id));
  });

  app.delete('/projects/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除项目需要确认', { needs_confirm: true });
    await remove(ctx, 'projects', id, [
      stmt(ctx.db, 'DELETE FROM project_links WHERE project_id = ?', id),
      stmt(ctx.db, 'UPDATE goals SET project_id = NULL WHERE project_id = ?', id),
      stmt(ctx.db, 'UPDATE tasks SET project_id = NULL WHERE project_id = ?', id),
      stmt(ctx.db, 'UPDATE sessions SET project_id = NULL WHERE project_id = ?', id),
      stmt(ctx.db, 'UPDATE ideas SET project_id = NULL WHERE project_id = ?', id),
      stmt(ctx.db, 'UPDATE notes SET project_id = NULL WHERE project_id = ?', id),
      stmt(ctx.db, 'UPDATE reading_plans SET project_id = NULL WHERE project_id = ?', id),
    ]);
    return json(c, { ok: true });
  });

  app.post('/projects/:id/links', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    if (!['paper', 'paper_group', 'idea', 'note', 'feed_item'].includes(b.item_type)) throw bad('关联类型不正确');
    const itemId = int(b.item_id);
    if (!itemId) throw bad('缺少关联对象');
    if (!await first(ctx.db, 'SELECT id FROM projects WHERE id = ?', id)) throw notFound('项目');
    if (b.item_type === 'paper_group' && !await first(ctx.db, 'SELECT id FROM paper_groups WHERE id = ?', itemId)) throw notFound('论文组');
    if (b.item_type === 'idea') await run(ctx.db, 'UPDATE ideas SET project_id = ?, updated_at = ? WHERE id = ?', id, nowIso(), itemId);
    else if (b.item_type === 'note') await run(ctx.db, 'UPDATE notes SET project_id = ?, updated_at = ? WHERE id = ?', id, nowIso(), itemId);
    else await run(ctx.db, 'INSERT OR IGNORE INTO project_links(project_id, item_type, item_id, created_at) VALUES (?,?,?,?)', id, b.item_type, itemId, nowIso());
    return json(c, { ok: true }, 201);
  });

  app.delete('/projects/:id/links', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const type = c.req.query('item_type');
    const itemId = int(c.req.query('item_id'));
    if (type === 'idea') await run(ctx.db, 'UPDATE ideas SET project_id = NULL WHERE id = ? AND project_id = ?', itemId, id);
    else if (type === 'note') await run(ctx.db, 'UPDATE notes SET project_id = NULL WHERE id = ? AND project_id = ?', itemId, id);
    else await run(ctx.db, 'DELETE FROM project_links WHERE project_id = ? AND item_type = ? AND item_id = ?', id, type, itemId);
    return json(c, { ok: true });
  });

  // ───────── 收件箱 ─────────
  app.get('/inbox', async (c) => {
    const ctx = c.get('ctx');
    const [captures, candidates, dups, feedItems] = await Promise.all([
      all(ctx.db, "SELECT * FROM captures WHERE status = 'new' ORDER BY id DESC"),
      all(ctx.db, `SELECT p.id, p.title, p.venue, p.url, p.arxiv_id, p.summary, p.added_at, p.possible_dup_of,
          (SELECT r.kind FROM recommendations r WHERE r.paper_id = p.id ORDER BY r.id DESC LIMIT 1) AS rec_kind,
          (SELECT r.reason FROM recommendations r WHERE r.paper_id = p.id ORDER BY r.id DESC LIMIT 1) AS rec_reason,
          (SELECT s.name FROM recommendations r JOIN sources s ON s.id = r.source_id WHERE r.paper_id = p.id ORDER BY r.id DESC LIMIT 1) AS source_name
        FROM papers p WHERE p.stage = 'candidate' ORDER BY p.id DESC`),
      all(ctx.db, `SELECT p.id, p.title, p.stage, p.possible_dup_of, d.title AS dup_title FROM papers p JOIN papers d ON d.id = p.possible_dup_of
        WHERE p.possible_dup_of IS NOT NULL ORDER BY p.id DESC`),
      all(ctx.db, `SELECT fi.id, fi.title, fi.date, fi.read_state, fi.triage, ft.name AS task_name FROM feed_items fi LEFT JOIN feed_tasks ft ON ft.id = fi.task_id
        WHERE fi.triage != 'done' AND fi.archived = 0 ORDER BY fi.date DESC, fi.id DESC LIMIT 50`),
    ]);
    return json(c, { captures, candidates, dups, feed_items: feedItems });
  });

  app.post('/captures', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.content || !String(b.content).trim()) throw bad('内容不能为空');
    const id = await insert(ctx, 'captures', { content: String(b.content).trim(), status: 'new' });
    return json(c, await first(ctx.db, 'SELECT * FROM captures WHERE id = ?', id), 201);
  });

  app.patch('/captures/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    if ('status' in b && !['new', 'done', 'archived'].includes(b.status)) throw bad('状态不正确');
    await update(ctx, 'captures', id, b);
    return json(c, await first(ctx.db, 'SELECT * FROM captures WHERE id = ?', id));
  });

  app.delete('/captures/:id', async (c) => {
    const ctx = c.get('ctx');
    await remove(ctx, 'captures', idParam(c.req.param('id')));
    return json(c, { ok: true });
  });

  // ───────── 定时任务与信息流 ─────────
  app.get('/feeds/day', async c => json(c, await feedDay(c.get('ctx'), c.req.query('date') || todayLocal(c.get('ctx').tz))));

  app.get('/feeds', async (c) => {
    const ctx = c.get('ctx');
    const tasks = await all(ctx.db, `SELECT ft.*,
        (SELECT MAX(COALESCE(fr.finished_at, fr.created_at)) FROM feed_runs fr WHERE fr.task_id = ft.id) AS last_run_at,
        (SELECT fr.status FROM feed_runs fr WHERE fr.task_id = ft.id ORDER BY fr.id DESC LIMIT 1) AS last_run_status,
        (SELECT fr.message FROM feed_runs fr WHERE fr.task_id = ft.id ORDER BY fr.id DESC LIMIT 1) AS last_run_message,
        (SELECT MAX(fi.date) FROM feed_items fi WHERE fi.task_id = ft.id) AS last_item_date,
        (SELECT COUNT(*) FROM feed_items fi WHERE fi.task_id = ft.id) AS item_count,
        (SELECT COUNT(*) FROM feed_items fi WHERE fi.task_id = ft.id AND fi.read_state = 'unread' AND fi.archived = 0) AS unread_count,
        (SELECT b.task_key FROM feed_task_bindings b WHERE b.task_id = ft.id) AS bridge_key
      FROM feed_tasks ft ORDER BY ft.status, ft.id`);
    const now = Date.now();
    return json(c, {
      tasks: tasks.map((t: any) => {
        let health = 'ok';
        let label = '正常';
        if (t.status === 'paused') {
          health = 'paused';
          label = '已暂停';
        } else if (t.last_run_status === 'failed') {
          health = 'failed';
          label = '执行失败';
        } else if (t.last_run_status === 'partial') {
          health = 'partial';
          label = '部分成功';
        } else if (t.cadence_days) {
          const last = t.last_run_at ? Date.parse(t.last_run_at) : 0;
          if (!last || now - last > t.cadence_days * 1.5 * 86400_000) {
            health = 'stale';
            label = '未收到新结果';
          }
        }
        return { ...t, health, health_label: label };
      }),
    });
  });

  app.post('/feeds/tasks', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.name) throw bad('名称不能为空');
    const id = await insert(ctx, 'feed_tasks', {
      ...feedTaskTiming(b), name: b.name, runner: ['server', 'codex', 'claude', 'chatgpt', 'manual'].includes(b.runner) ? b.runner : 'manual', schedule: b.schedule || null,
      cadence_days: b.cadence_days ? Number(b.cadence_days) : null, sources: b.sources || null, description: b.description || null, status: 'active',
    });
    if (b.bridge_key) await setBridgeKey(ctx, id, b.bridge_key);
    return json(c, await first(ctx.db, 'SELECT * FROM feed_tasks WHERE id = ?', id), 201);
  });

  app.patch('/feeds/tasks/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b=await body(c);
    if ('bridge_key' in b) await setBridgeKey(ctx, id, b.bridge_key);
    await update(ctx, 'feed_tasks', id, {...b,...feedTaskTiming(b)});
    if (b.name) await refreshBridgeName(ctx, id);
    return json(c, await first(ctx.db, 'SELECT * FROM feed_tasks WHERE id = ?', id));
  });

  app.delete('/feeds/tasks/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    await setBridgeKey(ctx, id, null);
    await remove(ctx, 'feed_tasks', id, [stmt(ctx.db, 'UPDATE feed_items SET task_id = NULL WHERE task_id = ?', id)]);
    return json(c, { ok: true });
  });

  // 回传一次运行结果（定时任务 / Claude 定时任务 / 手动上传）。run_key 相同的重复回传只记一次。
  app.post('/feeds/runs', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const result = await saveFeedRun(ctx, b);
    return json(c, result, result.replayed ? 200 : 201);
  });

  app.get('/feeds/runs', async (c) => {
    const ctx = c.get('ctx');
    const tid = int(c.req.query('task_id'));
    return json(c, { runs: await all(ctx.db, `SELECT * FROM feed_runs ${tid ? 'WHERE task_id = ?' : ''} ORDER BY id DESC LIMIT 100`, ...(tid ? [tid] : [])) });
  });

  app.get('/feeds/items', async (c) => {
    const ctx = c.get('ctx');
    const tid = int(c.req.query('task_id'));
    const f = c.req.query('filter') || 'active';
    const where: string[] = [];
    const params: unknown[] = [];
    if (tid) {
      where.push('fi.task_id = ?');
      params.push(tid);
    }
    if (f === 'active') where.push('fi.archived = 0');
    if (f === 'untriaged') where.push("fi.triage != 'done' AND fi.archived = 0");
    if (f === 'unread') where.push("fi.read_state = 'unread' AND fi.archived = 0");
    if (f === 'archived') where.push('fi.archived = 1');
    const rows = await all(ctx.db, `SELECT fi.id, fi.task_id, fi.run_id, fi.title, fi.date, fi.url, fi.saved_kind, fi.read_state, fi.triage, fi.archived, fi.reviewed_at, fi.created_at,
        ft.name AS task_name, LENGTH(fi.content) AS length,
        (SELECT COUNT(*) FROM recommendations r WHERE r.source_id = fi.source_id AND fi.source_id IS NOT NULL) AS extracted
      FROM feed_items fi LEFT JOIN feed_tasks ft ON ft.id = fi.task_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fi.date DESC, fi.id DESC LIMIT 200`, ...params);
    return json(c, { items: rows });
  });

  app.get('/feeds/items/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const item = await first(ctx.db, 'SELECT fi.*, ft.name AS task_name FROM feed_items fi LEFT JOIN feed_tasks ft ON ft.id = fi.task_id WHERE fi.id = ?', id);
    if (!item) throw notFound('动态');
    // 从这期动态里提取过的论文（所有以这期为来源的导入批次）
    const papers = await all(ctx.db, `SELECT DISTINCT p.id, p.title, p.stage FROM recommendations r JOIN sources s ON s.id = r.source_id JOIN papers p ON p.id = r.paper_id
      WHERE s.kind = 'feed' AND (s.id = ? OR s.url = ?)`, item.source_id ?? 0, `feed_item:${id}`);
    return json(c, { item, papers });
  });

  app.post('/feeds/items', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const task = b.task_id ? await first(ctx.db, 'SELECT * FROM feed_tasks WHERE id = ?', int(b.task_id)) : null;
    let runId: number | null = null;
    if (task) {
      const r = await run(ctx.db, 'INSERT INTO feed_runs(task_id, status, finished_at, item_count, message, created_at) VALUES (?,?,?,?,?,?)',
        task.id, 'success', nowIso(), 1, '手动上传', nowIso());
      runId = Number(r.meta.last_row_id);
    }
    const item = await createFeedItem(ctx, task, runId, b);
    return json(c, item, 201);
  });

  app.patch('/feeds/items/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const patch: Record<string, any> = {};
    if ('review_completed' in b) {
      if (ctx.actor !== 'web') throw bad('阅读完成请在网页上手动确认');
      if (typeof b.review_completed !== 'boolean') throw bad('完成状态必须为布尔值');
      const current=await first(ctx.db,'SELECT reviewed_at FROM feed_items WHERE id=?',id);
      if (!current) throw notFound('动态');
      patch.reviewed_at=b.review_completed ? current.reviewed_at || nowIso() : null;
    }
    if ('read_state' in b) patch.read_state = b.read_state === 'read' ? 'read' : 'unread';
    if ('triage' in b) {
      if (!['untriaged', 'partial', 'done'].includes(b.triage)) throw bad('整理状态不正确');
      patch.triage = b.triage;
    }
    if ('archived' in b) patch.archived = b.archived ? 1 : 0;
    for (const k of ['title', 'url', 'date']) if (k in b) patch[k] = b[k];
    await update(ctx, 'feed_items', id, patch);
    return json(c, await first(ctx.db, 'SELECT * FROM feed_items WHERE id = ?', id));
  });

  app.delete('/feeds/items/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除动态需要确认', { needs_confirm: true });
    await remove(ctx, 'feed_items', id);
    return json(c, { ok: true });
  });

  // ───────── 历史与导出 ─────────
  app.get('/changes', async (c) => {
    const ctx = c.get('ctx');
    const entity = c.req.query('entity');
    const eid = int(c.req.query('entity_id'));
    const limit = Math.min(500, int(c.req.query('limit')) || 100);
    const rows = entity
      ? await all(ctx.db, `SELECT * FROM changes WHERE entity = ? ${eid ? 'AND entity_id = ?' : ''} ORDER BY id DESC LIMIT ${limit}`, entity, ...(eid ? [eid] : []))
      : await all(ctx.db, `SELECT * FROM changes ORDER BY id DESC LIMIT ${limit}`);
    return json(c, { changes: rows });
  });

  app.get('/export', async (c) => {
    const ctx = c.get('ctx');
    const tables = ['settings', 'sources', 'changes', 'projects', 'conference_targets', 'paper_groups', 'project_links', 'weeks', 'goals', 'goal_tasks', 'schedule_events', 'days', 'tasks', 'task_time_blocks', 'sessions', 'timer_pauses', 'background_sessions', 'papers', 'recommendations',
      'reading_plans', 'reading_logs', 'notes', 'ideas', 'idea_papers', 'doc_versions', 'captures', 'feed_tasks', 'feed_runs', 'feed_items', 'feed_task_bindings', 'feed_report_versions'];
    const out: Record<string, any[]> = {};
    for (const t of tables) out[t] = await all(ctx.db, `SELECT * FROM ${t}`);
    return json(c, { exported_at: nowIso(), schema_version: 14, tables: out });
  });

  app.get('/health', (c) => json(c, { ok: true, defaults: Object.keys(DEFAULT_SETTINGS).length }));
}

async function createFeedItem(ctx: any, task: any, runId: number | null, it: Record<string, any>) {
  if (!it.title) throw bad('动态缺少标题');
  const date = isDate(it.date) ? it.date : todayLocal(ctx.tz);
  const src = await run(ctx.db, 'INSERT INTO sources(kind, name, channel, url, raw, actor, created_at) VALUES (?,?,?,?,?,?,?)',
    'feed', `${task?.name ? task.name + ' · ' : ''}${it.title}`, task?.runner || 'manual', it.url || null, it.content ? String(it.content).slice(0, 400_000) : null, ctx.actor, nowIso());
  const sourceId = Number(src.meta.last_row_id);
  const id = await insert(ctx, 'feed_items', {
    task_id: task?.id ?? null, run_id: runId, title: String(it.title).slice(0, 300), date, content: it.content || '', url: it.url || null,
    saved_kind: it.saved_kind === 'raw' ? 'raw' : 'summary', read_state: 'unread', triage: 'untriaged', archived: 0, source_id: sourceId,
  });
  await run(ctx.db, 'UPDATE sources SET url = COALESCE(url, ?) WHERE id = ?', `feed_item:${id}`, sourceId);
  return { id, title: it.title, date, source_id: sourceId };
}

// ChatGPT 日报归档：一个定时任务可以绑定一个归档编号（task_key），ChatGPT 只能归档到已绑定的任务。
// 已经归档过报告的编号不能修改或取消（报告的版本记录引用它）。
async function setBridgeKey(ctx: any, taskId: number, raw: unknown) {
  const key = raw == null ? '' : String(raw).trim();
  if (key && !/^[a-z][a-z0-9_]{1,39}$/.test(key)) throw bad('归档编号只能用小写字母、数字和下划线，以字母开头，2–40 个字符');
  const cur = await first(ctx.db, 'SELECT * FROM feed_task_bindings WHERE task_id = ?', taskId);
  if (cur && cur.task_key === key) return;
  const used = async (k: string) => (await first(ctx.db, 'SELECT COUNT(*) AS n FROM feed_report_versions WHERE task_key = ?', k))?.n || 0;
  if (cur && (await used(cur.task_key))) throw conflict('这个任务已经有 ChatGPT 归档的报告，归档编号不能修改或取消');
  if (key && (await first(ctx.db, 'SELECT task_id FROM feed_task_bindings WHERE task_key = ? AND task_id != ?', key, taskId))) throw conflict('这个归档编号已被其他任务使用');
  if (cur) await run(ctx.db, 'DELETE FROM feed_task_bindings WHERE task_id = ?', taskId);
  if (!key) return;
  const task = await first(ctx.db, 'SELECT name FROM feed_tasks WHERE id = ?', taskId);
  if (!task) throw notFound('定时任务');
  await run(ctx.db, 'INSERT INTO feed_task_bindings(task_key, task_id, task_name, aliases) VALUES (?, ?, ?, ?)', key, taskId, task.name, JSON.stringify([task.name]));
}

async function refreshBridgeName(ctx: any, taskId: number) {
  const cur = await first(ctx.db, 'SELECT b.*, t.name FROM feed_task_bindings b JOIN feed_tasks t ON t.id = b.task_id WHERE b.task_id = ?', taskId);
  if (!cur) return;
  const aliases: string[] = JSON.parse(cur.aliases || '[]');
  if (!aliases.includes(cur.name)) aliases.push(cur.name);
  await run(ctx.db, 'UPDATE feed_task_bindings SET aliases = ? WHERE task_id = ?', JSON.stringify(aliases), taskId);
}
