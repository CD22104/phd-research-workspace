// Browser integration against an isolated localhost database only.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.argv[2]||'http://127.0.0.1:18991';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Local database only');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
const out='/tmp/honey-week-overview-ui';mkdirSync(out,{recursive:true});
try{
 const ctx=await browser.newContext({viewport:{width:1680,height:1080}});
 const api=async(method,path,data)=>{const r=await ctx.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'week-overview-test','X-Actor':'web'}});assert(r.ok(),`${method} ${path}: ${r.status()}`);return r.json();};
 const stamp=Date.now();
 await api('POST','/calendar/events',{date:'2026-10-05',title:'周期课程 '+stamp,kind:'course',start_time:'09:00',end_time:'10:00',recurrence:{frequency:'weekly',interval:1,weekdays:[1],until:'2026-10-19'}});
 const meeting=await api('POST','/calendar/events',{date:'2026-10-08',title:'研究组会 '+stamp,kind:'meeting',start_time:'09:00',end_time:'11:00'});
 const course=await api('POST','/calendar/events',{date:'2026-10-08',title:'安全课程 '+stamp,kind:'course',start_time:'10:00',end_time:'12:00'});
 await api('POST','/calendar/events',{date:'2026-10-08',title:'运动打卡 '+stamp,kind:'checkin',start_time:'18:00',end_time:'18:30'});
 await api('POST','/calendar/events',{date:'2026-10-08',title:'全天提醒 '+stamp,kind:'other',all_day:true});
 await api('PUT','/day/2026-10-11',{kind:'rest'});
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const overview=p.getByTestId('week-schedule-overview'),timeline=p.getByTestId('day-timeline');
 const day=date=>overview.locator(`.week-schedule-day[data-date="${date}"]`);
 const ready=()=>overview.locator('.week-schedule-rail[aria-busy="false"]').waitFor();
 const readyTimeline=()=>timeline.locator('.timeline-scroll[aria-busy="false"]').waitFor();
 await p.goto(origin+'/today?date=2026-10-08');await ready();await readyTimeline();
 assert.equal(await overview.locator('.week-schedule-day').count(),7);
 assert(await day('2026-10-05').innerText().then(s=>s.includes('周期课程')));
 assert((await day('2026-10-11').getAttribute('class')).includes('rest'));
 const thursday=day('2026-10-08');
 assert.equal(await thursday.locator('.week-event').count(),2);
 assert((await thursday.locator('.week-day-summary').innerText()).includes('3 小时 30 分'));
 await thursday.getByRole('button',{name:'还有 2 项 ›',exact:true}).click();assert.equal(await thursday.locator('.week-event').count(),4);
 await overview.getByTestId('week-event-'+meeting.id).click();assert.equal(await p.getByTestId('event-date').inputValue(),'2026-10-08');
 await p.getByTestId('event-title').fill('更新后的研究组会 '+stamp);await p.getByTestId('event-save').click();
 await thursday.getByText('更新后的研究组会 '+stamp,{exact:true}).waitFor();await readyTimeline();
 await timeline.getByText('更新后的研究组会 '+stamp,{exact:true}).waitFor();
 await day('2026-10-11').getByRole('button',{name:/查看.*日计划/}).click();await readyTimeline();
 assert((await day('2026-10-11').getAttribute('class')).includes('selected'));
 await day('2026-10-11').getByRole('button',{name:'添加 2026-10-11 日程',exact:true}).click();
 assert.equal(await p.getByTestId('event-date').inputValue(),'2026-10-11');
 await p.getByTestId('event-title').fill('周日安排 '+stamp);await p.getByTestId('event-start').fill('16:00');await p.getByTestId('event-end').fill('17:00');await p.getByTestId('event-save').click();
 await day('2026-10-11').getByText('周日安排 '+stamp,{exact:true}).waitFor();await readyTimeline();await timeline.getByText('周日安排 '+stamp,{exact:true}).waitFor();
 await p.getByRole('button',{name:'后一天',exact:true}).click();await ready();await day('2026-10-12').waitFor();
 assert.equal(await day('2026-10-12').locator('.week-event.course').count(),1);assert.equal(await overview.getByTestId('week-event-'+course.id).count(),0);
 await overview.getByRole('button',{name:'收起日程',exact:true}).click();assert.equal(await p.locator('#today-week-schedule').isVisible(),false);
 await p.reload();await overview.getByRole('button',{name:'展开日程',exact:true}).waitFor();assert.equal(await p.locator('#today-week-schedule').isVisible(),false);
 await overview.getByRole('button',{name:'展开日程',exact:true}).click();await ready();
 await p.goto(origin+'/today?date=2026-10-08');await ready();
 for(const width of [1680,1280,390]){
  await p.setViewportSize({width,height:1080});await p.reload();await ready();await readyTimeline();
  await p.waitForFunction(w=>document.documentElement.scrollWidth<=w,width);
  if(width===390){
   const selectedBox=await thursday.boundingBox(),railBox=await overview.locator('.week-schedule-rail').boundingBox();
   assert(selectedBox.x>=railBox.x-1&&selectedBox.x+selectedBox.width<=railBox.x+railBox.width+1,'Selected date visible on mobile');
  }
  await p.screenshot({path:`${out}/today-${width}.png`,fullPage:true});
 }
 // A weekly read error must not silently present an empty schedule, and Retry recovers.
 await p.route('**/api/calendar?from=2026-10-05&to=2026-10-11',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporary test failure'})}));
 await p.reload();await overview.getByRole('alert').waitFor();assert.equal(await overview.locator('.week-empty').count(),0);
 await p.unroute('**/api/calendar?from=2026-10-05&to=2026-10-11');await overview.getByRole('button',{name:'重试',exact:true}).click();await ready();
 await p.goto(origin+'/today?date=2026-12-31');await ready();assert.equal(await overview.locator('.week-schedule-day[data-date="2027-01-03"]').count(),1);assert((await overview.getByTestId('week-schedule-range').innerText()).includes('2027年'));
 assert.deepEqual(errors,[]);
 console.log('PASS: seven days, recurring and all-day events, rest day, merged occupancy, overflow expansion, edits/additions sync to day timeline, date/week switching, collapse persistence, responsive layouts, error retry, cross-year week.');
}finally{await browser.close();}
