// Focused authorization-form regression. Ephemeral D1; no feed writes or external callback request.
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base='http://127.0.0.1:8817', callback='https://chatgpt.com/connector_platform_oauth_redirect';
const output=await build({stdin:{contents:"import {handle} from './server/feed-bridge/index.ts'; export default {fetch:handle};",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
const mf=new Miniflare({modules:true,script:output.outputFiles[0].text,host:'127.0.0.1',port:8817,compatibilityDate:'2025-07-18',log:new Log(LogLevel.NONE),d1Databases:{DB:'consent-only'},bindings:{DEV_NO_AUTH:'1',FEED_MCP_ORIGIN:base,FEED_OAUTH_SECRET:'isolated-consent-test-secret-0123456789'}});
let browser,stage="initialization";
try {
 stage="local-worker-start"; await mf.ready;
 stage="temporary-oauth-tables"; const db=await mf.getD1Database('DB');
 const migration=readFileSync('migrations/0012_feed_bridge.sql','utf8');
 for (const table of ['feed_oauth_grants','feed_oauth_tokens']) {
  const statement=migration.match(new RegExp('CREATE TABLE '+table+' \\([\\s\\S]*?\\n\\);'))?.[0];
  assert.ok(statement,'OAuth test schema available'); await db.prepare(statement).run();
 }
 stage="client-registration"; const registration=await fetch(base+'/feed-bridge/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Browser consent regression',redirect_uris:[callback],token_endpoint_auth_method:'none'})});
 assert.equal(registration.status,201);
 const client=await registration.json(),state=randomBytes(24).toString('base64url'),verifier=randomBytes(48).toString('base64url');
 const query=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:callback,resource:base+'/feed-bridge/mcp',scope:'feeds:save feeds:read',state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
 stage="chromium-launch"; browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || (process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext();
 let callbackReached=false,postStatus=null,locationValid=false,codePresent=false,statePreserved=false,csrfSent=false,cspBlocked=false,originMatches=false,originIsNull=false;
 const page=await context.newPage();
 // Intercept the redirected navigation directly at Chromium's network layer.
 // No request containing the synthetic authorization code reaches ChatGPT.
 const cdp=await context.newCDPSession(page);
 await cdp.send('Fetch.enable',{patterns:[{urlPattern:callback+'*',requestStage:'Request'}]});
 cdp.on('Fetch.requestPaused',async event=>{
  const target=new URL(event.request.url);
  if(target.origin+target.pathname===callback){
   callbackReached=true;
   await cdp.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<p>Callback intercepted locally</p>').toString('base64')});
  } else await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});
 });
 page.on('console',message=>{if(message.text().includes('form-action'))cspBlocked=true;});
 await page.addInitScript(()=>{window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.effectiveDirective));});
 page.on('request',req=>{if(req.method()==='POST' && new URL(req.url()).pathname==='/feed-connect/authorize'){csrfSent=!!new URLSearchParams(req.postData() || '').get('csrf');originMatches=req.headers()['origin']===base;originIsNull=req.headers()['origin']==='null';}});
 const responsePromise=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname==='/feed-connect/authorize',{timeout:8000});
 stage="authorization-get"; await page.goto(base+'/feed-connect/authorize?'+query);
 stage="csrf-dom"; const csrfHasValue=await page.locator('input[name=csrf]').evaluate(e=>e.value.length>=32 && e.getAttribute('value')===e.value);
 assert.ok(csrfHasValue,'CSRF has a nonempty DOM value');
 stage="submit-form"; await page.getByRole('button',{name:'允许连接'}).click({noWaitAfter:true});
 stage="post-response"; const response=await responsePromise.catch(()=>null);
 if (!response) {
  console.log(JSON.stringify({mode:'before-fix',csrf_dom_value_present:csrfHasValue,csrf_submitted:csrfSent,origin_matches:originMatches,callback_navigation_allowed:callbackReached,csp_form_action_violation:cspBlocked}));
  assert.ok(process.env.EXPECT_BLOCKED==='1' && cspBlocked && !callbackReached,'Original form-action blocks the redirect');
 } else {
 postStatus=response.status();
 console.log(JSON.stringify({post_status:postStatus,origin_matches:originMatches,origin_null:originIsNull,location_present:!!response.headers()['location']}));
 const target=new URL(response.headers()['location']);locationValid=target.origin+target.pathname===callback;codePresent=!!target.searchParams.get('code');statePreserved=target.searchParams.get('state')===state;
 await page.waitForURL(url=>url.origin+url.pathname===callback,{waitUntil:'domcontentloaded',timeout:3000}).catch(()=>{});
 let violations=[];try{violations=await page.evaluate(()=>window.__csp || []);}catch{}
 const result={mode:process.env.EXPECT_BLOCKED==='1'?'before-fix':'after-fix',csrf_dom_value_present:csrfHasValue,csrf_submitted:csrfSent,post_status:postStatus,callback_location_exact:locationValid,code_present:codePresent,state_preserved:statePreserved,callback_navigation_allowed:callbackReached,csp_form_action_violation:cspBlocked || violations.includes('form-action')};
 console.log(JSON.stringify(result));
 assert.ok(csrfSent && locationValid && codePresent && statePreserved,'POST preserves the authorization parameters');
 if(process.env.EXPECT_BLOCKED==='1'){assert.equal(callbackReached,false,'Original CSP blocks callback');}
 else {
  assert.equal(postStatus,302);assert.equal(callbackReached,true,'Browser reaches the permitted callback');
  // Fresh consent, altered CSRF must still fail without redirecting.
  await page.goto(base+'/feed-connect/authorize?'+query);
  await page.locator('input[name=csrf]').evaluate(e=>{e.value='invalid';});
  const deniedPromise=page.waitForResponse(r=>r.request().method()==='POST' && new URL(r.url()).pathname==='/feed-connect/authorize',{timeout:8000});
  await page.getByRole('button',{name:'允许连接'}).click({noWaitAfter:true});
  const denied=await deniedPromise;
  assert.equal(denied.status(),403);assert.equal(denied.headers()['location'],undefined);
  console.log(JSON.stringify({invalid_csrf_rejected:true,unauthorized_redirect:false}));
 }
 }
} catch (error) {
 console.error(JSON.stringify({failed_stage:stage,error_type:error?.constructor?.name}));
 console.error('Authorization browser regression failed; request URLs, code, token, state and headers suppressed.');process.exitCode=1;
} finally { if(browser)await browser.close();await mf.dispose(); }
