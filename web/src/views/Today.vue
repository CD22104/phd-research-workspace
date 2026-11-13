<script setup>
import SubmissionCountdown from '../components/SubmissionCountdown.vue';
import { computed,nextTick,onMounted,onUnmounted,reactive,ref,watch } from 'vue';
import { useRoute } from 'vue-router';
import { NButton,NInput,NSelect,NProgress,NModal,NCheckbox,NPopover,NRadioGroup,NRadioButton } from 'naive-ui';
import { api } from '../lib/api';
import { store,changed } from '../lib/store';
import { fail,toast,confirm } from '../lib/ui';
import { STATUS,addDays,fmtDate,fmtMin,fmtTime,fmtClock } from '../lib/format';
import { startTimer,stopTimer,pauseTimer,resumeTimer,timerElapsed } from '../lib/timer';
import ScoreCard from '../components/ScoreCard.vue';
import TaskRow from '../components/TaskRow.vue';
import TaskEditModal from '../components/TaskEditModal.vue';
import PaperSchedulePicker from '../components/PaperSchedulePicker.vue';
import BackgroundTimers from '../components/BackgroundTimers.vue';
import DailyFeeds from '../components/DailyFeeds.vue';
import DayTimeline from '../components/DayTimeline.vue';
import WeekScheduleOverview from '../components/WeekScheduleOverview.vue';
import WeekGoalsGlance from '../components/WeekGoalsGlance.vue';
import { PERIODS,PERIOD_LABEL,currentPeriod,eventsByPeriod,acceptsPlanDrag,readPlanDrag } from '../lib/periods';
import { TASK_DRAG_TYPE } from '../lib/day-timeline';
const route=useRoute();
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
const date=ref(validDate(route.query.date)?route.query.date:store.today);
watch(()=>route.query.date,v=>{if(validDate(v))date.value=v;});
const d=ref(null),loading=ref(false),error=ref(''),editing=ref(null),pendingOpen=ref(false),pending=ref([]),pendingPick=ref([]),dragOver=ref(''),timerTask=ref(null),now=ref(Date.now()),events=ref([]);
const busy=reactive({}),review=reactive({review:'',mood:null,energy:null});
const newTask=reactive({title:'',goal_id:null,points:1,paper_ids:[],period:null});
const newPapers=ref([]);
const timeline=ref(null);
let seq=0,tick;
onMounted(()=>{tick=setInterval(()=>now.value=Date.now(),1000);});onUnmounted(()=>clearInterval(tick));
async function load(){const id=++seq;loading.value=true;error.value='';api.get(`/calendar?from=${date.value}&to=${date.value}`).then(r=>{if(id===seq)events.value=r.events||[];}).catch(()=>{if(id===seq)events.value=[];});try{const data=await api.get(`/day/${date.value}`);if(id!==seq)return;d.value=data;Object.assign(review,{review:data.day?.review||'',mood:data.day?.mood??null,energy:data.day?.energy??null});if(timerTask.value && !data.tasks.some(t=>t.id===timerTask.value && t.status==='todo' && t.goal_task_status!=='done'))timerTask.value=null;}catch(e){if(id===seq){error.value=e.message;fail(e);}}finally{if(id===seq)loading.value=false;}}
watch(date,load);watch(()=>store.version,load);load();
const isToday=computed(()=>date.value===store.today);
// 上午 / 下午 / 晚上：今天高亮当前时段；新任务默认放进当前时段（其他日期默认上午）
const nowPeriod=computed(()=>isToday.value?currentPeriod(store.timezone,now.value):null);
const defaultPeriod=computed(()=>isToday.value?currentPeriod(store.timezone):'morning');
watch(date,()=>{newTask.period=defaultPeriod.value;},{immediate:true});
const grouped=computed(()=>eventsByPeriod(events.value));
const sections=computed(()=>{
  const tasks=d.value?.tasks||[];
  const rows=PERIODS.map(p=>({...p,period:p.key,tasks:tasks.filter(t=>t.period===p.key),events:grouped.value[p.key]}));
  const loose=tasks.filter(t=>!t.period);
  return loose.length?[{key:'none',period:null,label:'未定时段',range:'拖到上午 / 下午 / 晚上',tasks:loose,events:[]},...rows]:rows;
});
const PERIOD_CHOICES=[...PERIODS.map(p=>({value:p.key,label:p.label})),{value:'none',label:'未定'}];
const timelineOpen=ref((()=>{try{return localStorage.getItem('honey.today.timeline.open')==='1';}catch{return false;}})());
function toggleTimeline(open){timelineOpen.value=open;try{localStorage.setItem('honey.today.timeline.open',open?'1':'0');}catch{}}
async function scheduleTime(t){toggleTimeline(true);await nextTick();timeline.value?.openTask(t);}
const planned=computed(()=>(d.value?.tasks||[]).filter(t=>t.planned));
const unplanned=computed(()=>(d.value?.tasks||[]).filter(t=>!t.planned));
const s=computed(()=>d.value?.summary);
const hoursPct=computed(()=>s.value?.targetMinutes?Math.min(100,Math.round((s.value.minutes/s.value.targetMinutes)*100)):0);
const pendingCount=computed(()=>(d.value?.pending||[]).reduce((a,p)=>a+p.n,0));
const availableTasks=computed(()=>(d.value?.tasks||[]).filter(t=>t.status==='todo' && t.goal_task_status!=='done'));
const elapsed=computed(()=>timerElapsed(store.running,now.value));
const completed=computed(()=>planned.value.filter(t=>t.status==='done'||t.goal_task_status==='done').length);
const POINTS=[1,2,3,5].map(value=>({label:`${value} 点`,value}));
const MOODS=['😣','😕','😐','🙂','😄'],ENERGY=['🪫','🔋','🔋🔋','⚡','⚡⚡'];
async function run(key,fn){if(busy[key])return;busy[key]=true;try{await fn();}catch(e){fail(e);}finally{busy[key]=false;}}
async function checkin(){await run('checkin',async()=>{await api.post(`/day/${date.value}/checkin`,{});toast('日计划已确认，开始吧');changed();});}
async function setKind(kind){await run('kind',async()=>{await api.put(`/day/${date.value}`,{kind});changed();});}
function choosePapers(papers){newPapers.value=papers;if(!newTask.title.trim()&&papers.length)newTask.title=papers.length===1?`阅读：${papers[0].short_name||papers[0].title}`:`阅读选中的 ${papers.length} 篇论文`;}
async function addTask(){if(!newTask.title.trim())return;await run('add',async()=>{await api.post('/tasks',{...newTask,period:newTask.period==='none'?null:newTask.period,title:newTask.title.trim(),date:date.value,planned:true});Object.assign(newTask,{title:'',goal_id:null,points:1,paper_ids:[]});newPapers.value=[];changed();});}
async function toggle(t){await run(`task-${t.id}`,async()=>{await api.patch(`/tasks/${t.id}`,{status:t.status==='done'?'todo':'done'});changed();});}
async function carry(t){await run(`task-${t.id}`,async()=>{if(t.goal_task_id)await api.post(`/goal-tasks/${t.goal_task_id}/schedule`,{date:addDays(date.value,1),planned:true});else await api.post('/tasks/carry',{ids:[t.id],to:addDays(date.value,1)});toast('已安排到明天');changed();});}
async function drop(t){await run(`task-${t.id}`,async()=>{await api.patch(`/tasks/${t.id}`,{status:t.status==='dropped'?'todo':'dropped'});changed();});}
async function remove(t){if(!(await confirm('删除日任务？',`「${t.title}」已有的计时记录会保留。`,'删除')))return;await run(`task-${t.id}`,async()=>{await api.del(`/tasks/${t.id}`);changed();});}
async function saveReview(){await run('review',async()=>{await api.put(`/day/${date.value}`,review);toast('复盘已保存');changed();});}
async function openPending(){await run('pending',async()=>{pending.value=(await api.get(`/tasks/pending?before=${date.value}`)).tasks.filter(t=>!t.goal_task_id);pendingPick.value=pending.value.map(t=>t.id);pendingOpen.value=true;});}
async function carryPending(){if(!pendingPick.value.length)return;await run('pendingSave',async()=>{await api.post('/tasks/carry',{ids:pendingPick.value,to:date.value});pendingOpen.value=false;toast(`已带入 ${pendingPick.value.length} 项`);changed();});}
// 拖进某一段：周子任务 → 安排到这一天这一段；日任务 → 换时段。拖到日计划卡片的空白处按默认时段处理
function acceptDrag(e,key){if(!acceptsPlanDrag(e,TASK_DRAG_TYPE))return;e.preventDefault();e.dataTransfer.dropEffect=[...e.dataTransfer.types].includes(TASK_DRAG_TYPE)?'move':'copy';dragOver.value=key;}
function leaveDrag(e,key){if(!e.currentTarget.contains(e.relatedTarget)&&dragOver.value===key)dragOver.value='';}
async function dropOn(e,period){
  e.preventDefault();dragOver.value='';
  const src=readPlanDrag(e,TASK_DRAG_TYPE);if(!src||!Number.isInteger(src.id)||src.id<1)return;
  const label=period?PERIOD_LABEL[period]:'未定时段';
  if(src.kind==='goal-task')return run(`schedule-${src.id}`,async()=>{await api.post(`/goal-tasks/${src.id}/schedule`,{date:date.value,period,planned:true});toast(`已加入日计划 · ${label}`);changed();});
  const t=(d.value?.tasks||[]).find(x=>x.id===src.id);if(t&&(t.period||null)===period)return;
  await run(`task-${src.id}`,async()=>{await api.post(`/tasks/${src.id}/move`,{date:date.value,period});toast(`已移到${label}`);changed();});
}
async function setPeriod(t,period){if((t.period||null)===period)return;await run(`task-${t.id}`,async()=>{await api.post(`/tasks/${t.id}/move`,{date:t.date,period});toast(`已移到${period?PERIOD_LABEL[period]:'未定时段'}`);changed();});}
async function startBackground(t){await run('background-'+t.id,async()=>{await api.post('/background-timer/start',{task_id:t.id,label:t.title});toast('已开始后台计时');changed();});}
async function controlTimer(){await run('timer',async()=>{if(store.running)await stopTimer();else if(timerTask.value)await startTimer({task_id:timerTask.value});});}
</script>
<template>
  <div class="page today-page">
    <div class="page-head day-heading">
      <NButton size="small" quaternary aria-label="前一天" @click="date=addDays(date,-1)">‹ 前一天</NButton>
      <h1>{{ isToday?'今天':date>store.today?'日计划':'这一天' }}</h1>
      <NPopover trigger="click" placement="bottom"><template #trigger><button class="date-text" aria-label="选择日期" title="点击选择日期">{{ fmtDate(date) }}</button></template><label class="small">跳转日期 <input class="date-input" type="date" :value="date" aria-label="跳转日期" @change="validDate($event.target.value) && (date=$event.target.value)" /></label></NPopover>
      <NButton size="small" quaternary aria-label="后一天" @click="date=addDays(date,1)">后一天 ›</NButton>
      <NButton v-if="!isToday" size="small" secondary @click="date=store.today">回到今天</NButton>
    </div>
    <WeekScheduleOverview :date="date" @select-date="date=$event"/>
    <div v-if="error" class="card row"><span>{{ error }}</span><NButton size="small" @click="load">重试</NButton></div>
    <div v-if="d" class="today-layout">
      <main class="main-column">
        <section class="card plan-card" :class="{over:dragOver==='card'}" data-testid="today-drop" @dragover="e=>acceptDrag(e,'card')" @dragleave="e=>leaveDrag(e,'card')" @drop="e=>dropOn(e,newTask.period==='none'?null:newTask.period)">
          <div class="card-title plan-title"><div><h3>日计划 <span class="small muted">{{ completed }}/{{ planned.filter(t=>t.status!=='dropped'||t.goal_task_status==='done').length }}</span></h3><span v-if="d.day?.checkin_at" class="small muted">{{ fmtTime(d.day.checkin_at) }} 已确认</span></div><NButton v-if="!d.day?.checkin_at" type="primary" size="small" :loading="busy.checkin" data-testid="confirm-day" @click="checkin">确认日计划 · 开始一天</NButton><span v-else class="pill leaf">计划已确认</span></div>
          <section v-for="sec in sections" :key="sec.key" class="period-block" :class="{now:sec.key===nowPeriod,over:dragOver===sec.key,loose:sec.key==='none'}" :data-testid="`period-${sec.key}`" @dragover.stop="e=>acceptDrag(e,sec.key)" @dragleave="e=>leaveDrag(e,sec.key)" @drop.stop="e=>dropOn(e,sec.period)">
            <div class="period-head"><b class="period-mark">{{ sec.label }}</b><small class="muted">{{ sec.range }}</small><span v-if="sec.key===nowPeriod" class="pill leaf now-pill">现在</span><span class="grow"/><span v-if="sec.tasks.length" class="small muted">{{ sec.tasks.filter(t=>t.status==='done'||t.goal_task_status==='done').length }}/{{ sec.tasks.length }}</span></div>
            <div v-if="sec.events.length" class="period-events"><span v-for="ev in sec.events" :key="ev.id" class="period-event" :class="ev.kind"><span class="ev-time">{{ ev.start_time }}–{{ ev.end_time }}</span> {{ ev.title }}</span></div>
            <TaskRow v-for="t in sec.tasks" :key="t.id" :task="t" schedulable periods :busy="busy[`task-${t.id}`]" @schedule="scheduleTime" @period="setPeriod" @toggle="toggle" @edit="editing=$event" @carry="carry" @drop="drop" @remove="remove" @background="startBackground"/>
            <div v-if="!sec.tasks.length" class="period-empty small">{{ sec.key===nowPeriod ? '现在这段还空着，把任务拖进来' : '把任务拖到这里' }}</div>
          </section>
          <div class="add-task"><NInput v-model:value="newTask.title" placeholder="＋ 添加今天要做的事" :disabled="busy.add" data-testid="new-day-task-title"/><div class="task-options"><NRadioGroup v-model:value="newTask.period" size="small" name="new-task-period" :disabled="busy.add" aria-label="时段"><NRadioButton v-for="o in PERIOD_CHOICES" :key="o.value" :value="o.value" :label="o.label" :data-testid="`new-task-period-${o.value}`"/></NRadioGroup><PaperSchedulePicker v-model="newTask.paper_ids" :papers="newPapers" :disabled="busy.add" label="选论文建阅读任务" @selected="choosePapers"/><NButton size="small" type="primary" :loading="busy.add" :disabled="!newTask.title.trim()" data-testid="add-day-task" @click="addTask">加入日计划</NButton></div><details class="task-details"><summary class="small muted">关联周计划 / 工作量</summary><p class="small muted">选择周计划后，会同步加入对应的小任务池。</p><div class="row"><NSelect v-model:value="newTask.goal_id" size="small" :options="d.goals.filter(g=>g.status!=='dropped').map(g=>({label:g.title,value:g.id}))" clearable placeholder="周计划（可选）" class="grow"/><NSelect v-model:value="newTask.points" size="small" :options="POINTS" style="width:90px"/></div></details></div>
        </section>
        <div v-if="pendingCount" class="pending-hint"><span class="small muted">之前还有未完成事项</span><NButton size="tiny" quaternary :loading="busy.pending" @click="openPending">带入独立日任务</NButton></div>
        <details class="card timeline-fold" :open="timelineOpen" data-testid="timeline-fold" @toggle="e=>toggleTimeline(e.target.open)"><summary>时间规划 <span class="small muted">需要排到具体几点时展开</span></summary>
          <DayTimeline v-if="timelineOpen" ref="timeline" class="timeline-column" :date="date" :tasks="d.tasks"/>
        </details>
        <DailyFeeds :date="date"/>
        <details class="card secondary-section"><summary>晚间复盘 <span v-if="d.day?.reviewed_at" class="pill leaf">已记录</span></summary><NInput v-model:value="review.review" type="textarea" :autosize="{minRows:3,maxRows:10}" placeholder="今天的结论、卡点，或明天先做什么"/><div class="row review-mood"><span class="small muted">心情</span><button v-for="(m,i) in MOODS" :key="m" class="face" :class="{on:review.mood===i+1}" @click="review.mood=review.mood===i+1?null:i+1">{{m}}</button><span class="small muted">精力</span><button v-for="(m,i) in ENERGY" :key="m" class="face" :class="{on:review.energy===i+1}" @click="review.energy=review.energy===i+1?null:i+1">{{m}}</button></div><NButton type="primary" size="small" :loading="busy.review" @click="saveReview">保存复盘</NButton></details>
        <details class="card secondary-section"><summary>执行记录与当天设置</summary><ScoreCard :score="s?.score" title="当天执行" compact/><div class="row" style="margin-top:12px"><span class="small muted">当天类型</span><NSelect size="small" style="width:120px" :value="s?.kind" :disabled="busy.kind" :options="Object.entries(STATUS.dayKind).map(([value,label])=>({value,label}))" @update:value="setKind"/></div><p v-if="d.day?.plan_note" class="small muted">之前的计划备注：{{ d.day.plan_note }}</p></details>
      </main>
      <aside class="side-column">
        <WeekGoalsGlance :date="date" :week="d.week" :goals="d.goals" :goal-tasks="d.goal_tasks" :tasks="d.tasks" :default-period="defaultPeriod"/>
        <section class="card timer-card"><div class="card-title"><h3>专注计时</h3><RouterLink to="/sessions" class="small">记录 ›</RouterLink></div>
          <template v-if="store.running"><div class="timer-label">{{ store.running.task_title || store.running.label || '进行中' }} <span v-if="store.running.paused" class="small">· 已暂停</span></div><div class="timer-clock mono">{{ fmtClock(elapsed) }}</div><div class="row timer-controls"><NButton class="grow" type="primary" :loading="busy.timer" data-testid="pause-day-timer" @click="run('timer',()=>store.running.paused?resumeTimer():pauseTimer())">{{ store.running.paused?'继续':'暂停' }}</NButton><NButton class="grow" type="warning" :loading="busy.timer" data-testid="stop-day-timer" @click="controlTimer">停止并保存</NButton></div></template>
          <template v-else><NSelect v-model:value="timerTask" :options="availableTasks.map(t=>({label:t.title,value:t.id}))" placeholder="选择一项日任务" clearable/><NButton block type="primary" :disabled="!timerTask" :loading="busy.timer" style="margin-top:10px" data-testid="start-day-timer" @click="controlTimer">▶ 开始计时</NButton><p class="small muted timer-help">也可以直接点任务旁的 ▶。</p></template>
          <div class="hours"><div class="row small"><span class="grow">{{ isToday?'今日':'当天' }}已记录 <b>{{ fmtMin(s?.minutes) }}</b></span><span class="muted">{{ fmtMin(s?.targetMinutes) }} 计划</span></div><NProgress type="line" :percentage="hoursPct" :height="6" :show-indicator="false"/></div>
          <details v-if="d.sessions.length" class="session-details"><summary class="small muted">{{ d.sessions.length }} 段计时</summary><div v-for="x in d.sessions" :key="x.id" class="session small"><span class="muted">{{ fmtTime(x.start_at) }}–{{ x.end_at?fmtTime(x.end_at):'进行中' }}</span><span>{{ x.task_title || x.label || '未命名' }}</span></div></details>
        </section>
        <BackgroundTimers :date="date" :tasks="d.tasks"/>
        <SubmissionCountdown class="submission-card" />
        <div class="quick-links"><RouterLink to="/papers">论文库</RouterLink><RouterLink to="/inbox">收件箱 {{ store.counts.captures || 0 }}</RouterLink><NButton size="tiny" quaternary @click="store.captureOpen=true">随手记</NButton></div>
      </aside>
    </div><div v-else-if="loading" class="empty">加载中…</div>
    <TaskEditModal :task="editing" :goals="d?.goals || []" @close="editing=null" @saved="editing=null;changed()"/>
    <NModal v-model:show="pendingOpen" preset="card" title="带入之前的日任务" style="width:min(560px,95vw)"><p class="small muted">周计划的小任务可到「周计划」页面安排。这里列出独立的未完成日任务，带入后原日期显示「已顺延」。</p><p v-if="!pending.length" class="small muted">没有需要顺延的独立日任务。</p><div v-for="t in pending" :key="t.id" class="row" style="padding:6px 0"><NCheckbox :checked="pendingPick.includes(t.id)" @update:checked="v=>pendingPick=v?[...pendingPick,t.id]:pendingPick.filter(x=>x!==t.id)"/><span class="grow">{{t.title}}</span><span class="muted small">{{fmtDate(t.date,false)}}</span></div><template #footer><div class="row" style="justify-content:flex-end"><NButton @click="pendingOpen=false">取消</NButton><NButton type="primary" :loading="busy.pendingSave" :disabled="!pendingPick.length" @click="carryPending">带入 {{pendingPick.length}} 项</NButton></div></template></NModal>
  </div>
</template>
<style scoped>
.date-text{border:0;background:none;padding:4px 0;color:var(--ink-3);font:inherit;font-size:17px;cursor:pointer}.date-text:hover{color:var(--ink)}.timer-controls{gap:10px}

.today-page{max-width:1660px}.today-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,1fr);gap:20px;align-items:start}.timeline-column{min-width:0}.side-column{grid-column:2}.main-column,.side-column{min-width:0}.main-column>.card:first-child,.side-column>.card:first-child{margin-top:0}.date-input{border:1px solid var(--line);background:var(--paper,var(--card));border-radius:8px;padding:7px 10px;color:var(--ink);font:inherit;max-width:160px}.day-heading{flex-wrap:wrap}.plan-card.over{background:var(--honey-mist);box-shadow:0 0 0 2px var(--honey)}.plan-title{align-items:center;flex-wrap:wrap}.plan-title>div:first-child{flex:1}.plan-title h3{margin:0}.plan-title h3 span{margin-left:6px}.drop-empty{border:1px dashed var(--line);border-radius:12px;padding:24px 16px;text-align:center;color:var(--ink-3);font-size:13px}.sub-title{margin-top:16px;color:var(--ink-3);font-size:12px}.add-task{margin-top:20px;padding:14px;background:var(--surface-warm);border-radius:10px}.task-options{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;margin-top:8px}.task-options>:first-child{flex:1;min-width:0}.task-details{margin-top:10px}.task-details summary{cursor:pointer}.task-details .row{margin-top:8px}.pending-hint{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:10px}.timer-card{background:var(--charcoal);color:var(--text-on-dark);border-color:var(--charcoal);padding:24px}
.timer-card h3,.timer-card .hours{color:var(--text-on-dark)}
.timer-card .muted,.timer-card .session{color:var(--muted-on-dark)}
.timer-card .card-title,.timer-card .session{border-color:var(--timer-line)}
.timer-card a{color:var(--sand)}
.timer-card :deep(.n-progress){--n-rail-color:var(--timer-line)!important;--n-fill-color:var(--sand)!important}
.timer-card :deep(.n-button--primary-type),.timer-card :deep(.n-button--warning-type){--n-color:var(--sand)!important;--n-color-hover:var(--sand-hover)!important;--n-color-pressed:var(--sand-pressed)!important;--n-text-color:var(--ink)!important;--n-text-color-hover:var(--ink)!important;--n-text-color-pressed:var(--ink)!important;--n-border:1px solid var(--sand)!important;--n-border-hover:1px solid var(--sand-hover)!important;--n-border-pressed:1px solid var(--sand-pressed)!important}
.timer-card :deep(.n-button--disabled){--n-color-disabled:var(--timer-disabled-bg)!important;--n-text-color-disabled:var(--timer-disabled-ink)!important;--n-border-disabled:1px solid transparent!important;--n-opacity-disabled:1!important}
.plan-card{border-color:var(--line-card)}
.side-column>.submission-card{margin-top:20px}.timer-label{font-weight:500;overflow-wrap:anywhere}.timer-clock{font-size:38px;line-height:1.4;margin:7px 0 13px;color:var(--sand)}.timer-help{margin:12px 0 0}.hours{margin-top:24px}.hours .row{margin-bottom:8px}.session-details{margin-top:12px}.session-details summary{cursor:pointer}.session{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:6px 0;border-bottom:1px dashed var(--line-soft)}.secondary-section{background:transparent;box-shadow:none;border-color:var(--line-soft)}.secondary-section summary{cursor:pointer;font-size:14px;font-weight:500}.secondary-section[open] summary{margin-bottom:14px}.review-mood{margin:10px 0}.face{border:1px solid transparent;background:none;font-size:18px;border-radius:8px;padding:2px 4px;cursor:pointer;opacity:.5}.face.on{opacity:1;background:var(--honey-mist);border-color:var(--line)}.quick-links{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:12px;padding:0 4px}@media(max-width:1000px){.side-column>.submission-card{margin-top:16px}.today-layout{grid-template-columns:1fr;gap:14px}.main-column{grid-column:1;grid-row:1}.side-column{grid-column:1;grid-row:2;display:flex;flex-direction:column}.plan-title{gap:10px}.timer-card{order:0}.week-glance{order:1;margin-top:16px}.background-card{order:2}.submission-card{order:3}.quick-links{order:4}.task-options{flex-wrap:wrap}.task-options>:first-child{min-width:180px}.session{grid-template-columns:1fr;gap:2px}}
.side-column>.timer-card{margin-top:20px}
.period-block{border:1px solid var(--line-soft);border-radius:12px;padding:10px 12px 2px;margin-top:10px;transition:background .12s,box-shadow .12s}
.period-block.now{border-color:var(--today-line);background:var(--today-bg)}
.period-block.loose{border-style:dashed}
.period-block.over,.plan-card.over{background:var(--honey-mist);box-shadow:0 0 0 2px var(--honey)}
.period-head{display:flex;align-items:baseline;gap:8px}.period-mark{font-size:16px;color:var(--accent-deep)}.period-name{font-size:13px;color:var(--ink-2)}.now-pill{align-self:center}
.period-events{display:flex;flex-wrap:wrap;gap:5px 8px;margin:7px 0 2px}
.period-event{font-size:12px;color:var(--ink-2);padding:2px 8px;border-radius:6px;background:var(--surface-soft);border-left:3px solid var(--line);overflow-wrap:anywhere}
.period-event.meeting{border-left-color:var(--accent)}.period-event.course{border-left-color:var(--sand-deep);background:var(--surface-sand)}.period-event.break{border-left-color:var(--ev-break-accent);background:var(--ev-break-bg)}.period-event.checkin{border-left-color:var(--charcoal);background:var(--ev-checkin-bg)}.period-event.other{border-left-color:var(--ev-other-accent)}
.period-event .ev-time{font-size:11px;color:var(--ink-3);font-variant-numeric:tabular-nums;margin-right:2px}
.period-empty{color:var(--ink-3);padding:8px 2px 12px}
.period-block :deep(.task){padding:12px 0}
.timeline-fold summary{cursor:pointer;font-size:14px;font-weight:500}.timeline-fold summary .small{font-weight:400;margin-left:6px}.timeline-fold[open] summary{margin-bottom:14px}
.task-options{flex-wrap:wrap}
@media(max-width:1000px){.side-column>.timer-card{margin-top:0}}
</style>
