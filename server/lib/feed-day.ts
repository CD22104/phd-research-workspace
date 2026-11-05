import { all, bad, type Ctx } from '../db';
import { addDays, isDate, localMidnightMs, todayLocal, weekday } from './time';
export function feedDate(value: unknown): string {
  if (!isDate(value) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw bad('日报日期不正确');
  return value;
}
export function feedTaskTiming(input: Record<string,any>) {
  const patch: Record<string,any>={};
  if ('expected_enabled' in input) {
    if (![true,false,0,1].includes(input.expected_enabled)) throw bad('提醒开关不正确');
    patch.expected_enabled=input.expected_enabled ? 1 : 0;
  }
  if ('expected_time' in input) {
    const value=input.expected_time;
    if (value!=null && value!=='' && (typeof value!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw bad('预计上传时间请填写 HH:MM');
    patch.expected_time=value || null;
  }
  if ('expected_days' in input) {
    const value=input.expected_days;
    if (!Array.isArray(value) || !value.length || value.some(x=>!Number.isInteger(x)||x<1||x>7)) throw bad('请选择预计上传的星期');
    patch.expected_days=[...new Set(value)].sort();
  }
  return patch;
}
export function deliveryState(task: any, reports: any[], lastRun: any, date: string, tz: string, now: number) {
  const hasReport=reports.length>0;
  const latestReport=reports.reduce((latest,r)=>r.created_at>latest?r.created_at:latest,'');
  if (lastRun?.status==='failed' && (!hasReport || lastRun.created_at>=latestReport)) return {state:'failed',label:'上传失败',detail:hasReport?'已有报告；最近一次上传未成功，请在信息流查看运行记录并重试。':'已收到失败记录，请检查自动任务并重试，或手动上传完整报告。'};
  if (reports.some(r=>r.content_status==='partial') || lastRun?.status==='partial') return {state:'partial',label:'内容不完整',detail:'已收到部分结果，请检查正文，必要时重试上传。'};
  if (hasReport) return {state:'received',label:'已收到',detail:'阅读或处理完成后，请手动勾选。'};
  if (!task.expected_enabled) return {state:'not_started',label:'提醒未启用',detail:'此任务尚未开始定时提醒，收到的报告仍会保存。开始后可在信息流编辑任务开启提醒。'};
  if (task.status!=='active') return {state:'paused',label:'已暂停',detail:'此任务暂停期间不提示迟到。'};
  if (lastRun?.status==='running' || lastRun?.status==='pending') return {state:'waiting',label:'等待报告',detail:'任务已报告正在运行，尚未收到正文。'};
  const days=JSON.parse(task.expected_days || '[1,2,3,4,5,6,7]');
  if (task.expected_time && days.includes(weekday(date))) {
    const [h,m]=task.expected_time.split(':').map(Number);
    const expected=localMidnightMs(date,tz)+(h*60+m)*60000;
    if(now>=expected) return {state:'late',label:'超过时间未收到',detail:`预计 ${task.expected_time} 上传，本站尚未收到。请检查自动任务；目前无法确认失败原因。`};
    return {state:'waiting',label:'等待上传',detail:`预计 ${task.expected_time} 上传（${tz}）。`};
  }
  if(task.expected_time) return {state:'unscheduled',label:'当天无固定上传',detail:'未安排该星期的定时报告；收到后仍会显示。'};
  return {state:'missing',label:'尚未收到',detail:'未设置固定上传时间，暂不判断是否失败。'};
}
export async function feedDay(ctx: Ctx, date: string, now=Date.now()) {
  feedDate(date);
  const start=new Date(localMidnightMs(date,ctx.tz)).toISOString(),end=new Date(localMidnightMs(addDays(date,1),ctx.tz)).toISOString();
  const [tasks,reports,runs]=await Promise.all([
    all(ctx.db,'SELECT t.*,b.task_key,b.task_name AS display_name FROM feed_tasks t LEFT JOIN feed_task_bindings b ON b.task_id=t.id ORDER BY t.id'),
    all(ctx.db,`SELECT f.id,f.task_id,f.title,f.date,f.reviewed_at,f.read_state,f.archived,f.created_at,v.version,v.content_status,
      LENGTH(f.content) AS content_length FROM feed_items f LEFT JOIN feed_report_versions v ON v.report_id=f.id
      WHERE f.date=? AND NOT EXISTS(SELECT 1 FROM feed_report_versions newer WHERE newer.task_key=v.task_key AND newer.report_date=v.report_date AND newer.logical_run_key=v.logical_run_key AND newer.version>v.version)
      ORDER BY f.id DESC`,date),
    all(ctx.db,`SELECT r.id,r.task_id,r.status,r.message,r.created_at,r.report_date FROM feed_runs r
      WHERE r.report_date=? OR (r.report_date IS NULL AND (EXISTS(SELECT 1 FROM feed_items f WHERE f.run_id=r.id AND f.date=?)
      OR (NOT EXISTS(SELECT 1 FROM feed_items f WHERE f.run_id=r.id) AND r.created_at>=? AND r.created_at<?))) ORDER BY r.id DESC`,date,date,start,end)
  ]);
  const grouped=tasks.filter(t=>t.runner!=='manual' || reports.some(r=>r.task_id===t.id)).map(t=>{
    const items=reports.filter(r=>r.task_id===t.id),lastRun=runs.find(r=>r.task_id===t.id);
    return {...t,reports:items,last_run:lastRun || null,delivery:deliveryState(t,items,lastRun,date,ctx.tz,now)};
  });
  const orphan=reports.filter(r=>!tasks.some(t=>t.id===r.task_id));
  if(orphan.length)grouped.push({id:null,name:'手动上传',display_name:'手动上传',reports:orphan,last_run:null,delivery:{state:'received',label:'已收到',detail:'阅读或处理完成后，请手动勾选。'}} as any);
  return {date,today:todayLocal(ctx.tz),timezone:ctx.tz,tasks:grouped,report_count:reports.length,completed_count:reports.filter(r=>r.reviewed_at).length,checked_at:new Date(now).toISOString()};
}
