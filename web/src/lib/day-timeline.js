export const TASK_DRAG_TYPE='application/x-honey-day-task';
export const SLOT_STEP=15;
export function minuteOf(value) {
 if(typeof value!=='string'||!/^\d{2}:\d{2}$/.test(value))return null;
 const [h,m]=value.split(':').map(Number);
 return h<24&&m<60?h*60+m:null;
}
export function timeLabel(minute) {
 return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
}
export const snapMinute=value=>Math.round(value/SLOT_STEP)*SLOT_STEP;
export function moveSlot(start,end,delta) {
 const length=end-start,next=Math.max(0,Math.min(1440-length,start+snapMinute(delta)));
 return {start:next,end:next+length};
}
// Connected overlapping intervals share columns; touching endpoints do not overlap.
export function layoutTimeline(items) {
 const sorted=items.filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.start>=0&&x.end>x.start&&x.end<=1440)
  .map(x=>({...x})).sort((a,b)=>a.start-b.start||b.end-a.end||a.key.localeCompare(b.key));
 let group=[],ends=[],until=-1;
 const finish=()=>{for(const item of group)item.lanes=ends.length;group=[];ends=[];};
 for(const item of sorted){
  if(item.start>=until){finish();until=-1;}
  let lane=ends.findIndex(end=>end<=item.start);if(lane<0)lane=ends.length;
  ends[lane]=item.end;item.lane=lane;group.push(item);until=Math.max(until,item.end);
 }
 finish();return sorted;
}
export function plannedMinutes(items) {
 let end=-1,total=0;
 for(const item of [...items].sort((a,b)=>a.start-b.start)){
  total+=Math.max(0,item.end-Math.max(item.start,end));end=Math.max(end,item.end);
 }
 return total;
}
export function nextFreeMinute(items,start=540,duration=60) {
 let next=start;
 for(const item of [...items].sort((a,b)=>a.start-b.start)){
  if(item.end<=next)continue;
  if(item.start>=next+duration)break;
  next=Math.ceil(item.end/SLOT_STEP)*SLOT_STEP;
 }
 return Math.min(1440-duration,next);
}
