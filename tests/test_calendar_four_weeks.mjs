// Use an isolated localhost database. No production writes.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {addDays,weekStart} from '../web/src/lib/format.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.argv[2]||'http://127.0.0.1:18987';
assert(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'Local database only');
const out='/tmp/honey-four-week-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 const api=async(method,path,data)=>{
  const r=await ctx.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'calendar-test','X-Actor':'web'}});
  assert(r.ok(),`${method} ${path}: ${r.status()}`);return r.json();
 };
 const today=(await api('GET','/bootstrap')).today;
 await api('POST','/calendar/events',{date:'2026-10-05',title:'Four-week course',kind:'course',start_time:'09:00',end_time:'10:00',recurrence:{frequency:'weekly',interval:1,weekdays:[1],until:'2026-11-09'}});
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const range=async(start)=>{
  await p.locator(`.calendar-grid[aria-busy="false"] .calendar-day[data-date="${start}"]`).waitFor();
  const dates=await p.locator('.calendar-day').evaluateAll(els=>els.map(e=>e.dataset.date));
  assert.deepEqual(dates,Array.from({length:28},(_,i)=>addDays(start,i)));
  assert.equal(await p.locator('.calendar-week-heading').count(),4);
 };
 await p.goto(origin+'/calendar?date=2026-10-07');await range('2026-10-05');
 assert.equal(await p.locator('.calendar-event.course').count(),4);
 await p.getByRole('button',{name:'后四周 ›',exact:true}).click();await range('2026-11-02');
 assert.equal(await p.locator('.calendar-event.course').count(),2);
 await p.getByRole('button',{name:'‹ 前四周',exact:true}).click();await range('2026-10-05');
 const last=p.locator('.calendar-day[data-date="2026-11-01"]');
 await last.getByRole('button',{name:'＋ 安排',exact:true}).click();
 assert.equal(await p.getByTestId('event-date').inputValue(),'2026-11-01');
 await p.getByTestId('event-title').fill('Fourth-week check');
 await p.getByTestId('event-all-day').click();await p.getByTestId('event-save').click();
 await last.getByText('Fourth-week check',{exact:true}).waitFor();
 await last.getByRole('button',{name:'全天休息',exact:true}).click();
 await p.locator('.calendar-day.rest[data-date="2026-11-01"]').waitFor();
 await p.reload();await range('2026-10-05');await last.getByText('Fourth-week check',{exact:true}).waitFor();
 for(const width of [1440,1024,390]){
  await p.setViewportSize({width,height:1000});
  await p.waitForFunction(w=>document.documentElement.scrollWidth<=w,width,{timeout:5000});
  await p.screenshot({path:`${out}/calendar-${width}.png`,fullPage:true});
 }
 await p.goto(origin+'/calendar?date=2026-12-31');await range('2026-12-28');
 assert((await p.getByTestId('calendar-range').innerText()).includes('2027年'));
 await p.getByRole('button',{name:'今天',exact:true}).click();await range(weekStart(today));
 await p.getByTestId('calendar-add').click();assert.equal(await p.getByTestId('event-date').inputValue(),today);
 assert.deepEqual(errors,[]);
 console.log('PASS: 28 consecutive dates, four week groups, recurring events, paging, fourth-week creation/rest persistence, cross-year labels, Today reset, 1440/1024/390px layouts');
}finally{await browser.close();}
