import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {deadlineLocal,upcomingDeadlines,conferenceSummary} from '../web/src/lib/deadlines.js';

const source=readFileSync(new URL('../server/data/conferences.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const {CONFERENCES}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const now=Date.parse('2026-10-06T04:00:00Z');
const get=key=>({...CONFERENCES.find(c=>c.key===key),planned:false,completed:{}});

test('WWW long-paper dates use the updated CFP and flow into planned countdowns',()=>{
 const c=get('www-2027');
 assert.equal(c.checked_at,'2026-10-06');
 assert.equal(c.ccf,'A');
 assert.deepEqual(upcomingDeadlines([c],now),[]);
 const upcoming=upcomingDeadlines([{...c,planned:true}],now);
 assert.deepEqual(upcoming.map(m=>m.id),['registration','submission']);
 assert.deepEqual(upcoming.map(m=>deadlineLocal(m.at)),[
  {date:'2026-10-19',time:'19:59'},
  {date:'2026-10-26',time:'19:59'},
 ]);
 assert.equal(conferenceSummary(c,now).milestone.id,'registration');
 assert(!upcoming.some(m=>m.stage==='rebuttal'),'author response requires an existing submission');
});

test('Proposed or incomplete dates do not produce precise countdowns',()=>{
 for(const key of ['sigir-2027','kdd-2027','ase-2027']){
  const c={...get(key),planned:true};
  assert.equal(conferenceSummary(c,now).kind,'undated',key);
  assert.deepEqual(upcomingDeadlines([c],now),[],key);
 }
 for(const key of ['aaai-2027','icse-2027','fse-2027']){
  const c={...get(key),planned:true};
  assert.equal(conferenceSummary(c,now).kind,'past',key);
  assert.deepEqual(upcomingDeadlines([c],now),[],key);
 }
 assert.equal(get('ijcai-2027').ccf,'B','2026 edition changed IJCAI classification');
});

test('Catalog keys and milestone dependencies are valid',()=>{
 assert.equal(new Set(CONFERENCES.map(c=>c.key)).size,CONFERENCES.length);
 for(const c of CONFERENCES){
  assert.equal(new Set(c.milestones.map(m=>m.id)).size,c.milestones.length,c.key);
  assert.equal(new URL(c.source).protocol,'https:');
  for(const m of c.milestones){
   if(m.at)assert(Number.isFinite(Date.parse(m.at)),c.key);
   if(m.requires)assert(c.milestones.some(p=>p.id===m.requires),c.key);
  }
 }
});
