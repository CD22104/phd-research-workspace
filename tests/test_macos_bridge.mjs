import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(new URL('../macos/ResearchTimer/bridge.js',import.meta.url),'utf8');
function env(host='choose-project-name.pages.dev',top=true){
 const messages=[],calls=[];let failure=null;
 const window={webkit:{messageHandlers:{researchTimer:{postMessage:x=>messages.push(x)}}}};window.top=top?window:{};
 const state={running:{id:17,paused:false,elapsed_before_ms:1000},background:[{id:44,label:'Codex'}],now:new Date().toISOString()};
 const context=vm.createContext({window,location:{protocol:'https:',hostname:host},setTimeout,clearTimeout,AbortController,
  fetch:async(path,opts)=>{calls.push({path,opts});if(failure)return failure;
   if(path==='/api/timer/pause')state.running.paused=true;
   if(path==='/api/timer/resume'){state.running.id=18;state.running.paused=false;}
   if(path==='/api/timer/stop'&&JSON.parse(opts.body).session_id===state.running.id)state.running=null;
   if(path==='/api/background-timer/stop')state.background=[];
   return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>structuredClone(state)};
  }});
 vm.runInContext(source,context);return {window,messages,calls,setFailure:r=>failure=r};
}
test('bridge is absent outside the trusted main frame',()=>{
 assert.equal(env('evil.example').window.researchTimer,undefined);assert.equal(env('choose-project-name.pages.dev',false).window.researchTimer,undefined);
});
test('sync, exact session commands, background and focus stay separate',async()=>{
 const e=env();await e.window.researchTimer.sync();assert(e.messages.at(-1).ok);
 await e.window.researchTimer.command('pause',17);assert(e.messages.at(-1).running.paused);assert.equal(e.messages.at(-1).background.length,1);
 await e.window.researchTimer.command('resume',17);assert.equal(e.messages.at(-1).running.id,18);
 await e.window.researchTimer.command('stop',17);assert.equal(e.messages.at(-1).running.id,18);
 await e.window.researchTimer.command('backgroundStop',44);assert.equal(e.messages.at(-1).background.length,0);assert(e.messages.at(-1).running);
 for(const {opts} of e.calls){assert.equal(opts.credentials,'same-origin');assert.equal(opts.headers['X-Actor'],'web');assert(!JSON.stringify(opts).includes('Secret'));}
});
test('unknown commands and malformed IDs never reach HTTP',async()=>{
 const e=env();await e.window.researchTimer.sync();const n=e.calls.length;
 await e.window.researchTimer.command('../settings',17);await e.window.researchTimer.command('stop',"17');alert(1)");await e.window.researchTimer.command('stop',-1);
 assert.equal(e.calls.length,n);assert.equal(e.messages.at(-1).ok,false);
});
test('expired authentication reports error and can recover',async()=>{
 const e=env();await e.window.researchTimer.sync();e.setFailure({ok:false,status:403,headers:{get:()=> 'text/html'}});
 await e.window.researchTimer.sync();assert.equal(e.messages.at(-1).ok,false);assert.match(e.messages.at(-1).reason,/登录/);
 e.setFailure(null);await e.window.researchTimer.sync();assert.equal(e.messages.at(-1).ok,true);
});
