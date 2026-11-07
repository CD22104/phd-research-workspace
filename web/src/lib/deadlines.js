// Convert an absolute deadline into the workspace timezone, never the device timezone.
export function deadlineLocal(at,zone='Asia/Singapore') {
 if(!at||!Number.isFinite(Date.parse(at)))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function countdown(at,now=Date.now()) {
 const due=Date.parse(at);if(!Number.isFinite(due))return {label:'时间待公布',tone:'unknown'};
 const ms=due-now;if(ms<=0)return {label:'已截止',tone:'past'};
 const minutes=Math.floor(ms/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),mins=minutes%60;
 return {label:days?`还剩 ${days} 天 ${hours} 小时`:hours?`还剩 ${hours} 小时 ${mins} 分`:`还剩 ${Math.max(1,mins)} 分钟`,tone:ms<86400000?'urgent':ms<7*86400000?'soon':'normal',days};
}
const ZONE='Asia/Singapore';
const todayIn=(now,zone)=>deadlineLocal(new Date(now).toISOString(),zone).date;
const rounds=c=>c.milestones.filter(m=>m.stage==='submission'&&m.at);
const byTime=m=>m.at?Date.parse(m.at):Date.parse(m.date+'T12:00:00Z');

// Submitted = at least one submission round ticked and no later round still open.
export function isSubmitted(c,now=Date.now()) {
 const all=rounds(c);
 return all.some(m=>c.completed[m.id])&&!all.some(m=>!c.completed[m.id]&&Date.parse(m.at)>now);
}
// 「完成投稿」 ticks the next open round (or the one that just closed) together with that round's registration.
export function submissionRound(c,now=Date.now()) {
 const open=rounds(c).filter(m=>!c.completed[m.id]);
 const m=open.filter(x=>Date.parse(x.at)>now).sort((a,b)=>byTime(a)-byTime(b))[0]||open.filter(x=>Date.parse(x.at)<=now).sort((a,b)=>byTime(b)-byTime(a))[0];
 if(!m)return null;
 const reg=c.milestones.filter(x=>x.stage==='registration'&&x.at&&(x.cycle||'')===(m.cycle||'')&&!c.completed[x.id]&&Date.parse(x.at)<=Date.parse(m.at));
 return {milestone:m,ids:[...reg.map(x=>x.id),m.id]};
}
// Undo clears the latest ticked round and its registration.
export function submittedRound(c) {
 const m=rounds(c).filter(x=>c.completed[x.id]).sort((a,b)=>byTime(b)-byTime(a))[0];
 if(!m)return null;
 const reg=c.milestones.filter(x=>x.stage==='registration'&&(x.cycle||'')===(m.cycle||'')&&c.completed[x.id]);
 return {milestone:m,ids:[...reg.map(x=>x.id),m.id]};
}
// After submission a follow-up deadline (rebuttal, commitment…) waits in the calendar. It joins the countdown once the
// announcement listed before it (e.g. reviews) has arrived, or seven days ahead when no such date is listed.
function released(c,m,now,zone) {
 const at=c.milestones.indexOf(m),from=c.milestones.findIndex(x=>x.id===m.requires);
 const gate=c.milestones.slice(from+1,at).filter(x=>!x.at&&x.stage==='announcement'&&x.date).pop();
 return gate?todayIn(now,zone)>=gate.date:Date.parse(m.at)-now<=7*86400000;
}
export function upcomingDeadlines(conferences,now=Date.now(),zone=ZONE) {
 return conferences.filter(c=>c.planned).flatMap(c=>c.milestones.filter(m=>m.at&&!c.completed[m.id]&&Date.parse(m.at)>now&&(!m.requires||(c.completed[m.requires]&&released(c,m,now,zone)))).map(m=>({...m,conference:c}))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
// Everything still ahead after submission, announcements included.
export function afterSubmission(c,now=Date.now(),zone=ZONE) {
 const today=todayIn(now,zone);
 return c.milestones.filter(m=>!['registration','submission'].includes(m.stage)&&!c.completed[m.id]&&(!m.requires||c.completed[m.requires])&&(m.at?Date.parse(m.at)>now:!!m.date&&m.date>=today)).sort((a,b)=>byTime(a)-byTime(b));
}
export function conferenceState(c,now=Date.now()) {
 if(isSubmitted(c,now))return '已投稿';
 const entries=c.milestones.filter(m=>['submission','registration'].includes(m.stage)&&m.at);
 if(!entries.length)return c.status==='pending'?'日期待公布':'日期待核实';
 return entries.every(m=>Date.parse(m.at)<=now)?'新投稿已截止':'投稿节点已公布';
}
// Calendar marks: dated deadlines of planned conferences; once submitted, announcement days (reviews, decision) too.
export function deadlinesOn(conferences,date,zone=ZONE,now=Date.now()) {
 return conferences.filter(c=>c.planned).flatMap(c=>{
  const sent=isSubmitted(c,now);
  return c.milestones.filter(m=>m.at?deadlineLocal(m.at,zone)?.date===date:sent&&m.stage==='announcement'&&m.date===date).map(m=>({...m,conference:c,local:m.at?deadlineLocal(m.at,zone):{date:m.date,time:null}}));
 }).sort((a,b)=>(a.at?Date.parse(a.at):0)-(b.at?Date.parse(b.at):0));
}

// A collapsed conference row shows one actionable date, even when it is not followed.
export function conferenceSummary(c,now=Date.now(),zone=ZONE) {
 const next=upcomingDeadlines([{...c,planned:true}],now,zone)[0];
 if(next)return {kind:'upcoming',milestone:next,time:Date.parse(next.at)};
 if(isSubmitted(c,now)){const m=afterSubmission(c,now,zone)[0];return {kind:'submitted',milestone:m||null,time:m?byTime(m):Infinity};}
 const dated=c.milestones.filter(m=>m.at&&Number.isFinite(Date.parse(m.at)));
 const past=dated.filter(m=>Date.parse(m.at)<=now&&['registration','submission'].includes(m.stage)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 if(past)return {kind:'past',milestone:past,time:Date.parse(past.at)};
 return {kind:dated.length?'complete':'undated',milestone:null,time:0};
}
export function sortConferences(conferences,now=Date.now(),zone=ZONE) {
 const order={upcoming:0,submitted:1,past:2,complete:2,undated:3};
 return conferences.map(c=>({c,summary:conferenceSummary(c,now,zone)})).sort((a,b)=>{
  const pinned=Number(b.c.pinned)-Number(a.c.pinned);if(pinned)return pinned;
  const group=order[a.summary.kind]-order[b.summary.kind];if(group)return group;
  const asc=['upcoming','submitted'].includes(a.summary.kind);
  const time=asc?(a.summary.time===b.summary.time?0:a.summary.time-b.summary.time):b.summary.time-a.summary.time;
  return time||a.c.name.localeCompare(b.c.name);
 }).map(x=>x.c);
}
