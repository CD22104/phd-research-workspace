import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deadlineLocal,countdown,upcomingDeadlines,deadlinesOn,conferenceState,conferenceSummary,sortConferences,isSubmitted,submissionRound,submittedRound,afterSubmission} from '../web/src/lib/deadlines.js';
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
 // 没有列出评审公布日时，作者回复在截止前 7 天才回到倒计时
 assert.deepEqual(upcomingDeadlines([done],now).map(m=>m.id),['registration']);
 assert.deepEqual(upcomingDeadlines([done],Date.parse('2027-01-27T00:00:00Z')).map(m=>m.id),['rebuttal']);
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

// WWW 2027 的真实节点（AOE 换算成 UTC）
const www={key:'www-2027',name:'WWW 2027',planned:true,pinned:false,status:'verified',completed:{},milestones:[
 {id:'registration',at:'2026-10-19T11:59:59.000Z',date:'2026-10-18',stage:'registration',action:true},
 {id:'submission',at:'2026-10-26T11:59:59.000Z',date:'2026-10-25',stage:'submission',action:true},
 {id:'reviews',at:null,date:'2026-12-15',stage:'announcement',action:false},
 {id:'rebuttal',at:'2026-12-21T11:59:59.000Z',date:'2026-12-20',stage:'rebuttal',requires:'submission',action:true},
 {id:'decision',at:null,date:'2027-01-04',stage:'announcement',action:false}]};
const nov7=Date.parse('2026-11-07T07:00:00Z');
const sent={...www,completed:{registration:'2026-11-07',submission:'2026-11-07'}};
test('完成投稿 ticks registration and submission together; before that the conference only shows the passed deadline',()=>{
 assert.equal(isSubmitted(www,nov7),false);
 assert.deepEqual(submissionRound(www,nov7).ids,['registration','submission']);
 assert.equal(conferenceSummary(www,nov7).kind,'past');
 assert.equal(conferenceState(www,nov7),'新投稿已截止');
 assert.deepEqual(deadlinesOn([www],'2026-12-15',undefined,nov7),[],'announcements stay hidden until submitted');
 assert.equal(submittedRound(www),null);
});
test('After submission: out of the countdown, follow-ups (announcements included) on the calendar',()=>{
 assert.equal(isSubmitted(sent,nov7),true);
 assert.equal(submissionRound(sent,nov7),null);
 assert.deepEqual(submittedRound(sent).ids,['registration','submission']);
 assert.deepEqual(upcomingDeadlines([sent],nov7),[]);
 const summary=conferenceSummary(sent,nov7);
 assert.equal(summary.kind,'submitted');assert.equal(summary.milestone.id,'reviews');
 assert.equal(conferenceState(sent,nov7),'已投稿');
 assert.deepEqual(afterSubmission(sent,nov7).map(m=>m.id),['reviews','rebuttal','decision']);
 const reviews=deadlinesOn([sent],'2026-12-15',undefined,nov7);
 assert.deepEqual(reviews.map(m=>[m.id,m.local.time]),[['reviews',null]]);
 assert.deepEqual(deadlinesOn([sent],'2026-12-21',undefined,nov7).map(m=>[m.id,m.local.time]),[['rebuttal','19:59']]);
 assert.deepEqual(deadlinesOn([sent],'2027-01-04',undefined,nov7).map(m=>m.id),['decision']);
 assert.deepEqual(deadlinesOn([{...sent,planned:false}],'2026-12-15',undefined,nov7),[]);
});
test('Rebuttal returns to the countdown on the review day (workspace timezone) and leaves after its deadline',()=>{
 const sgDec14Late=Date.parse('2026-12-14T15:00:00Z'),sgDec15=Date.parse('2026-12-14T16:30:00Z');
 assert.deepEqual(upcomingDeadlines([sent],sgDec14Late),[]);
 assert.deepEqual(upcomingDeadlines([sent],sgDec15).map(m=>m.id),['rebuttal']);
 assert.deepEqual(upcomingDeadlines([sent],sgDec15,'UTC'),[],'still Dec 14 in UTC');
 assert.equal(conferenceSummary(sent,sgDec15).kind,'upcoming');
 const replied={...sent,completed:{...sent.completed,rebuttal:'2026-12-18'}};
 assert.deepEqual(upcomingDeadlines([replied],sgDec15),[]);
 assert.equal(conferenceSummary(replied,sgDec15).milestone.id,'reviews','review day itself is still listed');
 assert.equal(conferenceSummary(replied,Date.parse('2026-12-16T02:00:00Z')).milestone.id,'decision');
 const after=Date.parse('2026-12-22T00:00:00Z');
 assert.deepEqual(upcomingDeadlines([sent],after),[]);
 assert.equal(conferenceSummary(sent,after).milestone.id,'decision');
 assert.equal(conferenceSummary(sent,Date.parse('2027-01-05T00:00:00Z')).milestone,null);
});
test('Multi-round conferences: the button targets the open round, undo the latest ticked one',()=>{
 const sp={key:'sp',name:'S&P',planned:true,status:'verified',completed:{},milestones:[
  {id:'r1-registration',at:'2026-06-05T11:59:59Z',stage:'registration',cycle:'第一轮',action:true},
  {id:'r1-submission',at:'2026-06-12T11:59:59Z',stage:'submission',cycle:'第一轮',action:true},
  {id:'r2-registration',at:'2026-11-11T11:59:59Z',stage:'registration',cycle:'第二轮',action:true},
  {id:'r2-submission',at:'2026-11-18T11:59:59Z',stage:'submission',cycle:'第二轮',action:true},
  {id:'r2-rebuttal',at:'2027-02-17T11:59:59Z',stage:'rebuttal',cycle:'第二轮',requires:'r2-submission',action:true}]};
 assert.deepEqual(submissionRound(sp,nov7).ids,['r2-registration','r2-submission']);
 const r1={...sp,completed:{'r1-submission':'x'}};
 assert.equal(isSubmitted(r1,nov7),false,'round 2 is still open');
 assert.deepEqual(upcomingDeadlines([r1],nov7).map(m=>m.id),['r2-registration','r2-submission']);
 const r2={...sp,completed:{'r1-submission':'x','r2-registration':'y','r2-submission':'y'}};
 assert.equal(isSubmitted(r2,nov7),true);
 assert.deepEqual(submittedRound(r2).ids,['r2-registration','r2-submission']);
 const ndss={key:'ndss',name:'NDSS',planned:true,status:'verified',completed:{},milestones:[
  {id:'summer-submission',at:'2026-05-07T11:59:59Z',stage:'submission',cycle:'夏季轮',action:true},
  {id:'fall-submission',at:'2026-08-20T11:59:59Z',stage:'submission',cycle:'秋季轮',action:true}]};
 assert.deepEqual(submissionRound(ndss,nov7).ids,['fall-submission']);
 assert.equal(submissionRound({...ndss,milestones:[]},nov7),null);
});
test('Sorting puts submitted conferences after open deadlines and before closed ones',()=>{
 const open={...conference,key:'open',name:'Open',planned:false,milestones:[{id:'submission',at:'2026-12-01T11:59:59Z',stage:'submission'}]};
 const closed={...conference,key:'closed',name:'Closed',planned:false,milestones:[{id:'submission',at:'2026-10-01T11:59:59Z',stage:'submission'}]};
 assert.deepEqual(sortConferences([closed,sent,open],nov7).map(c=>c.name),['Open','WWW 2027','Closed']);
});
