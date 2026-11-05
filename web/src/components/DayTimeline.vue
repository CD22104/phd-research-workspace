<script setup>
import {computed,nextTick,onMounted,onUnmounted,reactive,ref,watch} from 'vue';
import {NButton,NModal,NSelect} from 'naive-ui';
import {api,uuid} from '../lib/api';
import {store} from '../lib/store';
import {fail,toast} from '../lib/ui';
import {fmtMin} from '../lib/format';
import {TASK_DRAG_TYPE,minuteOf,timeLabel,snapMinute,moveSlot,layoutTimeline,plannedMinutes,nextFreeMinute} from '../lib/day-timeline';
import {scheduleLabels} from '../lib/calendar-summary';
import ScheduleEventEditor from './ScheduleEventEditor.vue';
import ConferenceDayMarks from './ConferenceDayMarks.vue';

const props=defineProps({date:{type:String,required:true},tasks:{type:Array,default:()=>[]}});
const blocks=ref([]),events=ref([]),loading=ref(false),error=ref(''),saving=ref(false);
const scroll=ref(null),surface=ref(null),dropAt=ref(null),gesture=ref(null),clock=ref(Date.now());
const modal=ref(false),formError=ref('');
const form=reactive({id:null,version:null,task_id:null,date:'',start:'09:00',end:'10:00',client_key:''});
const eventOpen=ref(false),selectedEvent=ref(null);
const heightKey='honey.timeline.height.v1',minHeight=224,maxHeight=1184;
const smallScreen=window.matchMedia('(max-width:1000px)'),compact=ref(smallScreen.matches);
const heights=reactive({desktop:null,mobile:null}),windowResize=ref(null);
try{
 const saved=JSON.parse(localStorage.getItem(heightKey)||'{}');
 for(const key of ['desktop','mobile'])if(typeof saved?.[key]==='number'&&Number.isFinite(saved[key]))heights[key]=Math.max(minHeight,Math.min(maxHeight,saved[key]));
}catch{}
const heightMode=computed(()=>compact.value?'mobile':'desktop');
const windowHeight=computed(()=>heights[heightMode.value]??(compact.value?640:800));
let seq=0,interval,scrollDate='';
const PX=64/60,HEIGHT=1440*PX;
const available=computed(()=>props.tasks.filter(t=>t.date===props.date&&t.status==='todo'&&t.goal_task_status!=='done'));
const allDay=computed(()=>events.value.filter(e=>e.all_day));
const items=computed(()=>[
 ...events.value.filter(e=>!e.all_day).map(e=>({key:`event-${e.id}`,type:'event',record:e,title:e.title,kind:e.kind,start:minuteOf(e.start_time),end:minuteOf(e.end_time)})),
 ...blocks.value.map(b=>({key:`task-${b.id}`,type:'task',record:b,title:b.title,kind:'task',start:b.start_minute,end:b.end_minute,done:b.status==='done'||b.goal_task_status==='done'})),
]);
const arranged=computed(()=>layoutTimeline(items.value.map(item=>gesture.value?.key===item.key?{...item,start:gesture.value.start,end:gesture.value.end}:item)));
const occupied=computed(()=>plannedMinutes(arranged.value));
const overlap=computed(()=>arranged.value.some(x=>x.lanes>1));
const formTimes=computed(()=>({start:minuteOf(form.start),end:form.end==='00:00'?1440:minuteOf(form.end)}));
const formConflict=computed(()=>{
 const {start,end}=formTimes.value;
 return start!=null&&end!=null&&end>start&&items.value.some(x=>x.key!==`task-${form.id}`&&x.start<end&&x.end>start);
});
const nowMinute=computed(()=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:store.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(clock.value)).map(x=>[x.type,x.value]));
 return `${parts.year}-${parts.month}-${parts.day}`===props.date?Number(parts.hour)*60+Number(parts.minute):null;
});
async function load(){
 const id=++seq,date=props.date;loading.value=true;error.value='';
 try{
  const [calendar,result]=await Promise.all([api.get(`/calendar?from=${date}&to=${date}`),api.get(`/day/${date}/time-blocks`)]);
  if(id!==seq)return;
  events.value=calendar.events;blocks.value=result.blocks;
  await nextTick();
  if(id!==seq)return;
  if(scroll.value&&scrollDate!==date){
   scroll.value.scrollTop=nowMinute.value===null?480*PX:Math.max(0,nowMinute.value*PX-80);scrollDate=date;
  }
 }catch(e){if(id===seq){error.value=e.message;events.value=[];blocks.value=[];}}
 finally{if(id===seq)loading.value=false;}
}
watch(()=>props.date,()=>{modal.value=false;eventOpen.value=false;gesture.value=null;dropAt.value=null;events.value=[];blocks.value=[];load();},{immediate:true});
watch(()=>store.version,load);
onMounted(()=>{interval=setInterval(()=>clock.value=Date.now(),30000);window.addEventListener('keydown',escapeDrag);smallScreen.addEventListener('change',screenChanged);});
onUnmounted(()=>{seq++;clearInterval(interval);window.removeEventListener('keydown',escapeDrag);smallScreen.removeEventListener('change',screenChanged);});
function screenChanged(e){cancelWindowResize();compact.value=e.matches;}
function saveHeight(){try{localStorage.setItem(heightKey,JSON.stringify(heights));}catch{}}
function nowInView(){return nowMinute.value!==null&&scroll.value&&nowMinute.value*PX>=scroll.value.scrollTop&&nowMinute.value*PX<=scroll.value.scrollTop+scroll.value.clientHeight-24;}
async function setWindowHeight(height,keepNow=false){
 heights[heightMode.value]=height===null?null:Math.round(Math.max(minHeight,Math.min(maxHeight,height)));
 await nextTick();
 if(keepNow&&scroll.value&&nowMinute.value!==null&&!nowInView())scroll.value.scrollTop=Math.max(0,nowMinute.value*PX-80);
}
function beginWindowResize(e){
 if(e.button!==0||gesture.value||windowResize.value)return;
 e.preventDefault();e.currentTarget.focus({preventScroll:true});e.currentTarget.setPointerCapture(e.pointerId);
 windowResize.value={pointer:e.pointerId,y:e.clientY,height:windowHeight.value,previous:heights[heightMode.value],mode:heightMode.value,scrollTop:scroll.value.scrollTop,keepNow:nowInView()};
}
function moveWindowResize(e){
 const r=windowResize.value;if(!r||e.pointerId!==r.pointer)return;
 e.preventDefault();setWindowHeight(r.height+e.clientY-r.y,r.keepNow);
}
function finishWindowResize(){if(!windowResize.value)return;windowResize.value=null;saveHeight();}
async function cancelWindowResize(){
 const r=windowResize.value;if(!r)return;windowResize.value=null;heights[r.mode]=r.previous;
 await nextTick();if(scroll.value)scroll.value.scrollTop=r.scrollTop;
}
function changeWindowHeight(delta){if(windowResize.value)return;setWindowHeight(windowHeight.value+delta,nowInView());saveHeight();}
function resetWindowHeight(){if(windowResize.value)return;setWindowHeight(null,nowInView());saveHeight();}
function openTask(task=null,start=null,block=null){
 if(saving.value||loading.value||error.value)return;
 const begin=start??nextFreeMinute(items.value);
 Object.assign(form,{id:block?.id??null,version:block?.version??null,task_id:block?.task_id??task?.id??null,date:props.date,start:timeLabel(block?.start_minute??begin),end:timeLabel((block?.end_minute??Math.min(1440,begin+60))%1440),client_key:uuid()});
 formError.value='';modal.value=true;
}
defineExpose({openTask});
function editItem(item){if(item.type==='event'){selectedEvent.value=item.record;eventOpen.value=true;}else openTask(null,null,item.record);}
function openEvent(event=null){selectedEvent.value=event;eventOpen.value=true;}
async function saveForm(){
 const {start,end}=formTimes.value;
 if(!form.task_id){formError.value='请选择日任务';return;}
 if(start==null||end==null||end<=start){formError.value='结束时间应晚于开始时间';return;}
 if(form.date!==props.date)return;
 const payload={date:form.date,start_minute:start,end_minute:end};
 saving.value=true;formError.value='';
 try{
  if(form.id)await api.patch(`/time-blocks/${form.id}`,{...payload,base_version:form.version});
  else await api.post('/time-blocks',{...payload,task_id:form.task_id,client_key:form.client_key});
  modal.value=false;toast('时段已保存');await load();
 }catch(e){formError.value=e.message;if(e.status===409)await load();}
 finally{saving.value=false;}
}
async function removeBlock(){
 saving.value=true;formError.value='';
 try{await api.del(`/time-blocks/${form.id}?date=${form.date}&base_version=${form.version}`);modal.value=false;toast('已取消这个时段，日任务保留');await load();}
 catch(e){formError.value=e.message;if(e.status===409)await load();}
 finally{saving.value=false;}
}
function atY(y){return Math.max(0,Math.min(1425,snapMinute((y-surface.value.getBoundingClientRect().top)/PX)));}
function scrollDrag(y){const box=scroll.value.getBoundingClientRect();if(y>box.bottom-40)scroll.value.scrollTop+=18;else if(y<box.top+40)scroll.value.scrollTop-=18;}
function dragOver(e){
 if(saving.value||loading.value||error.value||![...e.dataTransfer.types].includes(TASK_DRAG_TYPE))return;
 e.preventDefault();e.dataTransfer.dropEffect='copy';scrollDrag(e.clientY);dropAt.value=atY(e.clientY);
}
async function dropTask(e){
 e.preventDefault();const start=atY(e.clientY);dropAt.value=null;
 if(saving.value||loading.value||error.value)return;
 const id=Number(e.dataTransfer.getData(TASK_DRAG_TYPE)),task=available.value.find(t=>t.id===id);
 if(!task){toast('请选择当天未完成的日任务');return;}
 saving.value=true;
 try{await api.post('/time-blocks',{date:props.date,task_id:id,start_minute:start,end_minute:Math.min(1440,start+60),client_key:uuid()});toast('已排入时间轴，可拖动底边调整时长');await load();}
 catch(e){fail(e);await load();}finally{saving.value=false;}
}
function blockStyle(item){return {top:`${item.start*PX}px`,height:`${Math.max(16,(item.end-item.start)*PX)}px`,left:`calc(52px + (100% - 58px) * ${item.lane/item.lanes})`,width:`calc((100% - 58px) / ${item.lanes} - 4px)`};}
function beginGesture(e,item,mode){
 if(e.button!==0||saving.value||loading.value||item.done)return;
 e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
 gesture.value={key:item.key,item,mode,initial:atY(e.clientY),start:item.start,end:item.end,moved:false,date:props.date};
}
function moveGesture(e){
 const g=gesture.value;if(!g)return;
 e.preventDefault();scrollDrag(e.clientY);
 const delta=atY(e.clientY)-g.initial;
 if(delta)g.moved=true;
 if(g.mode==='move')Object.assign(g,moveSlot(g.item.start,g.item.end,delta));
 else g.end=Math.max(Math.min(1440,g.start+15),Math.min(1440,snapMinute(g.item.end+delta)));
}
async function finishGesture(){
 const g=gesture.value;if(!g)return;
 if(!g.moved){gesture.value=null;return;}
 if(g.date!==props.date){gesture.value=null;return;}
 saving.value=true;
 try{await api.patch(`/time-blocks/${g.item.record.id}`,{date:g.date,base_version:g.item.record.version,start_minute:g.start,end_minute:g.end});await load();}
 catch(e){fail(e);await load();}finally{gesture.value=null;saving.value=false;}
}
function escapeDrag(e){if(e.key==='Escape'){cancelWindowResize();if(!saving.value)gesture.value=null;}}
async function keyboardMove(item,delta,resize=false){
 if(saving.value||loading.value||item.done)return;
 const slot=resize?{start:item.start,end:Math.max(Math.min(1440,item.start+15),Math.min(1440,item.end+delta))}:moveSlot(item.start,item.end,delta);
 saving.value=true;
 try{await api.patch(`/time-blocks/${item.record.id}`,{date:props.date,base_version:item.record.version,start_minute:slot.start,end_minute:slot.end});await load();}
 catch(e){fail(e);await load();}finally{saving.value=false;}
}
</script>

<template>
 <section class="card day-timeline" :class="{resizing:windowResize}" data-testid="day-timeline">
  <div class="card-title"><h3>时间规划</h3><RouterLink :to="{name:'calendar',query:{date}}" class="small">四周日程 ›</RouterLink></div>
  <p class="timeline-help">拖入日任务，拖动任务时段或底边调整；日程可点开修改。也可以点空白处安排。</p>
  <div class="timeline-toolbar"><NButton size="small" type="primary" secondary :disabled="saving||loading||!!error" @click="openTask()">＋ 排日任务</NButton><NButton size="small" secondary :disabled="saving" @click="openEvent()">＋ 日程</NButton><NButton v-if="nowMinute!==null" size="tiny" quaternary @click="scroll.scrollTop=Math.max(0,nowMinute*PX-80)">现在</NButton></div>
  <div v-if="error" class="timeline-error" role="alert">{{ error }} <NButton size="tiny" @click="load">重试</NButton></div>
  <div v-if="allDay.length" class="all-day-events"><button v-for="event in allDay" :key="event.id" @click="openEvent(event)"><span>全天 · {{ scheduleLabels[event.kind] }}</span>{{ event.title }}</button></div>
  <div class="timeline-status small"><span>已安排 {{ fmtMin(occupied) }}<span v-if="allDay.length"> · {{ allDay.length }} 项全天安排</span></span><span v-if="overlap" class="overlap-note">有重叠时段</span><span v-if="saving||loading" class="muted">{{ saving?'保存中…':'读取中…' }}</span></div>
  <div ref="scroll" class="timeline-scroll" :style="{height:windowHeight+'px'}" :aria-busy="saving||loading" @dragover="dragOver" @drop.stop="dropTask" @dragleave="e=>{if(!e.currentTarget.contains(e.relatedTarget))dropAt=null}">
   <div ref="surface" class="timeline-surface" :style="{height:HEIGHT+'px'}" @click.self="e=>openTask(null,atY(e.clientY))" @pointermove="moveGesture" @pointerup="finishGesture" @pointercancel="gesture=null">
    <div v-for="hour in 25" :key="hour" class="hour-line" :style="{top:(hour-1)*64+'px'}"><span>{{ String(hour-1).padStart(2,'0') }}:00</span></div>
    <div v-if="nowMinute!==null" class="now-line" :style="{top:nowMinute*PX+'px'}"><span>现在</span></div>
    <div v-for="item in arranged" :key="item.key" class="timeline-block" :class="[item.kind,{done:item.done,short:item.end-item.start<45,overlapping:item.lanes>1}]" :style="blockStyle(item)" :data-testid="`timeline-${item.key}`">
     <button class="block-open" :title="`${timeLabel(item.start)}–${timeLabel(item.end)} ${item.title}`" @click.stop="editItem(item)"><span class="block-time">{{ timeLabel(item.start) }}–{{ timeLabel(item.end) }}<span v-if="item.done"> · 完成</span></span><strong>{{ item.title }}</strong><span class="block-kind">{{ item.type==='task'?'日任务':scheduleLabels[item.kind] }}{{ item.record.series_id?' · 重复':'' }}</span></button>
     <button v-if="item.type==='task'&&!item.done" class="block-move" :disabled="saving||loading" :aria-label="`移动时段：${item.title}`" title="上下拖动调整开始时间，也可用方向键" @click.stop @pointerdown="e=>beginGesture(e,item,'move')" @keydown.up.prevent="keyboardMove(item,-15)" @keydown.down.prevent="keyboardMove(item,15)">⠿</button>
     <button v-if="item.type==='task'&&!item.done" class="block-resize" :disabled="saving||loading" :aria-label="`调整时长：${item.title}`" title="拖动底边调整时长，也可用方向键" @click.stop @pointerdown="e=>beginGesture(e,item,'resize')" @keydown.up.prevent="keyboardMove(item,-15,true)" @keydown.down.prevent="keyboardMove(item,15,true)"><span/></button>
    </div>
    <div v-if="dropAt!==null" class="drop-preview" :style="{top:dropAt*PX+'px',height:Math.min(60,1440-dropAt)*PX+'px'}">{{ timeLabel(dropAt) }} 排入任务</div>
   </div>
  </div>
  <div class="timeline-size-control">
   <div class="timeline-size-handle" role="slider" tabindex="0" aria-label="时间窗口高度" aria-orientation="vertical" :aria-valuemin="minHeight" :aria-valuemax="maxHeight" :aria-valuenow="windowHeight" :aria-valuetext="`约 ${Math.round((windowHeight-32)/64)} 小时`" title="上下拖动调整高度，方向键微调，双击恢复默认；Esc 取消拖动" @pointerdown="beginWindowResize" @pointermove="moveWindowResize" @pointerup="finishWindowResize" @pointercancel="cancelWindowResize" @lostpointercapture="finishWindowResize" @keydown.up.prevent="changeWindowHeight(-64)" @keydown.down.prevent="changeWindowHeight(64)" @keydown.home.prevent="changeWindowHeight(minHeight-windowHeight)" @keydown.end.prevent="changeWindowHeight(maxHeight-windowHeight)" @dblclick="resetWindowHeight"><span class="size-grip"/><span>拖动调整高度</span></div>
   <button v-if="heights[heightMode]!==null" class="height-reset" :disabled="!!windowResize" @click="resetWindowHeight">恢复默认</button>
  </div>
  <p class="timeline-foot small muted">{{ nowMinute!==null?'打开今天时定位到当前时间附近':'默认从 08:00 开始' }}，可上下滚动查看全天，拖动按 15 分钟对齐。计划时段不计入实际工时；全天活动单列，重叠时段合并计算占用时间。</p>
  <ConferenceDayMarks :date="date"/>
  <NModal :show="modal" preset="card" :title="form.id?'调整计划时段':'安排日任务时段'" style="width:min(460px,94vw)" :mask-closable="!saving" :close-on-esc="!saving" @update:show="v=>{if(!saving)modal=v}">
   <div class="slot-form"><label>日任务<NSelect v-model:value="form.task_id" :disabled="saving||!!form.id" filterable :options="available.map(t=>({value:t.id,label:t.title})).concat(form.id&&!available.some(t=>t.id===form.task_id)?[{value:form.task_id,label:blocks.find(b=>b.id===form.id)?.title||'原日任务'}]:[])" placeholder="选择当天任务" data-testid="slot-task"/></label><p v-if="!available.length&&!form.id" class="small muted">先在日计划里添加要做的事。</p><div class="slot-times"><label>开始<input v-model="form.start" type="time" step="900" :disabled="saving" data-testid="slot-start"/></label><label>结束<input v-model="form.end" type="time" step="900" :disabled="saving" data-testid="slot-end"/></label></div><span class="small muted">结束 00:00 表示当天结束；同一任务可安排多个时段。</span><p v-if="formConflict" class="overlap-note small">这个时段与已有安排重叠，可调整时间或保留并行安排。</p><div v-if="formError" role="alert" class="timeline-error">{{ formError }}</div></div>
   <template #footer><div class="slot-actions"><NButton v-if="form.id" quaternary :disabled="saving" @click="removeBlock">取消这个时段</NButton><span class="grow"/><NButton :disabled="saving" @click="modal=false">返回</NButton><NButton type="primary" :loading="saving" data-testid="slot-save" @click="saveForm">保存</NButton></div></template>
  </NModal>
  <ScheduleEventEditor v-model:show="eventOpen" :event="selectedEvent" :date="date"/>
 </section>
</template>

<style scoped>
.day-timeline{margin:0;padding:20px;min-width:0}.day-timeline .card-title{margin-bottom:10px}.timeline-help{font-size:12px;color:var(--ink-3);line-height:1.7;margin:0 0 12px}.timeline-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.timeline-status{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin:14px 0 10px;color:var(--ink-2)}.timeline-scroll{overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--line-soft);border-radius:10px;background:var(--paper,var(--card));scrollbar-width:thin;padding:12px 0 16px}.timeline-surface{position:relative;min-width:0;background:repeating-linear-gradient(to bottom,transparent 0,transparent 15px,#eeeae480 15px,#eeeae480 16px);background-position:52px 0;background-size:calc(100% - 52px) 100%;background-repeat:no-repeat;cursor:crosshair}.hour-line{position:absolute;left:0;right:0;border-top:1px solid var(--line);pointer-events:none}.hour-line span{position:absolute;top:-8px;left:0;width:48px;padding-left:5px;background:var(--paper,var(--card));font-size:10px;color:var(--ink-3);font-variant-numeric:tabular-nums}.timeline-block{position:absolute;box-sizing:border-box;border:1px solid var(--block-line);border-left:3px solid var(--accent);border-radius:7px;background:var(--block-bg);cursor:default;z-index:2;min-width:0}.timeline-block.course{background:var(--surface-sand);border-color:var(--sand-line);border-left-color:var(--sand-deep)}.timeline-block.meeting{background:var(--ev-meeting-bg);border-color:var(--ev-meeting-line);border-left-color:var(--ev-other-accent)}.timeline-block.break,.timeline-block.other{background:var(--ev-break-bg);border-color:var(--ev-break-line);border-left-color:var(--ev-break-accent)}.timeline-block.checkin{background:var(--ev-checkin-bg);border-color:var(--ev-checkin-line);border-left-color:var(--charcoal)}.timeline-block.done{background:var(--done-bg);border-color:var(--done-line);opacity:.8}.block-open{border:0;background:none;color:var(--ink);text-align:left;width:100%;height:100%;padding:5px 20px 7px 6px;display:flex;flex-direction:column;gap:3px;overflow:hidden;font:inherit;cursor:pointer;border-radius:5px}.block-open strong{font-size:12px;font-weight:500;line-height:1.35;overflow:hidden;overflow-wrap:anywhere}.block-time{font-size:10px;line-height:1.25;white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums;flex:none}.block-kind{font-size:10px;color:var(--ink-3);margin-top:auto}.short .block-kind{display:none}.short .block-open{padding-top:1px;gap:1px}.block-move{position:absolute;right:1px;top:1px;border:0;background:transparent;font-size:17px;line-height:20px;padding:0 2px;color:var(--accent-deep);cursor:grab;touch-action:none}.block-resize{position:absolute;bottom:-2px;left:0;right:0;width:100%;height:9px;border:0;background:transparent;cursor:ns-resize;touch-action:none;padding:0;display:flex;align-items:center;justify-content:center}.block-resize span{width:22px;height:3px;border-radius:2px;background:#88967799}.block-move:focus-visible,.block-resize:focus-visible,.block-open:focus-visible{outline:2px solid var(--accent);outline-offset:1px}.timeline-block.done strong{text-decoration:line-through}.now-line{position:absolute;left:47px;right:0;height:1px;background:var(--now-line);z-index:3;pointer-events:none}.now-line span{position:absolute;left:-44px;top:-7px;font-size:10px;color:var(--now-ink);background:var(--paper,var(--card));padding:0 3px}.drop-preview{position:absolute;left:52px;right:7px;border:2px dashed var(--accent);background:#dce7cfcc;pointer-events:none;z-index:5;border-radius:7px;color:var(--accent-deep);padding:4px;font-size:11px;box-sizing:border-box}.timeline-foot{margin:12px 0 0;line-height:1.7}.overlap-note{color:var(--sand-deep)}.timeline-error{color:var(--danger);font-size:12px;padding:8px 0}.all-day-events{display:grid;gap:6px;margin-top:12px}.all-day-events button{border:1px solid var(--line);border-radius:7px;background:var(--surface-warm);padding:7px 9px;text-align:left;color:var(--ink);font:inherit;font-size:12px;cursor:pointer;overflow-wrap:anywhere}.all-day-events span{font-size:10px;color:var(--ink-3);margin-right:8px}.slot-form{display:grid;gap:14px}.slot-form label{display:grid;gap:7px;font-size:13px;color:var(--ink-2)}.slot-times{display:grid;grid-template-columns:1fr 1fr;gap:12px}.slot-times input{font:inherit;color:var(--ink);border:1px solid var(--line);padding:9px;border-radius:7px;background:var(--card);min-width:0;width:100%;box-sizing:border-box}.slot-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}@media(max-width:1000px){.day-timeline{padding:18px}.timeline-size-handle{min-height:40px}}
.day-timeline.resizing{user-select:none}.timeline-size-control{display:flex;align-items:center;gap:8px;margin-top:5px}.timeline-size-handle{flex:1;min-width:0;min-height:30px;display:flex;align-items:center;justify-content:center;gap:9px;border-radius:6px;cursor:ns-resize;touch-action:none;user-select:none;font-size:11px;color:var(--ink-3)}.timeline-size-handle:hover,.resizing .timeline-size-handle{background:var(--surface-warm);color:var(--accent-deep)}.size-grip{width:25px;height:5px;border-top:1px solid currentColor;border-bottom:1px solid currentColor;opacity:.65}.timeline-size-handle:focus-visible,.height-reset:focus-visible{outline:2px solid var(--accent);outline-offset:1px}.height-reset{border:0;background:none;cursor:pointer;font:inherit;font-size:11px;color:var(--accent-deep);padding:6px;white-space:nowrap}.height-reset:disabled{opacity:.5;cursor:default}
</style>
