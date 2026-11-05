import { all, bad, first, run, stmt, type Env, type Ctx } from '../db';
import { saveFeedRun } from '../lib/feed-runs';
import { hash, object, textField, origin } from './common';

export async function binding(env: Env, input: any) {
  object(input);
  const bindings = await all(env.DB, 'SELECT b.*,t.status FROM feed_task_bindings b JOIN feed_tasks t ON t.id=b.task_id');
  const byKey = input.task_key == null ? null : bindings.find(b=>b.task_key === input.task_key);
  const byName = input.task_name == null ? null : bindings.find(b=>JSON.parse(b.aliases).includes(input.task_name));
  if ((input.task_key != null && !byKey) || (input.task_name != null && !byName) || (!byKey && !byName) || (byKey && byName && byKey.task_key !== byName.task_key)) throw bad('unknown_or_conflicting_task');
  return byKey || byName;
}
function validDate(value: any) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad('invalid_report_date');
  const d = new Date(value+'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value) throw bad('invalid_report_date');
  return value;
}
function allowedKeys(input: any, keys: string[]) { if (Object.keys(input).some(k=>!keys.includes(k))) throw bad('unexpected_parameter'); }
const receiptSQL = `SELECT v.*, f.title, f.url AS source_url, r.status AS run_status
 FROM feed_report_versions v JOIN feed_items f ON f.id=v.report_id JOIN feed_runs r ON r.id=v.run_id`;
function receipt(env: Env, row: any, duplicate?: boolean) {
  return { report_id:row.report_id, run_id:row.run_id, version_id:row.id, version:row.version,
    task_key:row.task_key, report_date:row.report_date, run_key:row.logical_run_key === '@daily' ? null : row.logical_run_key.slice(4),
    title:row.title, content_status:row.content_status, content_hash:row.content_hash, payload_hash:row.payload_hash,
    source_url:row.source_url, created_at:row.created_at, ...(duplicate === undefined ? {} : {created:!duplicate,duplicate}),
    report_url:origin(env)+'/feeds?item='+row.report_id };
}
async function persistReport(env: Env, input: any) {
  const b = await binding(env,input);
  allowedKeys(input,['task_key','task_name','report_date','title','markdown','content_status','run_key','source_url']);
  if (b.status !== 'active') throw bad('task_not_active');
  const date = validDate(input.report_date), title = textField(input.title,'title',300).trim();
  const markdown = textField(input.markdown,'markdown',400_000);
  if (!['complete','partial','no_updates'].includes(input.content_status)) throw bad('invalid_content_status');
  const logical = input.run_key == null ? '@daily' : 'key:'+textField(input.run_key,'run_key',200);
  let url: string | null = null;
  if (input.source_url != null) {
    url = textField(input.source_url,'source_url',2048);
    try { const u = new URL(url); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error(); } catch { throw bad('invalid_source_url'); }
  }
  const contentHash = await hash(markdown);
  const payloadHash = await hash(JSON.stringify([title,markdown,input.content_status,url]));
  const runKey = 'feedmcp:'+await hash(JSON.stringify([b.task_key,date,logical,payloadHash]));
  const ctx: Ctx = {db:env.DB, env,actor:'mcp',who:'feed-oauth',tz:env.TIMEZONE || 'Asia/Singapore'};
  const result = await saveFeedRun(ctx, {task_id:b.task_id,run_key:runKey,status:input.content_status === 'partial' ? 'partial':'success',
    message:'ChatGPT 报告归档 · '+input.content_status,cost_usd:0,items:[{title,date,content:markdown,url,saved_kind:'raw'}]},
    (key,ts)=>[stmt(env.DB,`INSERT INTO feed_report_versions(task_key,report_date,logical_run_key,content_hash,payload_hash,version,run_id,report_id,content_status,created_at)
     SELECT ?,?,?,?,?,COALESCE(MAX(version),0)+1,(SELECT id FROM feed_runs WHERE run_key=?),
     (SELECT id FROM feed_items WHERE run_id=(SELECT id FROM feed_runs WHERE run_key=?)),?,?
     FROM feed_report_versions WHERE task_key=? AND report_date=? AND logical_run_key=?`,
     b.task_key,date,logical,contentHash,payloadHash,key,key,input.content_status,ts,b.task_key,date,logical)]);
  const row = await first(env.DB,receiptSQL+' WHERE v.run_id=?',result.run.id);
  if (!row) throw Error('missing_receipt');
  return receipt(env,row,result.replayed);
}
// Only authenticated calls reach here. Store a fixed, non-sensitive failure message;
// never echo submitted Markdown, URLs, exceptions or OAuth credentials into logs.
export async function saveReport(env: Env, input: any) {
  let b: any, date: string;
  try { b = await binding(env,input); date = validDate(input.report_date); }
  catch { return persistReport(env,input); }
  try {
    const result = await persistReport(env,input);
    // A replay is still a successful delivery acknowledgement, without another report.
    // Only append an acknowledgement when the last attempt for this day failed.
    if(result.duplicate) {
      const ts=new Date().toISOString();
      await run(env.DB,`INSERT OR IGNORE INTO feed_runs(task_id,run_key,status,finished_at,item_count,message,created_at,report_date)
        SELECT ?, 'feed-recovered:' || id || ':' || ?, ?, ?, 0, '重试成功，已确认原报告保存，无重复正文', ?, ? FROM feed_runs
        WHERE id=(SELECT id FROM feed_runs WHERE task_id=? AND report_date=? ORDER BY id DESC LIMIT 1) AND status='failed'`,
        b.task_id,result.report_id,result.content_status==='partial'?'partial':'success',ts,ts,date,b.task_id,date);
    }
    return result;
  } catch(error) {
    if(b.status==='active') {
      try {
        const ts=new Date().toISOString();
        await run(env.DB,`INSERT INTO feed_runs(task_id,run_key,status,finished_at,item_count,message,created_at,report_date) VALUES(?,?,'failed',?,0,?,?,?)`,
          b.task_id,'feed-failed:'+crypto.randomUUID(),ts,'自动上传未成功。请查看上传端回执，检查参数或稍后重试。',ts,date);
      } catch { /* If storage itself is unavailable, a failure record cannot be guaranteed. */ }
    }
    throw error;
  }
}
export async function getReport(env: Env, input: any) {
  const b = await binding(env,input);
  allowedKeys(input,['task_key','task_name','report_date','run_key','report_id']);
  let sql = receiptSQL+' WHERE v.task_key=?', args: any[] = [b.task_key];
  if (input.report_id != null) {
    if (!Number.isSafeInteger(input.report_id) || input.report_id < 1) throw bad('invalid_report_id');
    sql += ' AND v.report_id=?';args.push(input.report_id);
  } else {
    sql += ' AND v.report_date=? AND v.logical_run_key=?';args.push(validDate(input.report_date),input.run_key == null ? '@daily':'key:'+textField(input.run_key,'run_key',200));
  }
  const rows = await all(env.DB,sql+' ORDER BY v.version DESC LIMIT 50',...args);
  // Receipts only: this capability cannot bulk-extract existing personal feed contents.
  return {found:rows.length > 0,reports:rows.map(row=>receipt(env,row))};
}
