import { all, bad, conflict, first, stmt, type Ctx } from '../db';
import { nowIso } from './time';

export async function focusElapsed(ctx: Ctx, row: any) {
  if (!row?.timer_key) return Math.max(0, Date.parse(row.end_at || nowIso()) - Date.parse(row.start_at));
  const rows = await all(ctx.db, 'SELECT start_at, end_at FROM sessions WHERE timer_key = ?', row.timer_key);
  return rows.reduce((sum, s) => sum + Math.max(0, Date.parse(s.end_at || nowIso()) - Date.parse(s.start_at)), 0);
}
export async function currentFocus(ctx: Ctx) {
  const row = await first(ctx.db, `SELECT s.*, t.title AS task_title, p.title AS paper_title, i.title AS idea_title, pr.name AS project_name
    FROM sessions s LEFT JOIN tasks t ON t.id=s.task_id LEFT JOIN papers p ON p.id=s.paper_id
    LEFT JOIN ideas i ON i.id=s.idea_id LEFT JOIN projects pr ON pr.id=s.project_id
    WHERE s.end_at IS NULL OR s.id=(SELECT session_id FROM timer_pauses WHERE id=1)
    ORDER BY s.end_at IS NULL DESC LIMIT 1`);
  if (!row) return null;
  const prior = row.timer_key ? await all(ctx.db, 'SELECT start_at, end_at FROM sessions WHERE timer_key=? AND end_at IS NOT NULL', row.timer_key) : [];
  return {...row, paused:!!row.end_at, elapsed_before_ms:prior.reduce((n,s)=>n+Math.max(0,Date.parse(s.end_at)-Date.parse(s.start_at)),0)};
}
export async function pauseFocus(ctx: Ctx, id: number) {
  const cur = await currentFocus(ctx);
  if (!cur || cur.id !== id) throw conflict('计时已变化，请刷新后重试');
  if (cur.paused) return { running:cur, already:true };
  const ts = nowIso();
  await ctx.db.batch([
    stmt(ctx.db, "UPDATE sessions SET timer_key=COALESCE(timer_key, 'focus-' || id) WHERE id=? AND end_at IS NULL", id),
    stmt(ctx.db, 'INSERT INTO timer_pauses(id,session_id,created_at) SELECT 1,id,? FROM sessions WHERE id=? AND end_at IS NULL ON CONFLICT(id) DO NOTHING', ts,id),
    stmt(ctx.db, 'UPDATE sessions SET end_at=?,updated_at=? WHERE id=? AND end_at IS NULL AND id=(SELECT session_id FROM timer_pauses WHERE id=1)',ts,ts,id),
  ]);
  return { running:await currentFocus(ctx) };
}
export async function resumeFocus(ctx: Ctx, id: number) {
  const cur = await currentFocus(ctx);
  if (!cur) throw conflict('这次计时已结束');
  if (cur.id !== id) {
    const old = await first(ctx.db,'SELECT timer_key FROM sessions WHERE id=?',id);
    if (!cur.paused && old?.timer_key && old.timer_key === cur.timer_key) return { running:cur, already:true };
    throw conflict('计时已变化，请刷新后重试');
  }
  if (!cur.paused) return { running:cur, already:true };
  if (cur.task_id) {
    const t = await first(ctx.db,'SELECT status FROM tasks WHERE id=?',cur.task_id);
    if (t && t.status !== 'todo') throw bad('任务已完成或取消，不能继续计时');
  }
  const ts=nowIso();
  try {
    await ctx.db.batch([
      stmt(ctx.db, `INSERT INTO sessions(task_id,project_id,paper_id,plan_id,idea_id,label,start_at,source,timer_key,created_at,updated_at)
        SELECT s.task_id,s.project_id,s.paper_id,s.plan_id,s.idea_id,s.label,?,'timer',s.timer_key,?,?
        FROM sessions s JOIN timer_pauses p ON p.session_id=s.id WHERE p.id=1 AND s.id=?`,ts,ts,ts,id),
      stmt(ctx.db,'DELETE FROM timer_pauses WHERE id=1 AND session_id=?',id),
    ]);
  } catch(e:any) { if (/UNIQUE/.test(e.message)) throw conflict('另一台设备已开始计时'); throw e; }
  return { running:await currentFocus(ctx) };
}
