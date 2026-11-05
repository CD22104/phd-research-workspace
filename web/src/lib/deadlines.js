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
export function upcomingDeadlines(conferences,now=Date.now()) {
 return conferences.filter(c=>c.planned).flatMap(c=>c.milestones.filter(m=>m.at&&!c.completed[m.id]&&Date.parse(m.at)>now&&(!m.requires||c.completed[m.requires])).map(m=>({...m,conference:c}))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
export function conferenceState(c,now=Date.now()) {
 const entries=c.milestones.filter(m=>['submission','registration'].includes(m.stage)&&m.at);
 if(!entries.length)return c.status==='pending'?'日期待公布':'日期待核实';
 return entries.every(m=>Date.parse(m.at)<=now)?'新投稿已截止':'投稿节点已公布';
}
export function deadlinesOn(conferences,date,zone='Asia/Singapore') {
 return conferences.filter(c=>c.planned).flatMap(c=>c.milestones.filter(m=>m.at&&deadlineLocal(m.at,zone)?.date===date).map(m=>({...m,conference:c,local:deadlineLocal(m.at,zone)}))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}

// A collapsed conference row shows one actionable date, even when it is not followed.
export function conferenceSummary(c,now=Date.now()) {
 const next=upcomingDeadlines([{...c,planned:true}],now)[0];
 if(next)return {kind:'upcoming',milestone:next,time:Date.parse(next.at)};
 const dated=c.milestones.filter(m=>m.at&&Number.isFinite(Date.parse(m.at)));
 const past=dated.filter(m=>Date.parse(m.at)<=now&&['registration','submission'].includes(m.stage)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
 if(past)return {kind:'past',milestone:past,time:Date.parse(past.at)};
 return {kind:dated.length?'complete':'undated',milestone:null,time:0};
}
export function sortConferences(conferences,now=Date.now()) {
 const order={upcoming:0,past:1,complete:1,undated:2};
 return conferences.map(c=>({c,summary:conferenceSummary(c,now)})).sort((a,b)=>{
  const pinned=Number(b.c.pinned)-Number(a.c.pinned);if(pinned)return pinned;
  const group=order[a.summary.kind]-order[b.summary.kind];if(group)return group;
  const time=a.summary.kind==='upcoming'?a.summary.time-b.summary.time:b.summary.time-a.summary.time;
  return time||a.c.name.localeCompare(b.c.name);
 }).map(x=>x.c);
}
