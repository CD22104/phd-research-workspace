import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.argv[2] || 'http://127.0.0.1:8807';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Only isolated local DB');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
const output='/tmp/honey-daily-ui';mkdirSync(output,{recursive:true});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 const api=async(method,path,data)=>{const r=await ctx.request.fetch(base+'/api'+path,{method,data,headers:{'X-Requested-With':'test','X-Actor':'web'}});assert(r.ok(),path+' '+r.status());return r.json();};
 const today=(await api('GET','/bootstrap')).today;
 const task=await api('POST','/tasks',{date:today,title:'UI plan · Codex experiment '+Date.now(),planned:true});
 const other=await api('POST','/tasks',{date:today,title:'UI focus · write paper '+Date.now(),planned:true});
 const report=await api('POST','/feeds/items',{task_id:1,title:'UI daily · full Markdown '+Date.now(),date:today,content:'# Full daily report\n\n'+('A paragraph with **research details**.\n\n'.repeat(90))+'## END OF REPORT'});
 const text=async(loc,t)=>{await loc.getByText(t,{exact:false}).first().waitFor();};
 await p.goto(base+'/today');const daily=p.getByTestId('daily-feeds');await text(daily,report.title);
 const row=daily.locator(`[data-report-id="${report.id}"]`);await row.locator('.report-title').click();
 const drawer=p.locator('.n-drawer');await text(drawer,'Full daily report');
 assert.equal((await api('GET','/feeds/items/'+report.id)).item.reviewed_at,null);
 await text(drawer,'END OF REPORT');
 const footer=drawer.locator('.n-drawer-footer');assert(await footer.isVisible());
 await footer.getByRole('checkbox').click();
 await p.waitForFunction(async id=>!!(await(await fetch('/api/feeds/items/'+id)).json()).item.reviewed_at,report.id);
 await p.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});await text(row,'已完成');
 // A normal textarea draft survives report refresh and completion changes.
 await p.locator('.secondary-section').filter({hasText:'晚间复盘'}).locator('summary').click();
 const draft=p.getByPlaceholder('今天的结论、卡点，或明天先做什么');await draft.fill('Unsaved review stays here');
 await row.getByRole('checkbox').click();await p.waitForFunction(async id=>!(await(await fetch('/api/feeds/items/'+id)).json()).item.reviewed_at,report.id);
 assert.equal(await draft.inputValue(),'Unsaved review stays here');
 await row.getByRole('checkbox').click();
 await p.goto(base+'/feeds');await text(p.locator('.item').filter({hasText:report.title}),'已完成');
 assert.equal(await p.locator('.item').filter({hasText:report.title}).getByRole('checkbox').isChecked(),true);
 // A failed run stays in history without dashboard upload alerts.
 await api('POST','/feeds/runs',{task_id:1,status:'failed',report_date:today,run_key:'ui-failure-'+Date.now(),message:'UI upload failure',items:[]});
 await p.reload();await p.locator('.task').first().waitFor();assert(!(await p.locator('.task').filter({hasText:'每日新闻'}).innerText()).includes('上传失败'));
 await p.goto(base+'/today');await text(daily,report.title);assert(!(await daily.innerText()).includes('上传失败'));
 // Planned background task can run alongside a focus timer.
 const bg=p.getByTestId('background-timers');await bg.getByText('从日计划选择',{exact:true}).click();
 await bg.getByTestId('background-task-select').click();await p.locator('.n-base-select-option').filter({hasText:task.title}).click();
 await bg.getByTestId('background-start').click();await text(bg.locator('[data-background-id]'),task.title);
 let timers=await api('GET','/timer');const bgrow=timers.background.find(x=>x.task_id===task.id);assert(bgrow);
 await api('POST','/timer/start',{task_id:other.id});await p.reload();await text(p.locator('.timer-label'),other.title);
 await bg.locator(`[data-background-id="${bgrow.id}"]`).getByRole('button',{name:'结束',exact:true}).click();
 await p.waitForFunction(async id=>(await(await fetch('/api/timer')).json()).background.every(x=>x.id!==id),bgrow.id);
 assert.equal((await api('GET','/timer')).running.task_id,other.id);
 await p.getByTestId('stop-day-timer').click();
 // Custom mode still works, English Enter does not start an unfinished label.
 const label=bg.getByTestId('background-label').locator('input');await label.fill('UI custom background');await label.press('Enter');
 assert(!(await api('GET','/timer')).background.some(x=>x.label==='UI custom background'));
 await bg.getByTestId('background-start').click();await text(bg.locator('[data-background-id]'),'UI custom background');
 await bg.locator('[data-background-id]').filter({hasText:'UI custom background'}).getByRole('button',{name:'结束'}).click();
 await p.goto(base+'/sessions');await text(p.locator('[data-session-kind="background"]'),task.title);await text(p.locator('[data-session-kind="focus"]'),other.title);
 await text(p.locator('.session-totals'),'不计入工时');await p.screenshot({path:output+'/records-desktop.png',fullPage:true});
 // Make the existing CVPR countdown visible in this isolated test database.
 const conf=await api('GET','/conferences');const cvpr=conf.conferences.find(x=>x.key==='cvpr-2027' || x.id==='cvpr-2027' || x.name==='CVPR');
 // The countdown is normally hidden with no plans; configure directly only if the API shape is known.
 const targets=conf.conferences.filter(x=>(x.name||'').includes('CVPR'));
 if(targets.length){const x=targets[0];await api('PATCH','/conferences/'+x.key,{planned:true,base_version:x.version||0});}
 for(const width of [1440,390]){
  await p.setViewportSize({width,height:1000});await p.goto(base+'/today');await daily.waitFor();await bg.waitFor();
  const y=await p.locator('.side-column').evaluate(el=>[...el.children].map(x=>({cls:x.className,y:x.getBoundingClientRect().top})));
  const f=y.find(x=>x.cls.includes('timer-card')),b=y.find(x=>x.cls.includes('background-card')),c=y.find(x=>x.cls.includes('submission-card'));
  assert(f.y<b.y);if(c)assert(b.y<c.y,'Countdown follows both timers');
  assert((await p.evaluate(()=>document.documentElement.scrollWidth))<=width,'No page overflow');
  await p.screenshot({path:output+'/today-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS: full report, manual completion, cross-page sync, draft preservation, no upload alerts, planned/custom background, independent focus, history, desktop/mobile order and layout');
}finally{await browser.close();}
