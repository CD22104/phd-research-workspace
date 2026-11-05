// Shared persistence for the existing REST API and the restricted remote MCP.
import { all, bad, conflict, first, int, notFound, stmt, type Ctx } from '../db';
import { isDate, nowIso, todayLocal } from './time';

export async function saveFeedRun(ctx: Ctx, b: any, extraWrites?: (runKey: string, ts: string) => D1PreparedStatement[]) {
    let taskId = int(b.task_id);
    if (!taskId && b.task_name) taskId = (await first(ctx.db, 'SELECT id FROM feed_tasks WHERE name = ?', b.task_name))?.id ?? null;
    if (!taskId) throw bad('找不到对应的定时任务');
    const task = await first(ctx.db, 'SELECT * FROM feed_tasks WHERE id = ?', taskId);
    if (!task) throw notFound('定时任务');
    if (b.run_key) {
      const prev = await first(ctx.db, 'SELECT * FROM feed_runs WHERE run_key = ?', b.run_key);
      if (prev && prev.task_id !== taskId) throw conflict('这个运行标识已用于其他任务');
      if (prev) return { run: prev, items: await all(ctx.db, 'SELECT id, title FROM feed_items WHERE run_id = ?', prev.id), replayed: true };
    }
    const status = ['pending', 'running', 'success', 'partial', 'failed', 'unknown'].includes(b.status) ? b.status : 'success';
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length > 20) throw bad('一次最多上传 20 条动态');
    const valid = items.map(it => {
      if (!it || typeof it.title !== 'string' || !it.title.trim() || it.title.length > 300) throw bad('动态标题需要 1–300 字');
      if (typeof it.content !== 'string' || !it.content.trim() || it.content.length > 400_000) throw bad('动态内容需要 1–400000 字');
      if (it.date != null && (!isDate(it.date) || new Date(it.date + 'T00:00:00Z').toISOString().slice(0,10) !== it.date)) throw bad('动态日期不正确');
      return { ...it, date: it.date || todayLocal(ctx.tz) };
    });
    if (b.report_date != null && (!isDate(b.report_date) || new Date(b.report_date+'T00:00:00Z').toISOString().slice(0,10)!==b.report_date)) throw bad('报告日期不正确');
    const runKey = b.run_key || crypto.randomUUID(), ts = nowIso();
    const writes = [stmt(ctx.db, 'INSERT INTO feed_runs(task_id,run_key,status,started_at,finished_at,item_count,message,cost_usd,created_at,report_date) VALUES(?,?,?,?,?,?,?,?,?,?)',
      taskId,runKey,status,b.started_at || null,b.finished_at || ts,valid.length,b.message || null,b.cost_usd ?? null,ts,b.report_date || (valid.length===1 ? valid[0].date : null))];
    for (const it of valid) {
      const sourceKey = 'feed_upload:' + crypto.randomUUID();
      writes.push(stmt(ctx.db, 'INSERT INTO sources(kind,name,channel,url,raw,actor,created_at) VALUES(?,?,?,?,?,?,?)', 'feed', `${task.name} · ${it.title}`,task.runner,sourceKey,it.content,ctx.actor,ts));
      writes.push(stmt(ctx.db, `INSERT INTO feed_items(task_id,run_id,title,date,content,url,saved_kind,read_state,triage,archived,source_id,created_at,updated_at)
        VALUES(?,(SELECT id FROM feed_runs WHERE run_key=?),?,?,?,?,?,'unread','untriaged',0,(SELECT id FROM sources WHERE url=?),?,?)`,
        taskId,runKey,it.title.trim(),it.date,it.content,it.url || null,it.saved_kind === 'raw' ? 'raw' : 'summary',sourceKey,ts,ts));
      writes.push(stmt(ctx.db, `UPDATE sources SET url = 'feed_item:' || (SELECT id FROM feed_items WHERE source_id=sources.id) WHERE url=?`,sourceKey));
    }
    if (extraWrites) writes.push(...extraWrites(runKey, ts));
    try { await ctx.db.batch(writes); }
    catch(error) {
      const prev = await first(ctx.db, 'SELECT * FROM feed_runs WHERE run_key = ?', runKey);
      if (!prev || prev.task_id !== taskId) throw error;
      return { run: prev, items: await all(ctx.db, 'SELECT id,title FROM feed_items WHERE run_id=?',prev.id), replayed:true };
    }
    const saved = await first(ctx.db, 'SELECT * FROM feed_runs WHERE run_key = ?', runKey);
    return { run: saved!, items: await all(ctx.db, 'SELECT id,title FROM feed_items WHERE run_id=?',saved!.id), replayed: false };
}
