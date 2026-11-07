import type { App } from '../app';
import { all,bad,conflict,first,notFound,run,type Ctx } from '../db';
import { json } from '../http';
import { body } from './planning';
import { nowIso } from '../lib/time';
import { CHECKED_AT,CONFERENCES } from '../data/conferences';
export async function conferenceList(ctx:Ctx) {
 const rows=await all(ctx.db,'SELECT ct.*,p.name AS project_name FROM conference_targets ct LEFT JOIN projects p ON p.id=ct.project_id');
 return CONFERENCES.map(c=>{const row=rows.find(r=>r.conference_key===c.key);return {...c,checked_at:'checked_at' in c?c.checked_at:CHECKED_AT,followed:!!row?.followed,pinned:!!row?.pinned,planned:!!row?.planned,project_id:row?.project_id??null,project_name:row?.project_name??null,completed:row?JSON.parse(row.completed):{},version:row?.version??0};});
}
export function registerConferences(app:App) {
 app.get('/conferences',async c=>json(c,{conferences:await conferenceList(c.get('ctx'))}));
 app.patch('/conferences/:key',async c=>{
  const ctx=c.get('ctx'),key=c.req.param('key'),catalog=CONFERENCES.find(x=>x.key===key);
  if(!catalog)throw notFound('会议');
  const b=await body(c),current=await first(ctx.db,'SELECT * FROM conference_targets WHERE conference_key=?',key);
  if(!Number.isInteger(b.base_version)||b.base_version<0)throw bad('缺少有效版本号');
  if((current?.version??0)!==b.base_version)throw conflict('投稿目标已在其他页面更新，请刷新后重试');
  if(ctx.actor!=='web'&&current&&b.confirm!==true)throw conflict('修改已有投稿目标需要确认',{needs_confirm:true});
  if(!['followed','pinned','planned','project_id','milestone_id','milestone_ids'].some(k=>k in b))throw bad('没有可更新的投稿目标字段');
  for(const k of ['followed','pinned','planned'])if(k in b && typeof b[k]!=='boolean')throw bad('关注、置顶和投稿计划只能是 true / false');
  const project='project_id'in b?b.project_id:current?.project_id??null;
  if(project!==null&&(!Number.isInteger(project)||project<1||!await first(ctx.db,'SELECT id FROM projects WHERE id=?',project)))throw bad('关联项目不存在');
  const completed=current?JSON.parse(current.completed):{};
  if('milestone_id'in b){
   const milestone=catalog.milestones.find(m=>m.id===b.milestone_id);
   if(!milestone?.action||typeof b.done!=='boolean')throw bad('节点或完成状态不正确');
   if(b.done)completed[b.milestone_id]=completed[b.milestone_id]||nowIso();else delete completed[b.milestone_id];
  }
  // 「完成投稿」：一次勾选 / 撤销同一轮的注册与正文提交，只记一次版本
  if('milestone_ids'in b){
   const ids=b.milestone_ids;
   if(!Array.isArray(ids)||!ids.length||ids.length>10||typeof b.done!=='boolean'||!ids.every(id=>catalog.milestones.some(m=>m.id===id&&m.action)))throw bad('节点或完成状态不正确');
   const ts=nowIso();
   for(const id of ids)if(b.done)completed[id]=completed[id]||ts;else delete completed[id];
  }
  const ts=nowIso();
  const result=await run(ctx.db,`INSERT INTO conference_targets(conference_key,followed,pinned,planned,project_id,completed,version,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)
   ON CONFLICT(conference_key) DO UPDATE SET followed=excluded.followed,pinned=excluded.pinned,planned=excluded.planned,project_id=excluded.project_id,completed=excluded.completed,version=conference_targets.version+1,updated_at=excluded.updated_at WHERE conference_targets.version=?`,
   key,b.followed??!!current?.followed,b.pinned??!!current?.pinned,b.planned??!!current?.planned,project,JSON.stringify(completed),ts,ts,b.base_version);
  if(!result.meta.changes)throw conflict('投稿目标已在其他页面更新，请刷新后重试');
  return json(c,(await conferenceList(ctx)).find(x=>x.key===key));
 });
}
