import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.argv[2]||'http://127.0.0.1:18988';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Only isolated local DB');
const out='/tmp/honey-timeline-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const ctx=await browser.newContext({viewport:{width:1680,height:1050}});
 const api=async(method,path,data)=>{const r=await ctx.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'timeline-test','X-Actor':'web'}});assert(r.ok(),`${method} ${path}: ${r.status()}`);return r.json();};
 const date='2026-10-12';
 const stamp=Date.now();
 const task=await api('POST','/tasks',{title:'阅读论文并整理结论 '+stamp,date,planned:true});
 const second=await api('POST','/tasks',{title:'整理实验代码 '+stamp,date,planned:true});
 const event=await api('POST','/calendar/events',{date,title:'机器学习课程',kind:'course',start_time:'09:30',end_time:'10:30'});
 await api('POST','/calendar/events',{date,title:'全天提醒',kind:'other',all_day:true});
 const focus=(await api('POST','/timer/start',{task_id:task.id})).running;
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin+'/today?date='+date);
 const timeline=p.getByTestId('day-timeline'),surface=timeline.locator('.timeline-surface');
 const settled=()=>timeline.locator('.timeline-scroll[aria-busy="false"]').waitFor();await settled();
 await timeline.getByText('全天提醒',{exact:false}).first().waitFor();
 const add=p.waitForResponse(r=>r.url().endsWith('/api/time-blocks')&&r.request().method()==='POST');
 await p.getByRole('button',{name:'安排时间：'+task.title,exact:true}).dragTo(surface,{targetPosition:{x:100,y:576}});
 const createdResponse=await add;assert.equal(createdResponse.status(),201);const block=await createdResponse.json();
 assert.equal(block.start_minute,540);assert.equal(block.end_minute,600);await settled();
 await timeline.getByText('有重叠时段',{exact:true}).waitFor();
 const slot=p.getByTestId('timeline-task-'+block.id);
 const gesture=async(label,dy)=>{
  const handle=slot.getByRole('button',{name:label+task.title,exact:true});await handle.scrollIntoViewIfNeeded();
  const box=await handle.boundingBox(),response=p.waitForResponse(r=>r.url().endsWith('/api/time-blocks/'+block.id)&&r.request().method()==='PATCH');
  await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width/2,box.y+box.height/2+dy,{steps:8});await p.mouse.up();
  const res=await response;assert.equal(res.status(),200);await settled();return res.json();
 };
 const moved=await gesture('移动时段：',64);assert.equal(moved.start_minute,600);assert.equal(moved.end_minute,660);
 const resized=await gesture('调整时长：',32);assert.equal(resized.start_minute,600);assert.equal(resized.end_minute,690);
 assert.equal((await api('GET','/timer')).running.id,focus.id);
 await p.reload();await settled();await p.getByTestId('timeline-task-'+block.id).getByText('10:00–11:30',{exact:true}).waitFor();
 // Reuse the existing calendar editor without duplicating or moving recurring events.
 await p.getByTestId('timeline-event-'+event.id).locator('.block-open').click();
 assert.equal(await p.getByTestId('event-date').inputValue(),date);assert.equal(await p.getByTestId('event-start').inputValue(),'09:30');
 await p.getByRole('button',{name:'取消',exact:true}).click();
 // Click-to-schedule is available for keyboard and touch users.
 await p.getByRole('button',{name:'安排时间：'+second.title,exact:true}).click();
 await p.getByTestId('slot-start').fill('14:00');await p.getByTestId('slot-end').fill('15:30');await p.getByTestId('slot-save').click();await settled();
 let rows=(await api('GET',`/day/${date}/time-blocks`)).blocks;const secondBlock=rows.find(x=>x.task_id===second.id);assert.equal(secondBlock.end_minute,930);
 // Keep another period for the same task, including the end-of-day boundary.
 await p.getByRole('button',{name:'安排时间：'+second.title,exact:true}).click();
 await p.getByTestId('slot-start').fill('23:00');await p.getByTestId('slot-end').fill('00:00');await p.getByTestId('slot-save').click();await settled();
 rows=(await api('GET',`/day/${date}/time-blocks`)).blocks;assert.equal(rows.filter(x=>x.task_id===second.id).length,2);
 await p.getByTestId('slot-save').waitFor({state:'hidden'});
 for(const width of [1680,1280,390]){
  await p.setViewportSize({width,height:1050});await p.waitForFunction(w=>document.documentElement.scrollWidth<=w,width,{timeout:5000});
  await timeline.locator('.timeline-scroll').evaluate(el=>el.scrollTop=8*64);
  await p.screenshot({path:`${out}/today-${width}.png`,fullPage:true});
 }
 await p.getByTestId('timeline-task-'+secondBlock.id).locator('.block-open').click();
 await p.getByRole('button',{name:'取消这个时段',exact:true}).click();await settled();
 assert.equal((await api('GET',`/day/${date}/time-blocks`)).blocks.filter(x=>x.task_id===second.id).length,1);
 assert.equal((await api('GET','/tasks/'+second.id)).title,second.title);
 await p.getByRole('button',{name:'后一天',exact:true}).click();await settled();
 assert.equal(await p.locator('.timeline-block').count(),0);
 assert.equal((await api('GET','/timer')).running.id,focus.id);await api('POST','/timer/stop',{session_id:focus.id});
 assert.deepEqual(errors,[]);
 console.log('PASS: native task drag, overlap display, pointer move/resize, persistence, existing calendar editor, manual/multiple/midnight slots, day switch, timer preservation, desktop/tablet/mobile');
}finally{await browser.close();}
