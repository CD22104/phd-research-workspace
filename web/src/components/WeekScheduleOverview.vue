<script setup>
import {computed,nextTick,onUnmounted,ref,watch} from 'vue';
import {NButton} from 'naive-ui';
import {api} from '../lib/api';
import {store} from '../lib/store';
import {addDays,fmtDate,fmtMin,STATUS,weekStart} from '../lib/format';
import {scheduleLabels,sortedSchedule,summarizeSchedule} from '../lib/calendar-summary';
import ScheduleEventEditor from './ScheduleEventEditor.vue';

const props=defineProps({date:{type:String,required:true}});
const emit=defineEmits(['select-date']);
const monday=computed(()=>weekStart(props.date)),sunday=computed(()=>addDays(monday.value,6));
const rangeLabel=computed(()=>`${fmtDate(monday.value,false)} – ${sunday.value.slice(0,4)!==monday.value.slice(0,4)?sunday.value.slice(0,4)+'年 ':''}${fmtDate(sunday.value,false)}`);
const data=ref(null),loading=ref(false),error=ref(''),rail=ref(null),expanded=ref([]),collapsed=ref(false);
const editorOpen=ref(false),selected=ref(null),eventDate=ref(props.date);
const collapseKey='honey.today.weekSchedule.collapsed';
try{collapsed.value=localStorage.getItem(collapseKey)==='true';}catch{}
let sequence=0;
const days=computed(()=>Array.from({length:7},(_,i)=>{
 const date=addDays(monday.value,i),events=sortedSchedule((data.value?.events||[]).filter(e=>e.date===date));
 return {date,weekday:'周'+['一','二','三','四','五','六','日'][i],label:`${Number(date.slice(5,7))}/${Number(date.slice(8))}`,kind:data.value?.days.find(d=>d.date===date)?.kind||'work',events,summary:summarizeSchedule(events)};
}));
async function load(){
 const id=++sequence;loading.value=true;error.value='';
 try{const result=await api.get(`/calendar?from=${monday.value}&to=${sunday.value}`);if(id===sequence)data.value=result;}
 catch(e){if(id===sequence){error.value=e.message;data.value=null;}}
 finally{if(id===sequence){loading.value=false;focusDay();}}
}
async function focusDay(){
 await nextTick();const el=rail.value,day=el?.querySelector(`[data-date="${props.date}"]`);
 if(el&&day&&el.scrollWidth>el.clientWidth){const box=el.getBoundingClientRect(),item=day.getBoundingClientRect();el.scrollLeft+=item.left-box.left-(el.clientWidth-item.width)/2;}
}
watch(monday,()=>{data.value=null;expanded.value=[];load();},{immediate:true});
watch(()=>store.version,load);
watch(()=>props.date,focusDay);
onUnmounted(()=>sequence++);
function toggle(){collapsed.value=!collapsed.value;try{localStorage.setItem(collapseKey,String(collapsed.value));}catch{}if(!collapsed.value)focusDay();}
function toggleDay(date){expanded.value=expanded.value.includes(date)?expanded.value.filter(d=>d!==date):[...expanded.value,date];}
function open(date,event=null){eventDate.value=date;selected.value=event;editorOpen.value=true;}
</script>

<template>
 <section class="week-overview" data-testid="week-schedule-overview">
  <div class="week-overview-head">
   <div class="week-overview-title"><h2>{{ monday===weekStart(store.today)?'本周日程':'当周日程' }}</h2><span class="small muted" data-testid="week-schedule-range">{{ rangeLabel }}<span v-if="data"> · {{ data.events.length }} 项安排</span></span></div>
   <div class="week-overview-actions"><RouterLink :to="{name:'calendar',query:{date}}" class="small">四周日程 ›</RouterLink><NButton size="tiny" quaternary :aria-expanded="!collapsed" aria-controls="today-week-schedule" @click="toggle">{{ collapsed?'展开日程':'收起日程' }}</NButton></div>
  </div>
  <div v-show="!collapsed" id="today-week-schedule">
   <div v-if="error" class="week-state" role="alert">日程读取失败 <NButton size="tiny" @click="load">重试</NButton></div>
   <p v-else-if="loading&&!data" class="week-state muted">正在读取本周日程…</p>
   <div v-else ref="rail" class="week-schedule-rail" :aria-busy="loading">
    <section v-for="day in days" :key="day.date" class="week-schedule-day" :data-date="day.date" :class="[day.kind,{selected:day.date===date,today:day.date===store.today}]">
     <button class="week-day-select" :aria-label="`查看 ${fmtDate(day.date)} 的日计划`" :aria-pressed="day.date===date" @click="emit('select-date',day.date)"><span>{{ day.weekday }} <b>{{ day.label }}</b></span><span v-if="day.date===store.today" class="today-mark">今天</span><span v-else class="day-kind">{{ STATUS.dayKind[day.kind] }}</span></button>
     <span v-if="day.date===store.today&&day.kind!=='work'" class="rest-kind">{{ STATUS.dayKind[day.kind] }}</span>
     <div class="week-events">
      <button v-for="event in (expanded.includes(day.date)?day.events:day.events.slice(0,2))" :key="event.id" class="week-event" :class="event.kind" :data-testid="`week-event-${event.id}`" :title="`${event.title}${event.location?' · '+event.location:''}`" @click="open(day.date,event)"><span class="week-event-time">{{ event.all_day?'全天':`${event.start_time}–${event.end_time}` }} · {{ scheduleLabels[event.kind] }}</span><span class="week-event-title">{{ event.title }}</span></button>
      <span v-if="!day.events.length" class="week-empty">{{ day.kind==='rest'?'全天休息':day.kind==='leave'?'这天请假':'暂无日程' }}</span>
      <button v-if="day.events.length>2" class="more-events" :aria-expanded="expanded.includes(day.date)" @click="toggleDay(day.date)">{{ expanded.includes(day.date)?'收起':'还有 '+(day.events.length-2)+' 项 ›' }}</button>
     </div>
     <div v-if="day.events.length" class="week-day-summary"><span v-if="day.summary.minutes">占用 {{ fmtMin(day.summary.minutes) }}</span><span v-if="day.summary.allDay">{{ day.summary.allDay }} 项全天</span><span v-if="day.summary.overlap" class="overlap-hint">时段重叠</span></div>
     <button class="week-day-add" :aria-label="`添加 ${day.date} 日程`" :disabled="loading" @click="open(day.date)">＋ 日程</button>
    </section>
   </div>
  </div>
  <ScheduleEventEditor v-model:show="editorOpen" :date="eventDate" :event="selected"/>
 </section>
</template>

<style scoped>
.week-overview{margin:0 0 24px;padding:16px;border:1px solid var(--line-soft);border-radius:14px;background:var(--surface-warm);min-width:0}.week-overview-head{display:flex;gap:8px 16px;justify-content:space-between;align-items:center;flex-wrap:wrap}.week-overview-title{display:flex;gap:8px 14px;align-items:baseline;flex-wrap:wrap;min-width:0}.week-overview-title h2{margin:0;font-size:15px;font-weight:600}.week-overview-title .small{font-size:11px}.week-overview-actions{display:flex;align-items:center;gap:12px}.week-overview-actions a{font-size:11px}.week-schedule-rail{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:14px;align-items:stretch;min-width:0}.week-schedule-day{min-width:0;border:1px solid var(--line-soft);border-radius:9px;background:var(--paper,var(--card));padding:8px;display:flex;flex-direction:column;gap:7px;min-height:132px}.week-schedule-day.selected{border-color:var(--accent);background:var(--today-bg)}.week-schedule-day.rest,.week-schedule-day.leave{background:var(--surface-muted)}.week-day-select{display:flex;align-items:center;justify-content:space-between;gap:3px;width:100%;border:0;background:none;padding:2px 0 5px;text-align:left;font:inherit;font-size:11px;color:var(--ink);cursor:pointer;flex-wrap:wrap}.week-day-select b{font-weight:500;font-variant-numeric:tabular-nums}.selected .week-day-select{color:var(--accent-deep)}.today-mark{font-size:10px;color:var(--accent-deep);font-weight:600}.day-kind,.rest-kind{font-size:10px;color:var(--ink-3)}.week-events{display:grid;gap:5px}.week-event{display:grid;gap:3px;text-align:left;min-width:0;width:100%;border:1px solid transparent;border-left:2px solid var(--accent);border-radius:5px;background:var(--honey-mist);padding:5px 6px;font:inherit;color:var(--ink);cursor:pointer}.week-event.course{background:var(--surface-sand);border-left-color:var(--sand-deep)}.week-event.checkin{background:var(--ev-checkin-bg);border-left-color:var(--charcoal)}.week-event.break,.week-event.other{background:var(--ev-break-bg);border-left-color:var(--ev-break-accent)}.week-event:hover{border-color:var(--accent)}.week-event-time{font-size:10px;color:var(--ink-2);line-height:1.5;font-variant-numeric:tabular-nums}.week-event-title{font-size:12px;line-height:1.55;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.week-empty{font-size:11px;color:var(--ink-3);padding:9px 2px}.week-day-summary{display:flex;flex-wrap:wrap;gap:2px 6px;font-size:10px;color:var(--ink-3);line-height:1.6;margin-top:auto}.overlap-hint{color:var(--sand-deep)}.more-events,.week-day-add{border:0;background:none;text-align:left;font:inherit;font-size:11px;color:var(--accent-deep);padding:3px 0;cursor:pointer}.week-day-add{margin-top:auto}.week-day-add:disabled{opacity:.5;cursor:default}.week-state{font-size:12px;margin:14px 0 0}.week-day-select:focus-visible,.week-event:focus-visible,.week-day-add:focus-visible,.more-events:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.week-schedule-rail[aria-busy=true]{opacity:.6}
@media(max-width:1100px){.week-schedule-rail{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:168px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;padding-bottom:7px}.week-overview{padding:12px;margin-bottom:18px}}
</style>
