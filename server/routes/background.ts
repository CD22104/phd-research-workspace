import type { App } from '../app';
import { all, bad, first, idParam, int, notFound, run, type Ctx } from '../db';
import { json } from '../http';
import { addDays, isDate, localMidnightMs, nowIso, todayLocal } from '../lib/time';
import { sessionSegments } from '../lib/session-segments';
import { body } from './planning';
export const activeBackground = (ctx:Ctx) => all(ctx.db,'SELECT b.*,t.title AS task_title FROM background_sessions b LEFT JOIN tasks t ON t.id=b.task_id WHERE b.end_at IS NULL ORDER BY b.id');
export function registerBackground(app:App) {
  app.get('/background-sessions', async c=>{
    const ctx=c.get('ctx'),date=c.req.query('date') || todayLocal(ctx.tz);
    const firstDate=c.req.query('from') || date,lastDate=c.req.query('to') || date;
    if (![date,firstDate,lastDate].every(isDate) || firstDate>lastDate || Date.parse(lastDate)-Date.parse(firstDate)>366*86400000) throw bad('请选择一年以内的有效日期范围');
    const from=localMidnightMs(firstDate,ctx.tz),to=localMidnightMs(addDays(lastDate,1),ctx.tz),now=Date.now();
    const rows=await all(ctx.db,`SELECT b.*,t.title AS task_title FROM background_sessions b LEFT JOIN tasks t ON t.id=b.task_id
      WHERE b.start_at < ? AND COALESCE(b.end_at,?) > ? ORDER BY b.end_at IS NULL DESC,b.id DESC`,new Date(to).toISOString(),new Date(now).toISOString(),new Date(from).toISOString());
    const sessions=rows.map(r=>({...r,day_elapsed_ms:Math.max(0,Math.min(Date.parse(r.end_at || new Date(now).toISOString()),to)-Math.max(Date.parse(r.start_at),from))}));
    return json(c,{date,from:firstDate,to:lastDate,segments:sessionSegments(rows,firstDate,lastDate,ctx.tz,now),sessions,total_minutes:Math.round(sessions.reduce((n,r)=>n+r.day_elapsed_ms,0)/60000),now:new Date(now).toISOString()});
  });
  app.post('/background-timer/start',async c=>{
    const ctx=c.get('ctx'),b=await body(c),taskId=int(b.task_id);
    const task=taskId?await first(ctx.db,'SELECT title FROM tasks WHERE id=?',taskId):null;
    if (taskId&&!task) throw notFound('任务');
    const label=String(b.label || task?.title || '').trim();
    if (!label || label.length>200) throw bad('请填写 1–200 字的后台任务名称');
    const ts=nowIso();
    const r=await run(ctx.db,`INSERT INTO background_sessions(task_id,label,start_at,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(task_id) WHERE end_at IS NULL AND task_id IS NOT NULL DO NOTHING`,taskId,label,ts,ts,ts);
    const started=taskId?await first(ctx.db,'SELECT * FROM background_sessions WHERE task_id=? AND end_at IS NULL',taskId):await first(ctx.db,'SELECT * FROM background_sessions WHERE id=?',r.meta.last_row_id);
    return json(c,{started,background:await activeBackground(ctx)},201);
  });
  app.post('/background-timer/stop',async c=>{
    const ctx=c.get('ctx'),b=await body(c),id=idParam(String(b.session_id || ''));
    const row=await first(ctx.db,'SELECT * FROM background_sessions WHERE id=?',id);if(!row)throw notFound('后台记录');
    const ts=nowIso();await run(ctx.db,'UPDATE background_sessions SET end_at=?,updated_at=? WHERE id=? AND end_at IS NULL',ts,ts,id);
    return json(c,{stopped:await first(ctx.db,'SELECT * FROM background_sessions WHERE id=?',id),background:await activeBackground(ctx),already:!!row.end_at});
  });
}
