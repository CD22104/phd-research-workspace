// Use a fresh isolated local database. Never seed or mutate a production site.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://127.0.0.1:18975';
if (!['127.0.0.1','localhost'].includes(new URL(origin).hostname)) throw new Error('Use an isolated local database.');
const out = process.env.WEEK_TEST_OUTPUT || '/tmp/week-agenda-browser'; mkdirSync(out,{recursive:true});
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox','--disable-dev-shm-usage'] });
const report = [];
try {
 const c = await browser.newContext({viewport:{width:1440,height:1000}});
 const request = async (method,path,data) => {
  const r=await c.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'week-ui-test','X-Actor':'web'}});
  assert(r.ok(),method+' '+path+': '+r.status()+' '+await r.text());return r.json();
 };
 const stamp=Date.now(), monday='2026-10-05', next='2026-10-12';
 const events=[];
 const event=async (title,kind,start,end,extra={})=>{
  const row=await request('POST','/calendar/events',{title,kind,date:monday,all_day:!start,start_time:start,end_time:end,...extra});events.push(row);return row;
 };
 const meeting=await event('周组会 '+stamp,'meeting','10:00','11:00',{location:'Lab room 1',recurrence:{frequency:'weekly',interval:1,weekdays:[1,3,5],until:'2026-10-16'}});
 await event('机器学习课程','course','10:30','12:00');
 await event('午后休息','break','14:00','14:30');
 await event('运动打卡','checkin','17:00','17:15');
 await event('全天学术活动','other',null,null);
 await event('下周的外部会议','meeting','15:00','16:00',{date:next});
 await request('PUT','/day/2026-10-06',{kind:'rest'});
 const goal=await request('POST','/goals',{title:'探索安全监控 '+stamp,week_id:monday});
 const task=await request('POST','/goal-tasks',{goal_id:goal.id,title:'梳理论文并设计实验'});
 const p=await c.newPage(), errors=[], mutations=[];
 p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))mutations.push(r.url());});
 // 排期板：每天一行（日期格 + 早 / 中 / 晚）；日期格带 aria-busy
 const day=date=>p.getByTestId('board-day-'+date), agenda=date=>day(date);
 const settled=async loc=>{await loc.waitFor();const head=loc.locator('[aria-busy]').first();await p.waitForFunction(el=>el.getAttribute('aria-busy')==='false',await head.elementHandle());};
 const expectText=async (loc,text)=>{await loc.getByText(text,{exact:false}).first().waitFor();};
 await p.goto(origin+'/week?date='+monday);await settled(agenda(monday));
 const a=agenda(monday);assert.equal(await a.locator('.board-event').count(),5);
 await expectText(a,'2 小时 45 分');await expectText(a,'另有 1 项全天安排');await expectText(a,'有时段重叠');
 assert.equal(await a.locator('.board-event').first().locator('.ev-time').innerText(),'全天');
 await expectText(p.getByTestId('board-cell-'+monday+'-morning'),'机器学习课程');await expectText(p.getByTestId('board-cell-'+monday+'-afternoon'),'午后休息');await expectText(p.getByTestId('board-cell-'+monday+'-morning'),'Lab room 1');
 await expectText(agenda('2026-10-06'),'全天休息');
 await expectText(agenda('2026-10-07'),'周组会');await expectText(agenda('2026-10-09'),'周组会');
 for(const label of ['会议 · 重复','课程','休息','打卡','其他'])await expectText(a.locator('.ev-meta'),label);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),1440);
 await p.screenshot({path:out+'/desktop-week.png',fullPage:true});
 report.push('week board shows all five kinds by period, recurrence, locations, rest day, overlap union and separate all-day count');

 // English Enter and an IME confirmation leave text intact and do not issue a mutation.
 const enterDoesNotSubmit=async (input,value)=>{
  await input.fill(value);const before=mutations.length;await input.press('Enter');
  await input.dispatchEvent('compositionstart',{data:'yan'});
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true});
  await input.dispatchEvent('compositionend',{data:'研究'});
  await input.dispatchEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,isComposing:false});
  await p.waitForTimeout(150);assert.equal(mutations.length,before,'Enter must not send a mutation');assert.equal(await input.inputValue(),value);
 };
 const newGoal=p.getByPlaceholder('＋ 新的大计划');await enterDoesNotSubmit(newGoal,'Long English goal');
 await newGoal.fill('Long English goal completed');await p.getByRole('button',{name:'添加计划',exact:true}).click();
 await expectText(p.locator('.goal-name'),'Long English goal completed');
 const child=p.getByTestId('new-goal-task-'+goal.id).locator('input');
 await enterDoesNotSubmit(child,'Read preliminary');await child.fill('Read preliminary results completed');
 await p.locator('.weekly-goal').filter({hasText:goal.title}).getByRole('button',{name:'添加',exact:true}).click();
 await expectText(p.locator('.task-title'),'Read preliminary results completed');
 assert.equal((await request('GET','/week/'+monday)).goal_tasks.filter(t=>t.title==='Read preliminary results completed').length,1);
 report.push('English and IME Enter preserve weekly goal/subtask drafts; explicit buttons create complete titles once');

 // Date popup reads selected day and ignores an older response arriving late.
 const openPopup=async()=>{await p.getByTestId('goal-task-'+task.id).getByRole('button',{name:'安排',exact:true}).click();await p.getByTestId('goal-task-schedule').waitFor();};
 await openPopup();const pop=p.getByTestId('goal-task-schedule'), dateInput=pop.locator('input[type=date]');
 await expectText(pop,'2 小时 45 分');await dateInput.fill(next);await expectText(pop,'下周的外部会议');
 await dateInput.fill('2026-10-06');await expectText(pop,'全天休息');
 let arrived,release;const arrival=new Promise(r=>arrived=r), gate=new Promise(r=>release=r);
 const slowUrl='**/api/calendar?from='+monday+'&to='+monday;
 await p.route(slowUrl,async route=>{const response=await route.fetch();arrived();await gate;await route.fulfill({response});});
 await dateInput.fill(monday);await arrival;await dateInput.fill(next);await expectText(pop,'下周的外部会议');release();
 await p.waitForTimeout(150);assert(!(await pop.innerText()).includes('机器学习课程'));await p.unroute(slowUrl);
 await dateInput.fill('2026-10-06');await expectText(pop,'全天休息');
 await p.locator('.n-modal').getByRole('button',{name:'加入日计划',exact:true}).click();
 await expectText(day('2026-10-06'),'梳理论文并设计实验');
 await pop.waitFor({state:'hidden'});
 // Real drag/drop keeps repeat scheduling possible.
 await p.getByTestId('goal-task-'+task.id).locator('.drag-handle').dragTo(day('2026-10-07'), {targetPosition:{x:15,y:15}});
 await expectText(day('2026-10-07'),'梳理论文并设计实验');
 assert.equal((await request('GET','/week/'+monday)).tasks.filter(t=>t.goal_task_id===task.id).length,2);
 report.push('schedule popup follows chosen date outside week, rejects stale responses, schedules on click and allows repeated drag/drop');

 // The week board opens the established event editor and refreshes after save.
 await p.getByRole('button',{name:'添加 2026-10-06 日程',exact:true}).click();
 assert.equal(await p.getByTestId('event-date').inputValue(),'2026-10-06');
 await p.getByTestId('event-title').fill('周计划中新增安排');await p.getByTestId('event-start').fill('09:00');await p.getByTestId('event-end').fill('09:30');
 await p.getByTestId('event-save').click();await expectText(agenda('2026-10-06'),'周计划中新增安排');
 await a.getByTestId('agenda-event-'+meeting.id).click();
 await p.getByTestId('event-scope').waitFor();await p.getByTestId('event-title').fill('仅本次修改的组会');await p.getByTestId('event-save').click();
 await expectText(a,'仅本次修改的组会');await expectText(agenda('2026-10-07'),'周组会 '+stamp);
 await p.getByRole('button',{name:'下周 ›',exact:true}).click();await settled(agenda(next));await expectText(agenda(next),'下周的外部会议');assert.equal(await p.getByTestId('board-day-'+monday).count(),0);
 await p.getByRole('button',{name:'‹ 上周',exact:true}).click();await settled(agenda(monday));
 report.push('add/edit calendar from weekly board, recurring edit affects only selected occurrence, week navigation reloads corresponding schedule');

 // Failed loads cannot masquerade as empty days; retry recovers.
 const calendarPattern='**/api/calendar?*';
 await p.route(calendarPattern,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test outage'})}));
 await p.reload();await expectText(agenda(monday),'日程读取失败');
 assert.equal(await agenda(monday).locator('.board-event').count(),0,'failed load must not look like an empty day');
 await p.unroute(calendarPattern);await agenda(monday).getByRole('button',{name:'重试',exact:true}).click();await expectText(agenda(monday),'机器学习课程');
 report.push('calendar failure is explicit and retry restores events');

 // Mobile date dialog keeps the date and action visible around a scrolling agenda.
 await p.setViewportSize({width:390,height:844});await openPopup();await pop.locator('input[type=date]').fill(monday);await expectText(pop,'机器学习课程');
 await p.waitForTimeout(250);
 const box=await p.locator('.n-modal').boundingBox();assert(box.x>=0 && box.x+box.width<=390 && box.y>=0 && box.y+box.height<=844,'Date popup should fit viewport');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),390);await p.screenshot({path:out+'/mobile-popup.png'});
 await p.locator('.n-modal').getByRole('button',{name:'取消',exact:true}).click();await pop.waitFor({state:'hidden'});await a.scrollIntoViewIfNeeded();await p.screenshot({path:out+'/mobile-day.png'});
 await p.setViewportSize({width:1024,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),1024);
 report.push('390px date popup/action and day cards fit, 1024px layout has no horizontal overflow');

 // All remaining former normal-Enter creation fields are consistent.
 await p.setViewportSize({width:1440,height:1000});await p.goto(origin+'/?date='+monday);
 const daily=p.getByTestId('new-day-task-title').locator('input');await enterDoesNotSubmit(daily,'Daily English draft');await daily.fill('Daily English complete');
 await p.getByTestId('add-day-task').click();await expectText(p.locator('.task'),'Daily English complete');
 const today=(await request('GET','/bootstrap')).today;await p.goto(origin+'/?date='+today);
 const bg=p.getByTestId('background-label').locator('input');await enterDoesNotSubmit(bg,'Codex background draft');await bg.fill('Codex background complete');
 await p.getByTestId('background-start').click();await expectText(p.locator('.background-card'),'Codex background complete');
 await p.goto(origin+'/inbox');const capture=p.getByPlaceholder('一个想法、一个链接…写完后点「放进来」');await enterDoesNotSubmit(capture,'An English idea');await capture.fill('An English idea complete');
 await p.getByRole('button',{name:'放进来',exact:true}).click();await expectText(p.locator('.page'),'An English idea complete');
 await p.goto(origin+'/papers');await p.getByRole('button',{name:'论文组',exact:true}).click();
 const group=p.getByPlaceholder('新论文组名称');await enterDoesNotSubmit(group,'English group draft');await group.fill('English group complete');await p.getByRole('button',{name:'新建论文组',exact:true}).click();
 await p.locator('.group-edit input').first().waitFor();assert.equal(await p.locator('.group-edit input').first().inputValue(),'English group complete');
 assert.deepEqual(errors,[]);report.push('daily task, background timer, inbox and paper group: Enter/IME do not submit; explicit buttons work');
 await c.close();
} finally {await browser.close();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.length,checks:report}));
