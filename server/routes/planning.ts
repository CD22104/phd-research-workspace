import { currentFocus, pauseFocus, resumeFocus, focusElapsed } from '../lib/focus-timer';
import { sessionSegments } from '../lib/session-segments';
import { activeBackground } from './background';
import { readingState } from '../lib/reading';
import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, getSettings, idParam, insert, int, notFound, pick, remove, run, stmt, update, type Ctx } from '../db';
import { addDays, isDate, localMidnightMs, nowIso, todayLocal, weekStart } from '../lib/time';
import { aggregateDays, periodSummary, sessionsBetween } from '../lib/stats';

export const body = async (c: any): Promise<Record<string, any>> => {
  try {
    const j = await c.req.json();
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
};

function dateParam(v: string | undefined, ctx: Ctx): string {
  if (!v || v === 'today') return todayLocal(ctx.tz);
  if (!isDate(v)) throw bad('日期格式应为 YYYY-MM-DD');
  return v;
}

const PERIOD_KEYS = ['morning', 'afternoon', 'evening'];
const PERIOD_ALIAS: Record<string, string> = { 早: 'morning', 中: 'afternoon', 晚: 'evening', 上午: 'morning', 下午: 'afternoon', 晚上: 'evening' };
/** 日任务时段：undefined = 没有传；null / '' = 未定时段 */
export function periodParam(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const key = PERIOD_ALIAS[String(v)] || String(v);
  if (!PERIOD_KEYS.includes(key)) throw bad('时段应为 morning / afternoon / evening（上午 / 下午 / 晚上）');
  return key;
}
/** 上午 = 12:00 前，下午 = 12:00–18:00，晚上 = 18:00 后 */
export const periodOfMinute = (m: number) => (m < 720 ? 'morning' : m < 1080 ? 'afternoon' : 'evening');

async function ensureDay(ctx: Ctx, date: string) {
  const ts = nowIso();
  await run(ctx.db, 'INSERT OR IGNORE INTO days(date, created_at, updated_at) VALUES (?, ?, ?)', date, ts, ts);
}

async function ensureWeek(ctx: Ctx, monday: string) {
  const ts = nowIso();
  await run(ctx.db, 'INSERT OR IGNORE INTO weeks(id, created_at, updated_at) VALUES (?, ?, ?)', monday, ts, ts);
}

const TASK_SELECT = `
  SELECT t.*, g.title AS goal_title, p.title AS paper_title, i.title AS idea_title,
         gt.status AS goal_task_status, gt.done_at AS goal_task_done_at,
         COALESCE(t.project_id, g.project_id) AS project_id, pr.name AS project_name, pr.color AS project_color,
         rp.depth AS plan_depth, rp.purpose AS plan_purpose, rp.status AS plan_status, rp.paper_id AS plan_paper_id
  FROM tasks t
  LEFT JOIN goals g ON g.id = t.goal_id
  LEFT JOIN goal_tasks gt ON gt.id = t.goal_task_id
  LEFT JOIN papers p ON p.id = t.paper_id
  LEFT JOIN ideas i ON i.id = t.idea_id
  LEFT JOIN projects pr ON pr.id = COALESCE(t.project_id, g.project_id)
  LEFT JOIN reading_plans rp ON rp.id = t.plan_id`;

function storedPaperIds(row: any): number[] {
  let ids: unknown = row.paper_ids;
  try { if (typeof ids === 'string') ids = JSON.parse(ids); } catch { ids = []; }
  const out = Array.isArray(ids) ? ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
  return [...new Set(out.length ? out : row.paper_id ? [Number(row.paper_id)] : [])];
}

async function paperFields(ctx: Ctx, b: Record<string, any>, cur?: any) {
  if (cur && !['paper_ids', 'paper_id', 'plan_id'].some(k => k in b)) return {};
  let ids: number[];
  if ('paper_ids' in b) {
    if (!Array.isArray(b.paper_ids) || b.paper_ids.some((v: any) => !Number.isInteger(Number(v)) || Number(v) <= 0)) throw bad('论文编号必须为正整数数组');
    ids = [...new Set<number>(b.paper_ids.map(Number))];
  } else if ('paper_id' in b) {
    const id = int(b.paper_id);
    if (b.paper_id != null && b.paper_id !== '' && (!id || id <= 0)) throw bad('论文编号不正确');
    ids = id ? [id] : [];
  } else ids = cur ? storedPaperIds(cur) : [];
  if (ids.length > 50) throw bad('每个任务最多关联 50 篇论文');
  const planId = int('plan_id' in b ? b.plan_id : cur?.plan_id);
  if (planId) {
    const plan = await first(ctx.db, 'SELECT paper_id FROM reading_plans WHERE id = ?', planId);
    if (!plan) throw notFound('阅读计划');
    if (!ids.length && !('paper_ids' in b) && !('paper_id' in b)) ids = [plan.paper_id];
    if (!ids.includes(plan.paper_id)) throw bad('阅读计划必须属于任务关联的论文');
  }
  if (ids.length) {
    const found = await all(ctx.db, `SELECT id FROM papers WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    if (found.length !== ids.length) throw bad('关联的论文不存在');
  }
  return { paper_ids: ids, paper_id: ids.length === 1 ? ids[0] : null };
}

async function withPapers(ctx: Ctx, rows: any[]) {
  const ids = [...new Set(rows.flatMap(storedPaperIds))];
  const [papers, plans] = ids.length ? await Promise.all([
    all(ctx.db, 'SELECT id, title FROM papers WHERE id IN (SELECT value FROM json_each(?))', ids),
    all(ctx.db, `SELECT paper_id, status, depth, priority, purpose, focus_sections, done_at, updated_at
      FROM reading_plans WHERE paper_id IN (SELECT value FROM json_each(?)) ORDER BY id`, ids),
  ]) : [[], []];
  const byPaper = new Map<number, any[]>();
  for (const plan of plans) {
    if (!byPaper.has(plan.paper_id)) byPaper.set(plan.paper_id, []);
    byPaper.get(plan.paper_id)!.push(plan);
  }
  const byId = new Map(papers.map(p => [p.id, { ...p, reading: readingState(byPaper.get(p.id) || []) }]));
  return rows.map(row => {
    const paper_ids = storedPaperIds(row).filter(id => byId.has(id));
    return { ...row, paper_ids, papers: paper_ids.map(id => byId.get(id)) };
  });
}

async function taskById(ctx: Ctx, id: number) {
  const row = await first(ctx.db, `${TASK_SELECT} WHERE t.id = ?`, id);
  if (!row) throw notFound('任务');
  return (await withPapers(ctx, [row]))[0];
}

async function goalTasks(ctx: Ctx, where: string, ...params: unknown[]) {
  const rows = await all(ctx.db, `SELECT gt.*, g.title AS goal_title, g.week_id,
      p.title AS paper_title, rp.depth AS plan_depth, rp.purpose AS plan_purpose, rp.paper_id AS plan_paper_id, pr.name AS project_name,
      (SELECT json_group_array(date) FROM (SELECT date FROM tasks WHERE goal_task_id = gt.id AND status NOT IN ('dropped', 'moved') ORDER BY date)) AS scheduled_dates,
      (SELECT json_group_array(json_object('date', date, 'period', period)) FROM (SELECT date, period FROM tasks WHERE goal_task_id = gt.id AND status NOT IN ('dropped', 'moved') ORDER BY date)) AS scheduled,
      (SELECT date FROM tasks WHERE goal_task_id = gt.id AND status = 'done' ORDER BY done_at DESC LIMIT 1) AS completed_date,
      (SELECT id FROM tasks WHERE goal_task_id = gt.id AND status = 'done' ORDER BY done_at DESC LIMIT 1) AS completed_task_id
    FROM goal_tasks gt JOIN goals g ON g.id = gt.goal_id
    LEFT JOIN papers p ON p.id = gt.paper_id LEFT JOIN reading_plans rp ON rp.id = gt.plan_id
    LEFT JOIN projects pr ON pr.id = COALESCE(gt.project_id, g.project_id)
    WHERE ${where} ORDER BY g.sort, g.id, gt.sort, gt.id`, ...params);
  return (await withPapers(ctx, rows)).map(row => ({ ...row, scheduled_dates: JSON.parse(row.scheduled_dates || '[]'), scheduled: JSON.parse(row.scheduled || '[]') }));
}

function planningError(e: any): never {
  if (/goal_task_completed|tasks_goal_task_done_once/.test(e.message)) throw conflict('这个子任务已经完成；撤销完成后才能重新安排或计时');
  if (/UNIQUE constraint failed: tasks.goal_task_id, tasks.date/.test(e.message)) throw conflict('这个子任务当天已有安排');
  if (/goal_task_goal_mismatch/.test(e.message)) throw bad('子任务与周目标不一致');
  throw e;
}

function cancelFuture(ctx: Ctx, id: number, ts: string) {
  // 当天及历史未完成记录保留；未来还没执行的安排从计划分母移除。
  return stmt(ctx.db, `UPDATE tasks SET status = 'dropped', completion_cancelled = 1, updated_at = ?
    WHERE goal_task_id = ? AND date > ? AND status = 'todo'
      AND EXISTS(SELECT 1 FROM goal_tasks WHERE id = ? AND status = 'done')
      AND NOT EXISTS(SELECT 1 FROM sessions WHERE task_id = tasks.id)`, ts, id, todayLocal(ctx.tz), id);
}

async function scheduleGoalTask(ctx: Ctx, id: number, date: string, planned?: boolean, existingTaskId?: number) {
  const gt = await first(ctx.db, 'SELECT * FROM goal_tasks WHERE id = ?', id);
  if (!gt) throw notFound('子任务');
  const previous = await first(ctx.db, 'SELECT id FROM tasks WHERE goal_task_id = ? AND date = ?', id, date);
  if (existingTaskId) {
    const existing = await first(ctx.db, 'SELECT * FROM tasks WHERE id = ?', existingTaskId);
    if (!existing) throw notFound('日任务');
    if (existing.date !== date) throw bad('只能关联同一天的日任务');
    if (existing.goal_task_id === id) return { ...(await taskById(ctx, existingTaskId)), already: true };
    if (previous || existing.goal_task_id || existing.status !== 'todo' || gt.status !== 'todo') throw conflict('日任务或周子任务已关联或完成，请刷新后再操作');
    if (existing.goal_id && existing.goal_id !== gt.goal_id) throw bad('日任务已属于其他周目标');
    const ts = nowIso();
    const result = await ctx.db.batch([
      stmt(ctx.db, `UPDATE tasks SET goal_task_id = ?, goal_id = ?, updated_at = ?
        WHERE id = ? AND updated_at = ? AND goal_task_id IS NULL AND status = 'todo'
          AND EXISTS(SELECT 1 FROM goal_tasks WHERE id = ? AND status = 'todo')`, id, gt.goal_id, ts, existingTaskId, existing.updated_at, id),
      stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,origin,created_at)
        SELECT 'task',?,'update','goal_task_id',NULL,?,?,'将已有日任务关联到周子任务',? WHERE changes() = 1`, existingTaskId, String(id), ctx.actor, ts),
    ]);
    if (result[0].meta.changes !== 1) throw conflict('任务刚刚发生变化，请刷新后再关联');
    return taskById(ctx, existingTaskId);
  }
  if (previous) {
    // 已完成主条目的重复请求只返回原记录；不会反写历史安排或计划分母。
    if (gt.status === 'todo') await run(ctx.db, `UPDATE tasks SET status = 'todo', done_at = NULL, completion_cancelled = 0,
      planned = CASE WHEN date >= ? THEN COALESCE(?, planned) ELSE planned END, updated_at = ?
      WHERE id = ? AND status IN ('todo', 'dropped', 'moved')
        AND EXISTS(SELECT 1 FROM goal_tasks WHERE id = ? AND status = 'todo')`,
      todayLocal(ctx.tz), planned == null ? null : planned ? 1 : 0, nowIso(), previous.id, id);
    return { ...(await taskById(ctx, previous.id)), already: true };
  }
  if (gt.status === 'done') throw conflict('这个子任务已经完成，不能继续安排');
  const ts = nowIso();
  try {
    await run(ctx.db, `INSERT INTO tasks(date, title, goal_id, goal_task_id, project_id, paper_id, paper_ids, plan_id, idea_id, points, criteria, note, status, planned, sort, created_at, updated_at)
      SELECT ?, gt.title, gt.goal_id, gt.id, COALESCE(gt.project_id, g.project_id), gt.paper_id, gt.paper_ids, gt.plan_id, gt.idea_id, gt.points, gt.criteria, gt.note, 'todo',
        COALESCE(?, CASE WHEN EXISTS(SELECT 1 FROM days WHERE date = ? AND checkin_at IS NOT NULL) THEN 0 ELSE 1 END),
        (SELECT COALESCE(MAX(sort),0)+1 FROM tasks WHERE date = ?), ?, ?
      FROM goal_tasks gt JOIN goals g ON g.id = gt.goal_id WHERE gt.id = ? AND gt.status = 'todo'
      ON CONFLICT(goal_task_id, date) WHERE goal_task_id IS NOT NULL DO NOTHING`, date, planned == null ? null : planned ? 1 : 0, date, date, ts, ts, id);
  } catch (e) { planningError(e); }
  const row = await first(ctx.db, 'SELECT id FROM tasks WHERE goal_task_id = ? AND date = ?', id, date);
  if (!row) throw conflict('这个子任务刚刚完成，不能继续安排');
  return taskById(ctx, row.id);
}

/** 安排周子任务并（可选）设定时段：拖进某天的上午 / 下午 / 晚上 */
async function scheduleWithPeriod(ctx: Ctx, id: number, date: string, period: string | null | undefined, planned?: boolean, existingTaskId?: number) {
  const t: any = await scheduleGoalTask(ctx, id, date, planned, existingTaskId);
  if (period === undefined || t.status !== 'todo' || t.period === period) return t;
  await run(ctx.db, "UPDATE tasks SET period = ?, updated_at = ? WHERE id = ? AND status = 'todo'", period, nowIso(), t.id);
  return { ...(await taskById(ctx, t.id)), ...(t.already ? { already: true } : {}) };
}

const runningSession = currentFocus;

/** 计时关联：从任务 / 阅读计划推出论文、Idea、项目 */
async function resolveLinks(ctx: Ctx, b: Record<string, any>) {
  const out: Record<string, any> = {
    task_id: int(b.task_id), paper_id: int(b.paper_id), plan_id: int(b.plan_id), idea_id: int(b.idea_id), project_id: int(b.project_id),
    label: b.label ? String(b.label).slice(0, 200) : null,
  };
  if (out.task_id) {
    const t = await first(ctx.db, 'SELECT t.*, g.project_id AS goal_project, gt.status AS goal_task_status FROM tasks t LEFT JOIN goals g ON g.id = t.goal_id LEFT JOIN goal_tasks gt ON gt.id = t.goal_task_id WHERE t.id = ?', out.task_id);
    if (!t) throw notFound('任务');
    if (b._timer && (t.status !== 'todo' || t.goal_task_status === 'done')) throw conflict('这个任务已完成或取消，不能开始计时');
    out.paper_id ??= storedPaperIds(t).length === 1 ? t.paper_id : null;
    out.plan_id ??= storedPaperIds(t).length > 1 ? null : t.plan_id;
    out.idea_id ??= t.idea_id;
    out.project_id ??= t.project_id ?? t.goal_project;
    out.label ??= t.title;
  }
  if (out.plan_id) {
    const p = await first(ctx.db, 'SELECT * FROM reading_plans WHERE id = ?', out.plan_id);
    if (p) {
      out.paper_id ??= p.paper_id;
      out.idea_id ??= p.idea_id;
      out.project_id ??= p.project_id;
    }
  }
  if (!out.label && out.paper_id) out.label = (await first(ctx.db, 'SELECT title FROM papers WHERE id = ?', out.paper_id))?.title ?? null;
  if (!out.label && out.idea_id) out.label = (await first(ctx.db, 'SELECT title FROM ideas WHERE id = ?', out.idea_id))?.title ?? null;
  return out;
}

async function overlaps(ctx: Ctx, start: string, end: string, exceptId = 0) {
  return all(ctx.db, `SELECT id, label, start_at, end_at FROM sessions
    WHERE id != ? AND start_at < ? AND COALESCE(end_at, ?) > ?`, exceptId, end, nowIso(), start);
}

function validIso(v: unknown): string {
  const t = Date.parse(String(v));
  if (!v || Number.isNaN(t)) throw bad('时间格式不正确');
  return new Date(t).toISOString();
}

export function registerPlanning(app: App) {
  // ───────── 今日 / 某一天 ─────────
  app.get('/day/:date', async (c) => {
    const ctx = c.get('ctx');
    const date = dateParam(c.req.param('date'), ctx);
    const s = await getSettings(ctx.db);
    const monday = weekStart(date);
    const [day, tasks, week, goals, agg, sess, pending, goal_tasks] = await Promise.all([
      first(ctx.db, 'SELECT * FROM days WHERE date = ?', date),
      all(ctx.db, `${TASK_SELECT} WHERE t.date = ? ORDER BY t.sort, t.id`, date),
      first(ctx.db, 'SELECT * FROM weeks WHERE id = ?', monday),
      all(ctx.db, 'SELECT g.*, p.name AS project_name FROM goals g LEFT JOIN projects p ON p.id = g.project_id WHERE g.week_id = ? ORDER BY g.sort, g.id', monday),
      aggregateDays(ctx, date, date, s),
      sessionsBetween(ctx, date, date),
      all(ctx.db, `SELECT date, COUNT(*) AS n FROM tasks t WHERE status = 'todo' AND date < ? AND date >= ? AND NOT EXISTS(SELECT 1 FROM goal_tasks gt WHERE gt.id = t.goal_task_id AND gt.status = 'done') GROUP BY date ORDER BY date DESC`, date, addDays(date, -14)),
      goalTasks(ctx, 'g.week_id = ?', monday),
    ]);
    const dayStart = localMidnightMs(date, ctx.tz);
    const dayEnd = localMidnightMs(addDays(date, 1), ctx.tz);
    const byTask: Record<number, number> = {};
    for (const x of sess) {
      if (!x.task_id) continue;
      const a = Math.max(Date.parse(x.start_at), dayStart);
      const b = Math.min(x.end_at ? Date.parse(x.end_at) : Date.now(), dayEnd);
      if (b > a) byTask[x.task_id] = (byTask[x.task_id] || 0) + (b - a) / 60000;
    }
    return json(c, {
      date, today: todayLocal(ctx.tz), day, week, goals, goal_tasks,
      tasks: (await withPapers(ctx, tasks)).map((t: any) => ({ ...t, minutes: Math.round(byTask[t.id] || 0) })),
      summary: agg.get(date),
      sessions: sess,
      pending,
      settings: { daily_target_minutes: s.daily_target_minutes, show_grades: s.show_grades },
    });
  });

  app.put('/day/:date', async (c) => {
    const ctx = c.get('ctx');
    const date = dateParam(c.req.param('date'), ctx);
    const b = await body(c);
    await ensureDay(ctx, date);
    const patch: Record<string, any> = {};
    for (const k of ['kind', 'plan_note', 'review', 'mood', 'energy', 'target_minutes']) if (k in b) patch[k] = b[k] === '' ? null : b[k];
    if ('kind' in patch && patch.kind && !['work', 'rest', 'leave'].includes(patch.kind)) throw bad('日期类型只能是 work / rest / leave');
    if ('review' in patch) patch.reviewed_at = patch.review ? nowIso() : null;
    const keys = Object.keys(patch);
    if (keys.length) await run(ctx.db, `UPDATE days SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE date = ?`, ...Object.values(patch), nowIso(), date);
    return json(c, await first(ctx.db, 'SELECT * FROM days WHERE date = ?', date));
  });

  // 打卡：写下今天的主要目标。打卡之后新加的任务记为「计划外」
  app.post('/day/:date/checkin', async (c) => {
    const ctx = c.get('ctx');
    const date = dateParam(c.req.param('date'), ctx);
    const b = await body(c);
    await ensureDay(ctx, date);
    await run(ctx.db, 'UPDATE days SET checkin_at = COALESCE(checkin_at, ?), plan_note = COALESCE(?, plan_note), updated_at = ? WHERE date = ?',
      nowIso(), b.plan_note ?? null, nowIso(), date);
    return json(c, await first(ctx.db, 'SELECT * FROM days WHERE date = ?', date));
  });

  // ───────── 任务 ─────────
  app.post('/tasks', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const date = dateParam(b.date, ctx);
    const period = periodParam(b.period);
    if (b.goal_task_id) return json(c, await scheduleWithPeriod(ctx, idParam(String(b.goal_task_id)), date, period, b.planned == null ? undefined : !!b.planned), 201);
    if (!b.title || !String(b.title).trim()) throw bad('任务名称不能为空');
    const day = await first(ctx.db, 'SELECT checkin_at FROM days WHERE date = ?', date);
    const maxSort = await first(ctx.db, 'SELECT COALESCE(MAX(sort), 0) AS m FROM tasks WHERE date = ?', date);
    const row: Record<string, any> = {
      date, title: String(b.title).trim(), goal_id: int(b.goal_id), project_id: int(b.project_id),
      plan_id: int(b.plan_id), idea_id: int(b.idea_id), points: Math.max(1, Math.min(8, int(b.points) || 1)), criteria: b.criteria || null,
      note: b.note || null, status: 'todo', planned: b.planned != null ? (b.planned ? 1 : 0) : day?.checkin_at ? 0 : 1, sort: (maxSort?.m || 0) + 1,
      period: period ?? null,
      ...(await paperFields(ctx, b)),
    };
    if (row.goal_id) {
      const goal = await first(ctx.db, 'SELECT project_id FROM goals WHERE id = ?', row.goal_id);
      if (!goal) throw notFound('周目标');
      row.project_id ??= goal.project_id;
    }
    const id = await insert(ctx, 'tasks', row);
    return json(c, await taskById(ctx, id), 201);
  });

  app.patch('/tasks/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const cur = await first(ctx.db, 'SELECT * FROM tasks WHERE id = ?', id);
    if (!cur) throw notFound('任务');
    const b = await body(c);
    const patch: Record<string, any> = { ...b, ...(await paperFields(ctx, b, cur)) };
    if ('title' in b && !String(b.title || '').trim()) throw bad('任务名称不能为空');
    if ('status' in b) {
      if (!['todo', 'done', 'dropped', 'moved'].includes(b.status)) throw bad('任务状态不正确');
      patch.done_at = b.status === 'done' ? cur.done_at || nowIso() : null;
      patch.completion_cancelled = 0;
    } else delete patch.done_at;
    if ('points' in b) patch.points = Math.max(1, Math.min(8, int(b.points) || 1));
    if ('date' in b) patch.date = dateParam(b.date, ctx);
    if ('planned' in b) patch.planned = b.planned ? 1 : 0;
    if ('period' in b) patch.period = periodParam(b.period) ?? null;
    if (cur.goal_task_id && (('date' in b && b.date !== cur.date) || ('goal_id' in b && int(b.goal_id) !== cur.goal_id))) throw bad('周子任务的每日安排不能更换日期或周目标，请重新安排');
    for (const k of ['carried_from', 'goal_task_id']) delete patch[k];
    if (!('status' in b)) delete patch.completion_cancelled;
    const row = pick('tasks', patch);
    if (Object.keys(row).length) {
      const ts = nowIso();
      const batch = [stmt(ctx.db, `UPDATE tasks SET ${Object.keys(row).map(k => `${k} = ?`).join(',')}, updated_at = ? WHERE id = ?`, ...Object.values(row), ts, id)];
      if (cur.goal_task_id && b.status === 'done') batch.push(cancelFuture(ctx, cur.goal_task_id, ts));
      try { await ctx.db.batch(batch); } catch (e) { planningError(e); }
    }
    return json(c, await taskById(ctx, id));
  });

  app.delete('/tasks/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除任务需要确认', { needs_confirm: true });
    const t = await first(ctx.db, 'SELECT title FROM tasks WHERE id = ?', id);
    if (!t) throw notFound('任务');
    // 计时记录保留，只去掉关联，并把任务名留在记录里
    await remove(ctx, 'tasks', id, [stmt(ctx.db, 'UPDATE sessions SET task_id = NULL, label = COALESCE(label, ?) WHERE task_id = ?', t.title, id)]);
    return json(c, { ok: true });
  });

  app.get('/tasks/pending', async (c) => {
    const ctx = c.get('ctx');
    const before = dateParam(c.req.query('before'), ctx);
    const rows = await all(ctx.db, `${TASK_SELECT} WHERE t.status = 'todo' AND t.date < ? AND t.date >= ? AND COALESCE(gt.status, 'todo') != 'done' ORDER BY t.date DESC, t.sort`, before, addDays(before, -14));
    return json(c, { tasks: await withPapers(ctx, rows) });
  });

  app.get('/tasks/:id', async c => json(c, await taskById(c.get('ctx'), idParam(c.req.param('id')))));

  // 顺延未完成任务：原任务标记为「已顺延」（算那天未完成），在目标日期新建一条
  // 换时段 / 换日期：周计划排期板和今日页上午 / 下午 / 晚上之间拖动。
  // 同一天只改时段；换日期时，没有计时记录的安排直接搬过去（小时轴时段作废），有计时记录的保留原记录为「已顺延」并在新日期建一条。
  app.post('/tasks/:id/move', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const cur = await first(ctx.db, 'SELECT t.*, gt.status AS goal_task_status FROM tasks t LEFT JOIN goal_tasks gt ON gt.id = t.goal_task_id WHERE t.id = ?', id);
    if (!cur) throw notFound('任务');
    const date = 'date' in b ? dateParam(b.date, ctx) : cur.date;
    const period = 'period' in b ? periodParam(b.period) ?? null : cur.period ?? null;
    const ts = nowIso();
    if (date === cur.date) {
      if (period !== (cur.period ?? null)) await run(ctx.db, 'UPDATE tasks SET period = ?, updated_at = ? WHERE id = ?', period, ts, id);
      return json(c, await taskById(ctx, id));
    }
    if (cur.status !== 'todo' || cur.goal_task_status === 'done') throw conflict('已完成、已取消或已顺延的安排不能换到别的日期');
    if (await first(ctx.db, 'SELECT 1 AS x FROM sessions WHERE task_id = ? AND end_at IS NULL', id)) throw conflict('这项任务正在计时，先停止计时再换日期');
    const slots = (await first(ctx.db, 'SELECT COUNT(*) AS n FROM task_time_blocks WHERE task_id = ?', id))?.n || 0;
    if (slots && ctx.actor !== 'web' && b.confirm !== true) throw conflict('换日期会取消这项任务在原来那天排好的具体时段，需要确认', { needs_confirm: true, preview: { task_id: id, from: cur.date, to: date, hour_slots: slots } });
    const timed = !!(await first(ctx.db, 'SELECT 1 AS x FROM sessions WHERE task_id = ? LIMIT 1', id));
    const sortOn = `(SELECT COALESCE(MAX(sort), 0) + 1 FROM tasks WHERE date = ?)`;
    if (cur.goal_task_id) {
      const there = await first(ctx.db, 'SELECT id, status FROM tasks WHERE goal_task_id = ? AND date = ?', cur.goal_task_id, date);
      if (there?.status === 'todo') throw conflict('这个子任务那天已经有安排');
      if (there || timed) {
        // 目标日期有旧记录（已取消 / 已顺延）就恢复它；原安排有计时记录时保留为「已顺延」，否则删除
        const target: any = await scheduleWithPeriod(ctx, cur.goal_task_id, date, period);
        if (timed) await run(ctx.db, "UPDATE tasks SET status = 'moved', updated_at = ? WHERE id = ? AND status = 'todo'", ts, id);
        else await remove(ctx, 'tasks', id);
        return json(c, await taskById(ctx, target.id));
      }
    } else if (timed) {
      const nid = await insert(ctx, 'tasks', {
        paper_ids: cur.paper_ids, date, title: cur.title, goal_id: cur.goal_id, project_id: cur.project_id, paper_id: cur.paper_id, plan_id: cur.plan_id, idea_id: cur.idea_id,
        points: cur.points, criteria: cur.criteria, note: cur.note, status: 'todo', planned: cur.planned, carried_from: cur.id, period,
        sort: ((await first(ctx.db, 'SELECT COALESCE(MAX(sort), 0) AS m FROM tasks WHERE date = ?', date))?.m || 0) + 1,
      });
      await run(ctx.db, "UPDATE tasks SET status = 'moved', updated_at = ? WHERE id = ? AND status = 'todo'", ts, id);
      return json(c, await taskById(ctx, nid));
    }
    try {
      const result = await ctx.db.batch([
        stmt(ctx.db, `UPDATE tasks SET date = ?, period = ?, sort = ${sortOn}, updated_at = ? WHERE id = ? AND status = 'todo' AND updated_at = ?`, date, period, date, ts, id, cur.updated_at),
        stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,origin,created_at) SELECT 'task',?,'update','date',?,?,?,'换到其他日期',? WHERE changes() = 1`, id, cur.date, date, ctx.actor, ts),
        // 小时轴时段属于原来那天，换日期后作废
        stmt(ctx.db, 'DELETE FROM task_time_blocks WHERE task_id = ? AND EXISTS(SELECT 1 FROM tasks WHERE id = ? AND date = ? AND updated_at = ?)', id, id, date, ts),
      ]);
      if (result[0].meta.changes !== 1) throw conflict('任务刚刚发生变化，请刷新后再移动');
    } catch (e) { planningError(e); }
    return json(c, await taskById(ctx, id));
  });

  app.post('/tasks/carry', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const to = dateParam(b.to, ctx);
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
    if (!ids.length) throw bad('请选择要顺延的任务');
    const rows = await all(ctx.db, `SELECT * FROM tasks WHERE status = 'todo' AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
    const created: number[] = [];
    for (const t of rows as any[]) {
      if (t.date === to) continue;
      if (t.goal_task_id) {
        const gt = await first(ctx.db, 'SELECT status FROM goal_tasks WHERE id = ?', t.goal_task_id);
        if (gt?.status === 'done') continue;
        const scheduled = await scheduleWithPeriod(ctx, t.goal_task_id, to, t.period ?? undefined);
        await run(ctx.db, "UPDATE tasks SET status = 'moved', updated_at = ? WHERE id = ? AND status = 'todo'", nowIso(), t.id);
        created.push(scheduled.id);
        continue;
      }
      const nid = await insert(ctx, 'tasks', {
        paper_ids: t.paper_ids, date: to, title: t.title, goal_id: t.goal_id, project_id: t.project_id, paper_id: t.paper_id, plan_id: t.plan_id, idea_id: t.idea_id,
        points: t.points, criteria: t.criteria, note: t.note, status: 'todo', planned: 1, carried_from: t.id, sort: t.sort, period: t.period,
      });
      await run(ctx.db, "UPDATE tasks SET status = 'moved', updated_at = ? WHERE id = ?", nowIso(), t.id);
      created.push(nid);
    }
    return json(c, { created });
  });

  // ───────── 周计划 ─────────
  app.get('/week/:date', async (c) => {
    const ctx = c.get('ctx');
    const date = dateParam(c.req.param('date'), ctx);
    const sum = await periodSummary(ctx, 'week', date);
    const tasks = await withPapers(ctx, await all(ctx.db, `${TASK_SELECT} WHERE t.date BETWEEN ? AND ? ORDER BY t.date, t.sort, t.id`, sum.from, sum.to));
    const goal_tasks = await goalTasks(ctx, 'g.week_id = ?', sum.from);
    const sess = await sessionsBetween(ctx, sum.from, sum.to);
    const goalMin: Record<number, number> = {};
    for (const x of sess) if (x.goal_id) goalMin[x.goal_id] = (goalMin[x.goal_id] || 0) + ((x.end_at ? Date.parse(x.end_at) : Date.now()) - Date.parse(x.start_at)) / 60000;
    const goals = sum.goals.map((g: any) => {
      const children = goal_tasks.filter((t: any) => t.goal_id === g.id);
      const ts = children.length ? children : tasks.filter((t: any) => t.goal_id === g.id && !['moved', 'dropped'].includes(t.status));
      return { ...g, task_total: ts.length, task_done: ts.filter((t: any) => t.status === 'done').length, minutes: Math.round(goalMin[g.id] || 0) };
    });
    return json(c, { ...sum, week: sum.weeks[0] || { id: sum.from }, goals, tasks, goal_tasks });
  });

  app.put('/week/:monday', async (c) => {
    const ctx = c.get('ctx');
    const monday = weekStart(dateParam(c.req.param('monday'), ctx));
    const b = await body(c);
    await ensureWeek(ctx, monday);
    const keys = ['focus', 'target_minutes', 'review', 'conclusions', 'ruled_out', 'open_questions'].filter((k) => k in b);
    if (keys.length) await run(ctx.db, `UPDATE weeks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => (b[k] === '' ? null : b[k])), nowIso(), monday);
    return json(c, await first(ctx.db, 'SELECT * FROM weeks WHERE id = ?', monday));
  });

  app.post('/goals', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.title || !String(b.title).trim()) throw bad('目标不能为空');
    const monday = weekStart(dateParam(b.week_id, ctx));
    await ensureWeek(ctx, monday);
    const maxSort = await first(ctx.db, 'SELECT COALESCE(MAX(sort), 0) AS m FROM goals WHERE week_id = ?', monday);
    const id = await insert(ctx, 'goals', {
      week_id: monday, title: String(b.title).trim(), project_id: int(b.project_id), criteria: b.criteria || null,
      weight: Math.max(1, Math.min(5, int(b.weight) || 1)), due_date: b.due_date && isDate(b.due_date) ? b.due_date : null,
      status: 'open', progress: 0, note: b.note || null, sort: (maxSort?.m || 0) + 1,
    });
    return json(c, await first(ctx.db, 'SELECT * FROM goals WHERE id = ?', id), 201);
  });

  app.patch('/goals/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const b = await body(c);
    const patch: Record<string, any> = { ...b };
    if ('status' in b && !['open', 'done', 'dropped'].includes(b.status)) throw bad('目标状态不正确');
    if (b.status === 'done') patch.progress = 100;
    if ('progress' in b) patch.progress = Math.max(0, Math.min(100, int(b.progress) || 0));
    if ('weight' in b) patch.weight = Math.max(1, Math.min(5, int(b.weight) || 1));
    if ('due_date' in b) patch.due_date = b.due_date && isDate(b.due_date) ? b.due_date : null;
    delete patch.week_id;
    delete patch.carried_from;
    const child = await first(ctx.db, 'SELECT id FROM goal_tasks WHERE goal_id = ? LIMIT 1', id);
    if (child) { delete patch.progress; delete patch.status; }
    await update(ctx, 'goals', id, patch);
    return json(c, await first(ctx.db, 'SELECT * FROM goals WHERE id = ?', id));
  });

  app.delete('/goals/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除周目标需要确认', { needs_confirm: true });
    await remove(ctx, 'goals', id, [stmt(ctx.db, 'UPDATE tasks SET goal_id = NULL WHERE goal_id = ?', id)]);
    return json(c, { ok: true });
  });

  // 带到下周：复制未完成条目，保留旧周快照，重复点击复用同一目标与条目。
  app.post('/goals/carry', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const to = weekStart(dateParam(b.to_week, ctx));
    const from = b.from_week ? weekStart(dateParam(b.from_week, ctx)) : addDays(to, -7);
    if (to <= from) throw bad('目标周必须晚于原来的周');
    await ensureWeek(ctx, to);
    const goals = await all(ctx.db, "SELECT * FROM goals WHERE week_id = ? AND status = 'open'", from);
    const created: number[] = [];
    for (const g of goals as any[]) {
      const ts = nowIso();
      await ctx.db.batch([
        stmt(ctx.db, `INSERT INTO goals(week_id, title, project_id, criteria, weight, status, progress, note, sort, carried_from, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?) ON CONFLICT(carried_from, week_id) WHERE carried_from IS NOT NULL DO NOTHING`,
          to, g.title, g.project_id, g.criteria, g.weight, g.progress, g.note, g.sort, g.id, ts, ts),
        stmt(ctx.db, `INSERT INTO goal_tasks(goal_id, title, status, points, paper_id, paper_ids, plan_id, idea_id, project_id, criteria, note, sort, carried_from, created_at, updated_at)
          SELECT (SELECT id FROM goals WHERE carried_from = ? AND week_id = ?), title, 'todo', points, paper_id, paper_ids, plan_id, idea_id, project_id, criteria, note, sort, id, ?, ?
          FROM goal_tasks WHERE goal_id = ? AND status = 'todo'
          ON CONFLICT(carried_from, goal_id) WHERE carried_from IS NOT NULL DO NOTHING`, g.id, to, ts, ts, g.id),
      ]);
      created.push((await first(ctx.db, 'SELECT id FROM goals WHERE carried_from = ? AND week_id = ?', g.id, to))!.id);
    }
    return json(c, { created });
  });

  // ───────── 周目标子任务：一份主条目，可安排到多天 ─────────
  app.post('/goal-tasks', async c => {
    const ctx = c.get('ctx');
    const b = await body(c);
    if (!b.title || !String(b.title).trim()) throw bad('子任务名称不能为空');
    const goalId = idParam(String(b.goal_id || ''));
    const goal = await first(ctx.db, 'SELECT * FROM goals WHERE id = ?', goalId);
    if (!goal) throw notFound('周目标');
    const maxSort = await first(ctx.db, 'SELECT COALESCE(MAX(sort), 0) AS m FROM goal_tasks WHERE goal_id = ?', goalId);
    const id = await insert(ctx, 'goal_tasks', {
      goal_id: goalId, title: String(b.title).trim(), status: 'todo', points: Math.max(1, Math.min(8, int(b.points) || 1)),
      project_id: int(b.project_id) ?? goal.project_id, plan_id: int(b.plan_id), idea_id: int(b.idea_id),
      criteria: b.criteria || null, note: b.note || null, sort: (maxSort?.m || 0) + 1, ...(await paperFields(ctx, b)),
    });
    return json(c, (await goalTasks(ctx, 'gt.id = ?', id))[0], 201);
  });

  app.patch('/goal-tasks/:id', async c => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const cur = await first(ctx.db, 'SELECT * FROM goal_tasks WHERE id = ?', id);
    if (!cur) throw notFound('子任务');
    const b = await body(c);
    const patch: Record<string, any> = { ...b, ...(await paperFields(ctx, b, cur)) };
    if ('title' in b && !String(b.title || '').trim()) throw bad('子任务名称不能为空');
    if ('status' in b && !['todo', 'done'].includes(b.status)) throw bad('子任务状态只能为 todo / done');
    if ('points' in b) patch.points = Math.max(1, Math.min(8, int(b.points) || 1));
    for (const k of ['goal_id', 'carried_from', 'done_at']) delete patch[k];
    // 完成今日已有安排时记录真实完成；没有今日安排则只完成主条目。
    const ts = nowIso();
    if ('status' in b) patch.done_at = b.status === 'done' ? cur.done_at || ts : null;
    const row = pick('goal_tasks', patch);
    const batch: D1PreparedStatement[] = [];
    if (b.status === 'done' && cur.status !== 'done') batch.push(stmt(ctx.db, `UPDATE tasks SET status = 'done', done_at = ?, updated_at = ?
      WHERE goal_task_id = ? AND date = ? AND status = 'todo'
        AND EXISTS(SELECT 1 FROM goal_tasks WHERE id = ? AND status = 'todo')`, ts, ts, id, todayLocal(ctx.tz), id));
    if (Object.keys(row).length) batch.push(stmt(ctx.db, `UPDATE goal_tasks SET ${Object.keys(row).map(k => `${k} = ?`).join(',')}, updated_at = ? WHERE id = ?`, ...Object.values(row), ts, id));
    if (b.status === 'done') batch.push(cancelFuture(ctx, id, ts));
    if (batch.length) {
      batch.push(stmt(ctx.db, 'INSERT INTO changes(entity,entity_id,op,field,old,new,actor,created_at) VALUES (?,?,?,?,?,?,?,?)',
        'goal_task', id, 'update', 'details', JSON.stringify(cur), JSON.stringify(row), ctx.actor, ts));
      try { await ctx.db.batch(batch); } catch (e) { planningError(e); }
    }
    return json(c, (await goalTasks(ctx, 'gt.id = ?', id))[0]);
  });

  app.delete('/goal-tasks/:id', async c => {
    const ctx = c.get('ctx');
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除周子任务需要确认', { needs_confirm: true });
    await remove(ctx, 'goal_tasks', idParam(c.req.param('id')));
    return json(c, { ok: true });
  });

  app.post('/goal-tasks/:id/schedule', async c => {
    const ctx = c.get('ctx');
    const b = await body(c);
    return json(c, await scheduleWithPeriod(ctx, idParam(c.req.param('id')), dateParam(b.date, ctx), periodParam(b.period), b.planned == null ? undefined : !!b.planned, b.existing_task_id == null ? undefined : idParam(String(b.existing_task_id))), 201);
  });

  // ───────── 计时 ─────────
  app.get('/timer', async (c) => {
    const ctx = c.get('ctx');
    return json(c, { running: await runningSession(ctx), background: await activeBackground(ctx), now: nowIso() });
  });

  app.post('/timer/pause', async c => json(c, await pauseFocus(c.get('ctx'), idParam(String((await body(c)).session_id || '')))));
  app.post('/timer/resume', async c => json(c, await resumeFocus(c.get('ctx'), idParam(String((await body(c)).session_id || '')))));

  // 开始计时：全局同时只有一条正在计时（数据库唯一索引保证）；重复点开始同一任务不会多建记录
  app.post('/timer/start', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const links = await resolveLinks(ctx, { ...b, _timer: true });
    const running = await runningSession(ctx);
    const same = running && ['task_id', 'paper_id', 'plan_id', 'idea_id'].every((k) => (running as any)[k] === links[k]) && (running as any).label === links.label;
    if (running && same) return json(c, running.paused ? await resumeFocus(ctx,running.id) : { running, already: true });
    if (running && !b.switch) throw conflict('已经有一个正在进行的计时', { running });
    const ts = nowIso();
    const ins = stmt(ctx.db, `INSERT INTO sessions(task_id, project_id, paper_id, plan_id, idea_id, label, start_at, source, created_at, updated_at)
      SELECT ?,?,?,?,?,?,?,'timer',?,? WHERE NOT EXISTS(SELECT 1 FROM timer_pauses)`, links.task_id, links.project_id, links.paper_id, links.plan_id, links.idea_id, links.label, ts, ts, ts);
    try {
      const result = running ? await ctx.db.batch([
        stmt(ctx.db, 'UPDATE sessions SET end_at = ?, updated_at = ? WHERE id = ? AND end_at IS NULL',ts,ts,running.id),
        stmt(ctx.db, 'DELETE FROM timer_pauses WHERE session_id=?',running.id), ins,
      ]) : [await ins.run()];
      if (!result[result.length-1].meta.changes) throw conflict('计时状态已变化，请刷新后重试');
    } catch (e: any) {
      if (/UNIQUE/i.test(e.message)) throw conflict('另一台设备刚刚开始了计时', { running: await runningSession(ctx) });
      planningError(e);
    }
    // 开始阅读计划时，把计划标记为在读
    if (links.plan_id) await run(ctx.db, "UPDATE reading_plans SET status = 'reading', updated_at = ? WHERE id = ? AND status = 'planned'", ts, links.plan_id);
    return json(c, { running: await runningSession(ctx), stopped: (running as any) || null } as any);
  });

  // 停止计时：重复点击只会返回同一条记录
  app.post('/timer/stop', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const sid = int(b.session_id);
    const target = sid ? await first(ctx.db, 'SELECT * FROM sessions WHERE id = ?', sid) : await currentFocus(ctx);
    if (!target) return json(c, { stopped: null } as any);
    if (target.end_at) {
      const results=await ctx.db.batch([
        stmt(ctx.db,'UPDATE sessions SET note=COALESCE(?,note),updated_at=? WHERE id=? AND id=(SELECT session_id FROM timer_pauses WHERE id=1)',b.note || null,nowIso(),target.id),
        stmt(ctx.db,'DELETE FROM timer_pauses WHERE session_id=?',target.id),
      ]);
      const removed=results[1];
      if (removed.meta.changes && b.note) target.note=b.note;
      return json(c,{stopped:{...target,elapsed_ms:await focusElapsed(ctx,target)},already:!removed.meta.changes,running:await currentFocus(ctx)});
    }
    let end = nowIso();
    if (b.end_at) {
      end = validIso(b.end_at);
      if (end <= target.start_at || end > nowIso()) throw bad('结束时间要晚于开始时间，且不能晚于现在');
    }
    await run(ctx.db, 'UPDATE sessions SET end_at = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ? AND end_at IS NULL', end, b.note || null, nowIso(), target.id);
    const stopped=await first(ctx.db, 'SELECT * FROM sessions WHERE id = ?', target.id);
    return json(c, { stopped:{...stopped,elapsed_ms:await focusElapsed(ctx,stopped)},running:await currentFocus(ctx) });
  });

  // ───────── 计时记录 ─────────
  app.get('/sessions', async (c) => {
    const ctx = c.get('ctx');
    const to = dateParam(c.req.query('to'), ctx);
    const from = c.req.query('from') ? dateParam(c.req.query('from'), ctx) : addDays(to, -6);
    const rows = await sessionsBetween(ctx, from, to);
    return json(c, { from, to, sessions: rows.reverse(), segments:sessionSegments(rows,from,to,ctx.tz) });
  });

  app.post('/sessions', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const start = validIso(b.start_at);
    const end = validIso(b.end_at);
    if (end <= start) throw bad('结束时间要晚于开始时间');
    if (end > nowIso()) throw bad('不能补录未来的时间');
    const ov = await overlaps(ctx, start, end);
    if (ov.length) throw conflict('这段时间和已有的计时记录重叠（同一段时间只能算一次）', { overlaps: ov });
    const links = await resolveLinks(ctx, b);
    const id = await insert(ctx, 'sessions', { ...links, start_at: start, end_at: end, note: b.note || null, source: 'manual' });
    return json(c, await first(ctx.db, 'SELECT * FROM sessions WHERE id = ?', id), 201);
  });

  app.patch('/sessions/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const cur = await first(ctx.db, 'SELECT * FROM sessions WHERE id = ?', id);
    if (!cur) throw notFound('计时记录');
    const b = await body(c);
    const patch: Record<string, any> = {};
    if ('note' in b) patch.note = b.note || null;
    if ('label' in b) patch.label = b.label || null;
    for (const k of ['task_id', 'paper_id', 'plan_id', 'idea_id', 'project_id']) if (k in b) patch[k] = int(b[k]);
    const start = 'start_at' in b ? validIso(b.start_at) : cur.start_at;
    const end = 'end_at' in b ? (b.end_at ? validIso(b.end_at) : null) : cur.end_at;
    if (end && end <= start) throw bad('结束时间要晚于开始时间');
    if (!end && cur.end_at) throw bad('已结束的记录不能改回进行中');
    if ('start_at' in b || 'end_at' in b) {
      const ov = await overlaps(ctx, start, end || nowIso(), id);
      if (ov.length) throw conflict('这段时间和已有的计时记录重叠', { overlaps: ov });
      patch.start_at = start;
      patch.end_at = end;
    }
    await update(ctx, 'sessions', id, patch);
    return json(c, await first(ctx.db, 'SELECT * FROM sessions WHERE id = ?', id));
  });

  app.delete('/sessions/:id', async (c) => {
    const ctx = c.get('ctx');
    await remove(ctx, 'sessions', idParam(c.req.param('id')));
    return json(c, { ok: true });
  });

  // ───────── 统计 ─────────
  app.get('/stats', async (c) => {
    const ctx = c.get('ctx');
    const range = c.req.query('range') || 'week';
    const date = dateParam(c.req.query('date'), ctx);
    if (range === 'day') {
      const s = await getSettings(ctx.db);
      const agg = await aggregateDays(ctx, date, date, s);
      const sess = await sessionsBetween(ctx, date, date);
      return json(c, { range, from: date, to: date, today: todayLocal(ctx.tz), days: [...agg.values()], sessions: sess, breakdown: breakdown(sess, date, date, ctx) });
    }
    if (range !== 'week' && range !== 'month') throw bad('range 只能是 day / week / month');
    const sum = await periodSummary(ctx, range, date);
    const sess = await sessionsBetween(ctx, sum.from, sum.to);
    return json(c, { ...sum, breakdown: breakdown(sess, sum.from, sum.to, ctx) });
  });

  // 热力图：最近 N 天每天的记录工时
  app.get('/stats/heatmap', async (c) => {
    const ctx = c.get('ctx');
    const to = dateParam(c.req.query('to'), ctx);
    const n = Math.min(400, Math.max(7, int(c.req.query('days')) || 182));
    const from = addDays(to, -(n - 1));
    const agg = await aggregateDays(ctx, from, to);
    return json(c, { from, to, days: [...agg.values()].map((d) => ({ date: d.date, minutes: d.minutes, score: d.score.score, kind: d.kind, checkin: d.checkin })) });
  });
}

/** 时间花在哪：按项目 / 论文 / Idea / 任务汇总（同一段时间只算一次，归属按计时记录上的主关联） */
function breakdown(sess: any[], from: string, to: string, ctx: Ctx) {
  const lo = localMidnightMs(from, ctx.tz);
  const hi = localMidnightMs(addDays(to, 1), ctx.tz);
  const add = (m: Map<string, any>, key: string, label: string, min: number, extra: Record<string, any> = {}) => {
    const cur = m.get(key) || { key, label, minutes: 0, ...extra };
    cur.minutes += min;
    m.set(key, cur);
  };
  const byProject = new Map<string, any>();
  const byPaper = new Map<string, any>();
  const byIdea = new Map<string, any>();
  const byTask = new Map<string, any>();
  let total = 0;
  for (const x of sess) {
    const a = Math.max(Date.parse(x.start_at), lo);
    const b = Math.min(x.end_at ? Date.parse(x.end_at) : Date.now(), hi);
    if (b <= a) continue;
    const min = (b - a) / 60000;
    total += min;
    add(byProject, String(x.project_id || 0), x.project_name || '未归属项目', min, { id: x.project_id });
    if (x.paper_id) add(byPaper, String(x.paper_id), x.paper_title || `论文 #${x.paper_id}`, min, { id: x.paper_id });
    if (x.idea_id) add(byIdea, String(x.idea_id), x.idea_title || `Idea #${x.idea_id}`, min, { id: x.idea_id });
    const tname = x.task_title || x.label || '未命名计时';
    add(byTask, tname, tname, min);
  }
  const top = (m: Map<string, any>, n = 10) => [...m.values()].map((v) => ({ ...v, minutes: Math.round(v.minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, n);
  return { total: Math.round(total), projects: top(byProject, 20), papers: top(byPaper), ideas: top(byIdea), tasks: top(byTask) };
}
