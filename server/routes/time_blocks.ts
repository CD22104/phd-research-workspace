import type { App } from '../app';
import { all, bad, conflict, first, idParam, notFound, run, stmt } from '../db';
import { json } from '../http';
import { isDate, nowIso } from '../lib/time';
import { body } from './planning';

const SELECT = `SELECT b.*,t.date,t.title,t.status,gt.status AS goal_task_status
 FROM task_time_blocks b JOIN tasks t ON t.id=b.task_id LEFT JOIN goal_tasks gt ON gt.id=t.goal_task_id`;
const ACTIVE = `SELECT 1 FROM tasks t LEFT JOIN goal_tasks gt ON gt.id=t.goal_task_id
 WHERE t.id=task_time_blocks.task_id AND t.date=? AND t.status='todo' AND COALESCE(gt.status,'todo')!='done'`;
function dateValue(value: unknown): string {
 if (!isDate(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) throw bad('请提供有效日期');
 return value;
}
function minutes(b: any) {
 if (!Number.isInteger(b.start_minute)||!Number.isInteger(b.end_minute)||b.start_minute<0||b.end_minute>1440||b.end_minute<=b.start_minute) throw bad('时段应在当天 00:00 至 24:00 内，结束晚于开始');
}
function version(value: unknown): number {
 if (!Number.isInteger(value)||Number(value)<1) throw bad('缺少有效时段版本');
 return Number(value);
}
export function registerTimeBlocks(app: App) {
 app.get('/day/:date/time-blocks',async c=>{
  const date=dateValue(c.req.param('date'));
  return json(c,{date,blocks:await all(c.get('ctx').db,`${SELECT} WHERE t.date=? AND t.status NOT IN ('dropped','moved') ORDER BY b.start_minute,b.id`,date)});
 });
 app.post('/time-blocks',async c=>{
  const ctx=c.get('ctx'),b=await body(c),date=dateValue(b.date);minutes(b);
  if(!Number.isInteger(b.task_id)||b.task_id<1)throw bad('请选择日任务');
  if(typeof b.client_key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(b.client_key))throw bad('缺少有效重试标识');
  const previous=await first(ctx.db,`${SELECT} WHERE b.client_key=?`,b.client_key);
  if(previous){
   if(previous.task_id!==b.task_id||previous.date!==date||previous.start_minute!==b.start_minute||previous.end_minute!==b.end_minute)throw conflict('重试标识已用于其他时段');
   return json(c,{...previous,replayed:true});
  }
  const ts=nowIso();
  await run(ctx.db,`INSERT OR IGNORE INTO task_time_blocks(task_id,start_minute,end_minute,client_key,created_at,updated_at)
   SELECT t.id,?,?,?,?,? FROM tasks t LEFT JOIN goal_tasks gt ON gt.id=t.goal_task_id
   WHERE t.id=? AND t.date=? AND t.status='todo' AND COALESCE(gt.status,'todo')!='done'`,b.start_minute,b.end_minute,b.client_key,ts,ts,b.task_id,date);
  const saved=await first(ctx.db,`${SELECT} WHERE b.task_id=? AND b.start_minute=? AND b.end_minute=?`,b.task_id,b.start_minute,b.end_minute);
  if(!saved)throw conflict('任务日期或完成状态已改变，请刷新后重新安排');
  return json(c,saved,201);
 });
 app.patch('/time-blocks/:id',async c=>{
  const ctx=c.get('ctx'),id=idParam(c.req.param('id')),b=await body(c),date=dateValue(b.date),base=version(b.base_version);minutes(b);
  const current=await first(ctx.db,`${SELECT} WHERE b.id=?`,id);
  if(!current)throw notFound('计划时段');
  if(ctx.actor!=='web'&&b.confirm!==true)throw conflict('修改计划时段需要确认',{needs_confirm:true,preview:{before:current,start_minute:b.start_minute,end_minute:b.end_minute}});
  const result=await run(ctx.db,`UPDATE OR IGNORE task_time_blocks SET start_minute=?,end_minute=?,version=version+1,updated_at=?
   WHERE id=? AND version=? AND EXISTS(${ACTIVE})`,b.start_minute,b.end_minute,nowIso(),id,base,date);
  if(!result.meta.changes)throw conflict('时段或任务已改变，或同一时段已存在，请刷新后重试');
  return json(c,await first(ctx.db,`${SELECT} WHERE b.id=?`,id));
 });
 app.delete('/time-blocks/:id',async c=>{
  const ctx=c.get('ctx'),id=idParam(c.req.param('id')),date=dateValue(c.req.query('date')),base=version(Number(c.req.query('base_version')));
  if(ctx.actor!=='web'&&c.req.query('confirm')!=='1')throw conflict('取消计划时段需要确认',{needs_confirm:true});
  const current=await first(ctx.db,`${SELECT} WHERE b.id=?`,id);
  if(!current)throw notFound('计划时段');
  const where='id=? AND version=? AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_time_blocks.task_id AND t.date=?)';
  const results=await ctx.db.batch([
   stmt(ctx.db,`INSERT INTO changes(entity,entity_id,op,old,actor,created_at) SELECT 'task_time_block',id,'delete',?,?,? FROM task_time_blocks WHERE ${where}`,JSON.stringify(current),ctx.actor,nowIso(),id,base,date),
   stmt(ctx.db,`DELETE FROM task_time_blocks WHERE ${where}`,id,base,date),
  ]);
  if(!results[1].meta.changes)throw conflict('时段或任务日期已改变，请刷新后重试');
  return json(c,{ok:true});
 });
}
