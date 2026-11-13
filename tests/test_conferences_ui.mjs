// Fresh localhost database only; all test data stays local.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.argv[2]||'http://127.0.0.1:18976';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Local only');
const out=process.env.CONFERENCE_TEST_OUTPUT||'/tmp/conference-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const report=[];
try{
 const c=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'});
 const api=async(method,path,data)=>{const r=await c.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'conference-test','X-Actor':'web'}});assert(r.ok(),await r.text());return r.json();};
 for(const old of (await api('GET','/projects')).projects)if(old.pinned)await api('PATCH','/projects/'+old.id,{pinned:false});
 const stamp=Date.now(),today=(await api('GET','/bootstrap')).today;
 const project=await api('POST','/projects',{name:'检索增强测试 '+stamp,question:'检索失败时模型应该怎么办？',next_step:'整理结果与实验设计'});
 const secondary=await api('POST','/projects',{name:'探索自进化 '+stamp});
 const note=await api('POST','/notes',{project_id:project.id,title:'与 GPT 讨论：实验设计',content:'# 实验设计\n\n已整理讨论结论。'});
 const idea=await api('POST','/ideas',{project_id:project.id,title:'检索与生成的错误归因'});
 for(const conf of (await api('GET','/conferences')).conferences)await api('PATCH','/conferences/'+conf.key,{base_version:conf.version,followed:true,planned:conf.key==='cvpr-2027',pinned:conf.key==='cvpr-2027',project_id:conf.key==='cvpr-2027'?project.id:null,...(conf.key==='cvpr-2027'?{milestone_id:'registration',done:false}:{})});
 const goal=await api('POST','/goals',{title:'研究周目标 '+stamp,week_id:'2026-12-07',project_id:project.id});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const text=async(loc,t)=>loc.getByText(t,{exact:false}).first().waitFor();
 await p.goto(origin+'/submissions');const cvpr=p.getByTestId('conference-cvpr-2027');await cvpr.waitFor();
 assert.equal(await p.locator('.conference-card').count(),22);
 assert.equal(await p.getByTestId('submission-countdown').count(),0);
 await text(p.getByTestId('milestone-cvpr-2027-registration'),'2026-11-11 19:59');
 await text(p.getByTestId('milestone-cvpr-2027-submission'),'2026-11-17 19:59');
 await p.getByRole('button',{name:'展开 ACL 2027',exact:true}).click();await text(p.getByTestId('conference-acl-2027'),'官方日期待公布');
 assert.equal(await p.getByTestId('conference-acl-2027').locator('.milestone-count').count(),0);
 await p.screenshot({path:out+'/desktop-submissions.png'});
 // 勾选 / 取消 CVPR 下一个还没截止的节点（写死某个节点会随日期过期）
 const cvprNow=(await api('GET','/conferences')).conferences.find(x=>x.key==='cvpr-2027');
 const next=cvprNow.milestones.find(m=>m.action&&m.at&&!m.requires&&Date.parse(m.at)>Date.now());assert(next,'CVPR 2027 已没有未截止的节点，请换一个会议');
 const row=p.getByTestId('milestone-cvpr-2027-'+next.id);
 await row.getByRole('checkbox').click();
 await text(row,'已完成');
 assert.equal(await p.getByTestId('conference-summary-cvpr-2027').getByText(next.label,{exact:true}).count(),0);
 await p.reload();await text(row,'已完成');
 await row.getByRole('checkbox').click();await text(p.getByTestId('conference-summary-cvpr-2027'),next.label);
 await p.locator('.submission-toolbar .n-select').click();await p.locator('.n-base-select-option').filter({hasText:/^安全$/}).click();
 assert.equal(await p.locator('.conference-card').count(),4);
 report.push('22 conference cards, pending dates, area filters and persisted completion; Singapore dates independent of browser timezone');

 for(const path of ['/?date='+today,'/week?date='+today,'/calendar?date=2026-11-11']){
  await p.goto(origin+path);await text(p.getByTestId('submission-countdown'),'CVPR 2027');
  if(path.startsWith('/calendar')){await text(p.getByTestId('conference-day-2026-11-11'),'19:59');await text(p.getByTestId('conference-day-2026-11-11'),'CVPR 2027');}
 }
 await p.goto(origin+'/week?date=2026-11-17');await text(p.getByTestId('board-day-2026-11-17').getByTestId('conference-day-2026-11-17'),'正文提交截止');
 report.push('countdown on Today/Week/Calendar, deadline markers on actual local date in weekly day plans');

 await p.goto(origin+'/projects');const card=p.getByTestId('project-card-'+project.id);await card.waitFor();await card.getByRole('button',{name:'展开 '+project.name,exact:true}).click();
 await text(card,'与 GPT 讨论：实验设计');await text(card,'检索与生成的错误归因');await text(card.getByTestId('project-submission'),'CVPR 2027');
 await card.getByRole('button',{name:'置顶 '+project.name,exact:true}).click();await text(card,'已置顶');
 await p.reload();await card.waitFor();assert.equal(await p.locator('.project-card').first().getAttribute('data-testid'),'project-card-'+project.id);
 await p.screenshot({path:out+'/desktop-projects.png'});
 await card.getByRole('link',{name:/与 GPT 讨论/}).click();await p.waitForURL('**/notes/'+note.id+'?*');await text(p.getByTestId('note-reader'),'已整理讨论结论');
 await p.goto(origin+'/projects');await card.getByRole('link',{name:/检索与生成的错误归因/}).click();await p.waitForURL('**/ideas/'+idea.id);
 await p.goto(origin+'/projects');await card.getByRole('link',{name:'＋ 新建',exact:true}).click();await p.waitForURL('**/notes/new?project_id='+project.id);await p.getByTestId('note-save').waitFor();
 await p.goto(origin+'/projects');await card.getByRole('button',{name:'取消置顶 '+project.name,exact:true}).click();await card.getByRole('button',{name:'置顶 '+project.name,exact:true}).waitFor();
 report.push('project pin persists and orders first; notes, new note, ideas and project submission are directly accessible');

 await p.goto(origin+'/?date=2026-12-07');await p.getByTestId('new-day-task-title').locator('input').fill('日任务自动进入周任务池 '+stamp);
 await p.getByText('关联周计划 / 工作量',{exact:true}).click();await p.locator('.task-details .n-select').first().click();await p.locator('.n-base-select-option').filter({hasText:goal.title}).click();
 await p.getByTestId('add-day-task').click();await text(p.locator('.plan-card'),'日任务自动进入周任务池 '+stamp);
 const weekly=await api('GET','/week/2026-12-07'),child=weekly.goal_tasks.find(t=>t.title==='日任务自动进入周任务池 '+stamp);assert(child);
 await p.goto(origin+'/week?date=2026-12-07');await p.getByTestId('goal-task-'+child.id).waitFor();assert.equal(weekly.tasks.filter(t=>t.goal_task_id===child.id).length,1);
 report.push('creating daily task with weekly goal immediately creates exactly one visible reusable weekly child');

 await p.setViewportSize({width:390,height:844});
 for(const [name,path,wait]of [['projects','/projects','.project-card'],['submissions','/submissions','.conference-card'],['week','/week?date=2026-11-17','[data-testid^=board-day-]']]){
  await p.goto(origin+path);await p.locator(wait).first().waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390,name+' mobile overflow');await p.screenshot({path:out+'/mobile-'+name+'.png'});
 }
 assert.deepEqual(errors,[]);report.push('390px layouts fit with no JavaScript errors');await c.close();
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.length,checks:report}));
