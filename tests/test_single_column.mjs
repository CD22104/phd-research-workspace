// Functional UI checks against a fresh local D1; never writes to production.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.argv[2]||'http://127.0.0.1:18977';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Local only');
const out=process.env.SINGLE_TEST_OUTPUT||'/tmp/single-column-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const report=[];
try{
 const c=await browser.newContext({viewport:{width:1440,height:1000}});
 const api=async(method,path,data)=>{const r=await c.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'single-column-test','X-Actor':'web'}});assert(r.ok(),await r.text());return r.json();};
 const getConf=async key=>(await api('GET','/conferences')).conferences.find(x=>x.key===key);
 for(const conf of (await api('GET','/conferences')).conferences)await api('PATCH','/conferences/'+conf.key,{base_version:conf.version,pinned:conf.key==='cvpr-2027',planned:conf.key==='cvpr-2027',milestone_id:conf.key==='cvpr-2027'?'registration':undefined,done:false});
 for(const pr of (await api('GET','/projects')).projects)if(pr.pinned)await api('PATCH','/projects/'+pr.id,{pinned:false});
 const stamp=Date.now(),project=await api('POST','/projects',{name:'重点安全研究 '+stamp,next_step:'整理实验结论并准备投稿'});
 const other=await api('POST','/projects',{name:'最近更新项目 '+stamp});
 const note=await api('POST','/notes',{title:'项目讨论与长文笔记',content:'# 独立阅读\n\n完整笔记内容',project_id:project.id});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const text=async(loc,t)=>loc.getByText(t,{exact:false}).first().waitFor();
 const card=key=>p.getByTestId('conference-'+key),details=key=>p.getByTestId('conference-details-'+key);
 await p.goto(origin+'/submissions');await details('cvpr-2027').waitFor();
 assert.equal(await p.locator('.conference-details').count(),1);
 const ids=await p.locator('.conference-card').evaluateAll(els=>els.map(e=>e.id));
 // 排序规则在 test_deadlines.mjs 用固定时间验证；这里确认页面按同一规则排列（写死的会议名单会随日期过期）
 const {sortConferences}=await import('../web/src/lib/deadlines.js');
 const expectedOrder=sortConferences((await api('GET','/conferences')).conferences,Date.now()).map(x=>x.key);
 assert.equal(ids[0],'cvpr-2027');assert.deepEqual(ids,expectedOrder);
 const boxes=await p.locator('.conference-card').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,width:r.width,height:r.height}}));
 assert(boxes.every(b=>b.x===boxes[0].x&&b.width===boxes[0].width));assert(boxes.slice(1).every(b=>b.height<135));
 assert.equal(await p.getByTestId('submission-countdown').count(),0);
 await p.getByRole('button',{name:'展开 NAACL 2027',exact:true}).focus();await p.keyboard.press('Enter');await details('naacl-2027').waitFor();
 await p.getByRole('button',{name:'收起 NAACL 2027',exact:true}).click();await details('naacl-2027').waitFor({state:'hidden'});
 await card('naacl-2027').getByRole('button',{name:'置顶 NAACL 2027',exact:true}).click();await details('naacl-2027').waitFor();
 assert.equal((await getConf('naacl-2027')).planned,false,'Pinning cannot enroll a conference');
 await p.reload();await details('naacl-2027').waitFor();assert.equal(await card('naacl-2027').getByRole('button',{name:'收起 NAACL 2027',exact:true}).count(),0);
 await card('naacl-2027').getByRole('button',{name:'取消置顶 NAACL 2027',exact:true}).click();await details('naacl-2027').waitFor({state:'hidden'});
 report.push('single column; pinned always open after reload; other rows collapsed; future/past/undated order; keyboard toggle and unpin');

 const plan=()=>card('naacl-2027').getByRole('button',{name:'计划投稿 NAACL 2027',exact:true});
 await plan().click();const dialog=p.getByTestId('submission-plan-dialog');await dialog.waitFor();
 assert.equal((await getConf('naacl-2027')).planned,false);await dialog.getByRole('button',{name:'返回',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await plan().click();await dialog.locator('.n-select').click();await p.locator('.n-base-select-option').filter({hasText:project.name}).click();await dialog.getByRole('button',{name:'确认投稿计划',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const enrolled=await getConf('naacl-2027');assert(enrolled.planned);assert.equal(enrolled.project_id,project.id);
 await p.goto(origin+'/');await text(p.getByTestId('submission-countdown'),'NAACL 2027');assert(!(await p.getByTestId('submission-countdown').innerText()).includes('IEEE S&P'));
 await p.goto(origin+'/week?date=2026-10-13');await text(p.getByTestId('conference-day-2026-10-13'),'NAACL 2027');
 await p.goto(origin+'/calendar?date=2026-10-13');await text(p.getByTestId('conference-day-2026-10-13'),'NAACL 2027');
 await p.goto(origin+'/projects');const projectCard=p.getByTestId('project-card-'+project.id);await projectCard.getByRole('button',{name:'展开 '+project.name,exact:true}).click();await text(projectCard.getByTestId('project-submission'),'NAACL 2027');
 await p.goto(origin+'/submissions');await p.getByRole('checkbox',{name:'只看计划投稿',exact:true}).click();assert.equal(await p.locator('.conference-card').count(),2);
 await card('naacl-2027').getByRole('button',{name:'管理投稿计划 NAACL 2027',exact:true}).click();await dialog.getByRole('button',{name:'取消投稿计划',exact:true}).click();await dialog.waitFor({state:'hidden'});await card('naacl-2027').waitFor({state:'hidden'});
 const removed=await getConf('naacl-2027');assert.equal(removed.planned,false);assert.equal(removed.project_id,project.id);
 await p.goto(origin+'/');await p.getByTestId('submission-countdown').waitFor();assert(!(await p.getByTestId('submission-countdown').innerText()).includes('NAACL 2027'));
 await p.goto(origin+'/calendar?date=2026-10-13');await p.locator('.calendar-grid').waitFor();assert.equal(await p.getByTestId('conference-day-2026-10-13').count(),0);
 report.push('explicit confirmation adds project-linked plan across Today/Week/Calendar; cancel dialog does not write; cancelling plan removes countdowns');

 await p.goto(origin+'/submissions#sp-2027');await details('sp-2027').waitFor();await text(details('sp-2027'),'第二轮');
 await p.goto(origin+'/projects');await projectCard.waitFor();assert.equal(await p.locator('.project-details').count(),0);
 const projectIds=await p.locator('.project-card').evaluateAll(els=>els.map(e=>e.dataset.testid));assert(projectIds.indexOf('project-card-'+project.id)<projectIds.indexOf('project-card-'+other.id),'latest note activity should sort first');
 await projectCard.getByRole('button',{name:'置顶 '+project.name,exact:true}).click();await p.getByTestId('project-details-'+project.id).waitFor();
 await p.reload();await p.getByTestId('project-details-'+project.id).waitFor();assert.equal(await p.locator('.project-card').first().getAttribute('data-testid'),'project-card-'+project.id);
 await projectCard.getByRole('link',{name:/项目讨论与长文笔记/}).click();await p.getByTestId('note-reader').waitFor();assert(p.url().includes('/notes/'+note.id));
 await p.goto(origin+'/projects');await projectCard.getByRole('button',{name:'取消置顶 '+project.name,exact:true}).click();await p.getByTestId('project-details-'+project.id).waitFor({state:'hidden'});
 await projectCard.getByRole('button',{name:'展开 '+project.name,exact:true}).click();await text(p.getByTestId('project-details-'+project.id),'项目讨论与长文笔记');
 report.push('deep links expand target; project activity order, persistent pin, single-column resources and direct note open preserved');

 for(const width of [1440,1024,390]){
  await p.setViewportSize({width,height:1000});
  for(const name of ['submissions','projects']){
   await p.goto(origin+'/'+name);await p.locator(name==='projects'?'.project-card':'.conference-card').first().waitFor();
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width,name+' overflow at '+width);
   await p.screenshot({path:out+'/'+width+'-'+name+'.png',fullPage:width===1440&&name==='submissions'});
  }
 }
 await p.goto(origin+'/submissions');await plan().click();await dialog.waitFor();await p.waitForTimeout(220);const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=1000);await p.screenshot({path:out+'/mobile-plan.png'});
 assert.deepEqual(errors,[]);report.push('1440/1024/390px fit without horizontal overflow; mobile confirmation dialog fits and no JavaScript errors');
 await c.close();
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.length,checks:report}));
