// Exercise SPA navigation and already-open windows, using an isolated localhost D1.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.argv[2]||'http://127.0.0.1:18978';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Local only');
const out=process.env.COUNTDOWN_TEST_OUTPUT||'/tmp/countdown-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const report=[],errors=[];
const until=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label);};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
try{
 const c=await browser.newContext({viewport:{width:1440,height:1100}}),isolated=await browser.newContext({viewport:{width:1440,height:1100}});
 const api=async(method,path,data)=>{const r=await c.request.fetch(origin+'/api'+path,{method,data,headers:{'X-Requested-With':'countdown-sync-test','X-Actor':'web'}});assert(r.ok(),await r.text());return r.json();};
 const conferences=async()=>(await api('GET','/conferences')).conferences;
 for(const conf of await conferences())await api('PATCH','/conferences/'+conf.key,{base_version:conf.version,pinned:conf.key==='cvpr-2027',planned:conf.key==='cvpr-2027',...(conf.key==='cvpr-2027'?{milestone_id:'registration',done:false}:{})});
 const p=await c.newPage(),other=await c.newPage(),device=await isolated.newPage();
 for(const page of [p,other,device])page.on('pageerror',e=>errors.push(e.message));
 const target=(page,key)=>page.getByTestId('countdown-target-'+key);
 const visible=async(page,key)=>{await target(page,key).waitFor();};
 const hidden=async(page,key)=>{await target(page,key).waitFor({state:'hidden'});};
 await Promise.all([p.goto(origin+'/submissions'),other.goto(origin+'/'),device.goto(origin+'/')]);
 await visible(other,'cvpr-2027');await visible(device,'cvpr-2027');
 const draft=other.getByTestId('new-day-task-title').locator('input');await draft.fill('未保存的日任务草稿');
 await p.getByTestId('conference-cvpr-2027').waitFor();
 // Hold a bootstrap from an earlier change, then confirm IJCAI before it returns.
 const stale=deferred(),release=deferred(),delivered=deferred();let first=true;
 await p.route('**/api/bootstrap',async route=>{
  if(!first){await route.continue();return;}first=false;
  const response=await route.fetch();stale.resolve();await release.promise;await route.fulfill({response});delivered.resolve();
 });
 await p.getByRole('button',{name:'取消置顶 CVPR 2027',exact:true}).click();await stale.promise;
 await p.getByRole('button',{name:'计划投稿 IJCAI 2027',exact:true}).click();
 const dialog=p.getByTestId('submission-plan-dialog');await dialog.waitFor();
 await dialog.getByRole('button',{name:'确认投稿计划',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await p.locator('aside').getByText('今日',{exact:true}).click();
 await visible(p,'ijcai-2027');await visible(p,'cvpr-2027');
 assert.match(await target(p,'ijcai-2027').innerText(),/摘要截止[\s\S]*还剩/);
 release.resolve();await delivered.promise;await p.unroute('**/api/bootstrap');
 await p.waitForTimeout(300);await visible(p,'ijcai-2027');
 report.push('confirm IJCAI then sidebar Today: distinct IJCAI + CVPR countdowns; late bootstrap cannot undo the saved plan');
 await visible(other,'ijcai-2027');assert.equal(await draft.inputValue(),'未保存的日任务草稿');
 await device.evaluate(()=>window.dispatchEvent(new Event('focus')));await visible(device,'ijcai-2027');
 report.push('already-open tab updates immediately; separate browser context refreshes on focus; unsaved task draft survives');
 // Invalidation during an older GET must queue a new GET, not disappear.
 const readStarted=deferred(),releaseRead=deferred();let readCount=0;
 await other.route('**/api/conferences',async route=>{
  readCount++;
  if(readCount!==1){await route.continue();return;}
  const response=await route.fetch();readStarted.resolve();await releaseRead.promise;await route.fulfill({response});
 });
 await other.getByRole('button',{name:'刷新投稿倒计时',exact:true}).click();await readStarted.promise;
 await p.locator('aside').getByText('投稿',{exact:true}).click();
 await p.getByRole('button',{name:'管理投稿计划 IJCAI 2027',exact:true}).click();await dialog.waitFor();
 await dialog.getByRole('button',{name:'取消投稿计划',exact:true}).click();await dialog.waitFor({state:'hidden'});
 releaseRead.resolve();await hidden(other,'ijcai-2027');assert(readCount>=2);
 await other.unroute('**/api/conferences');
 await p.locator('aside').getByText('今日',{exact:true}).click();await hidden(p,'ijcai-2027');await visible(p,'cvpr-2027');
 await device.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await hidden(device,'ijcai-2027');
 assert.equal(await draft.inputValue(),'未保存的日任务草稿');
 report.push('cancellation removes target across tabs; invalidation during in-flight GET triggers a fresh read; visibility refresh works');
 await other.route('**/api/conferences',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试连接失败'})}),{times:1});
 await other.getByRole('button',{name:'刷新投稿倒计时',exact:true}).click();await other.locator('.sync-error').waitFor();await visible(other,'cvpr-2027');
 assert.equal(await draft.inputValue(),'未保存的日任务草稿');
 await other.locator('.sync-error').getByRole('button',{name:'重试',exact:true}).click();await other.locator('.sync-error').waitFor({state:'hidden'});
 report.push('failed refresh preserves saved targets and drafts; inline retry recovers without reloading the page');
 // Pending and past planned conferences need a named status instead of disappearing.
 for(const conf of await conferences())if(['cvpr-2027','acl-2027','iclr-2027','ijcai-2027'].includes(conf.key))await api('PATCH','/conferences/'+conf.key,{base_version:conf.version,planned:true,pinned:conf.key==='cvpr-2027'});
 await p.getByRole('button',{name:'刷新投稿倒计时',exact:true}).click();await visible(p,'acl-2027');
 assert.match(await target(p,'acl-2027').innerText(),/日期待公布/);assert.equal(await target(p,'acl-2027').locator('.countdown-node').count(),0);
 assert.match(await target(p,'iclr-2027').innerText(),/新投稿已截止/);assert.equal(await target(p,'iclr-2027').locator('.countdown-node').count(),0);
 // 置顶会议最多显示两个节点；离截止只剩一个时显示一个
 const {upcomingDeadlines}=await import('../web/src/lib/deadlines.js');
 const cvprNodes=Math.min(2,upcomingDeadlines((await conferences()).filter(x=>x.key==='cvpr-2027'),Date.now()).length);assert(cvprNodes>0,'CVPR 2027 已没有未截止的节点，请换一个会议');
 assert.equal(await target(p,'cvpr-2027').locator('.countdown-node').count(),cvprNodes);
 const keys=await p.locator('.countdown-target').evaluateAll(els=>els.map(x=>x.dataset.testid));
 assert.deepEqual(keys,['countdown-target-cvpr-2027','countdown-target-ijcai-2027','countdown-target-iclr-2027','countdown-target-acl-2027']);
 report.push('all planned targets have named entries: pinned first, nearest future next, past and undated statuses visible without fabricated countdowns');
 for(const width of [1440,390]){
  await p.setViewportSize({width,height:1100});
  for(const path of ['/','/week','/calendar']){
   await p.goto(origin+path);await visible(p,'ijcai-2027');await visible(p,'acl-2027');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth),width,path+' overflow');
   if(path!=='/'){const a=await p.getByTestId('submission-countdown').boundingBox(),b=await p.locator(path==='/week'?'.board-layout':'.calendar-intro').boundingBox();assert(b.y-a.y-a.height>=24);}
   await p.screenshot({path:out+'/'+width+'-'+(path==='/'?'today':path.slice(1))+'.png',fullPage:path==='/'});
  }
 }
 assert.deepEqual(errors,[]);report.push('Today/Week/Calendar at 1440px and 390px: all targets visible, no horizontal overflow, section gap preserved, no JS errors');
 await c.close();await isolated.close();
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.length,checks:report}));
