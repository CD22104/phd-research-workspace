import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deadlineLocal,countdown,upcomingDeadlines,deadlinesOn,conferenceState,conferenceSummary,sortConferences} from '../web/src/lib/deadlines.js';
const now=Date.parse('2026-09-28T04:00:00Z');
const registration='2026-11-11T11:59:59.000Z',submission='2026-11-17T11:59:59.000Z';
const conference={key:'cvpr',name:'CVPR',followed:true,planned:true,status:'verified',completed:{},milestones:[{id:'registration',at:registration,stage:'registration'},{id:'submission',at:submission,stage:'submission'},{id:'rebuttal',at:'2027-02-02T11:59:59Z',stage:'rebuttal',requires:'submission'},{id:'decision',at:null,stage:'announcement'}]};
test('AOE end of day is the following Singapore evening, independent of device timezone',()=>{
 for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){
  process.env.TZ=zone;
  assert.deepEqual(deadlineLocal(registration),{date:'2026-11-11',time:'19:59'});
  assert.deepEqual(deadlineLocal(submission),{date:'2026-11-17',time:'19:59'});
  assert.equal(deadlinesOn([conference],'2026-11-10').length,0);
  assert.equal(deadlinesOn([conference],'2026-11-11')[0].id,'registration');
 }
});
test('Countdown uses elapsed 24-hour days and precise deadline boundary',()=>{
 assert.equal(countdown(registration,now).label,'还剩 44 天 7 小时');
 const due=Date.parse(registration);
 assert.equal(countdown(registration,due-1000).label,'还剩 1 分钟');
 assert.equal(countdown(registration,due).tone,'past');
 assert.equal(countdown(null,now).tone,'unknown');
 assert.equal(deadlineLocal(null),null);
});
test('Only planned, upcoming, unfinished and eligible stages reach workbench',()=>{
 assert.deepEqual(upcomingDeadlines([conference],now).map(m=>m.id),['registration','submission']);
 const done={...conference,completed:{submission:'2026-10-01'}};
 assert.deepEqual(upcomingDeadlines([done],now).map(m=>m.id),['registration','rebuttal']);
 assert.deepEqual(upcomingDeadlines([{...conference,planned:false}],now),[]);
 assert.deepEqual(upcomingDeadlines([conference],Date.parse(submission)+1),[]);
 assert.equal(conferenceState(conference,Date.parse(submission)+1),'新投稿已截止');
 assert.equal(conferenceState({status:'pending',milestones:[]},now),'日期待公布');
 assert.equal(conferenceState({status:'unconfirmed',milestones:[]},now),'日期待核实');
});

test('Browsing and pinning do not add countdowns without an explicit submission plan',()=>{
 const catalogOnly={...conference,planned:false,pinned:true};
 assert.equal(upcomingDeadlines([catalogOnly],now).length,0);
 assert.equal(deadlinesOn([catalogOnly],'2026-11-11').length,0);
 assert.equal(conferenceSummary(catalogOnly,now).milestone.id,'registration');
 assert.equal(upcomingDeadlines([{...catalogOnly,followed:false,planned:true}],now).length,2);
});
test('Single-column order is pinned, nearest eligible future, recent past, then undated',()=>{
 const create=(name,at,extra={})=>({...conference,key:name,name,pinned:false,planned:false,milestones:at?[{id:'submission',at,stage:'submission'}]:[],...extra});
 const pending=create('Unknown',null,{status:'pending',followed:true});
 const near=create('Near','2026-10-13T11:59:59Z');
 const far=create('Far','2026-11-17T11:59:59Z',{followed:true});
 const past=create('Past','2026-09-26T11:59:59Z');
 const older=create('Older','2026-08-20T11:59:59Z');
 const pinned=create('Pinned',null,{pinned:true});
 const input=[pending,far,older,near,past,pinned];
 assert.deepEqual(sortConferences(input,now).map(c=>c.name),['Pinned','Near','Far','Past','Older','Unknown']);
 assert.equal(input[0].name,'Unknown','sorting does not mutate catalog state');
 const conditional=create('Conditional',null,{milestones:[...older.milestones,{id:'rebuttal',at:'2026-10-02T11:59:59Z',stage:'rebuttal',requires:'submission'}]});
 assert.equal(conferenceSummary(conditional,now).kind,'past');
 assert.equal(conferenceSummary({...conditional,completed:{submission:'done'}},now).kind,'upcoming');
});
