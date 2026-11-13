<script setup>
import SubmissionCountdown from '../components/SubmissionCountdown.vue';
import { computed,reactive,ref,watch } from 'vue';
import { useRoute } from 'vue-router';
import { NButton,NInput,NInputNumber,NSelect,NSlider,NPopconfirm,NModal,NProgress } from 'naive-ui';
import { api } from '../lib/api';
import { store,changed } from '../lib/store';
import { fail,toast,confirm } from '../lib/ui';
import { STATUS,addDays,fmtDate,fmtMin,isoWeek,weekStart } from '../lib/format';
import ScoreCard from '../components/ScoreCard.vue';
import ItemPicker from '../components/ItemPicker.vue';
import GoalTaskList from '../components/GoalTaskList.vue';
import TaskEditModal from '../components/TaskEditModal.vue';
import WeekBoardDay from '../components/WeekBoardDay.vue';
import { PERIODS, PERIOD_LABEL, currentPeriod } from '../lib/periods';
import ScheduleEventEditor from '../components/ScheduleEventEditor.vue';
const route=useRoute();
const monday=ref(weekStart(/^\d{4}-\d{2}-\d{2}$/.test(route.query.date || '')?route.query.date:store.today));
const w=ref(null),loading=ref(false),error=ref(''),editGoal=ref(null),editingTask=ref(null);
const busy=reactive({});
const calendar=ref(null), calendarLoading=ref(false), calendarError=ref('');
const eventOpen=ref(false), selectedEvent=ref(null), eventDate=ref(store.today);
let calendarSeq=0;
async function loadCalendar(){
  const seq=++calendarSeq;calendarLoading.value=true;calendarError.value='';calendar.value=null;
  try{const data=await api.get(`/calendar?from=${monday.value}&to=${addDays(monday.value,6)}`);if(seq===calendarSeq)calendar.value=data;}
  catch(e){if(seq===calendarSeq)calendarError.value=e.message;}
  finally{if(seq===calendarSeq)calendarLoading.value=false;}
}
watch([monday,()=>store.version],loadCalendar,{immediate:true});
const eventsOn=date=>(calendar.value?.events||[]).filter(e=>e.date===date);
function openEvent(date,event=null){eventDate.value=date;selectedEvent.value=event;eventOpen.value=true;}

const form=reactive({focus:'',target_hours:null,review:'',conclusions:'',ruled_out:'',open_questions:''});
const newGoal=reactive({title:'',project_id:null,weight:1,due_date:'',criteria:''});
let loadSeq=0;
async function load(){const seq=++loadSeq;loading.value=true;error.value='';try{const data=await api.get(`/week/${monday.value}`);if(seq!==loadSeq)return;w.value=data;const wk=data.week||{};Object.assign(form,{focus:wk.focus||'',target_hours:wk.target_minutes!=null?wk.target_minutes/60:null,review:wk.review||'',conclusions:wk.conclusions||'',ruled_out:wk.ruled_out||'',open_questions:wk.open_questions||''});}catch(e){if(seq===loadSeq){error.value=e.message;fail(e);}}finally{if(seq===loadSeq)loading.value=false;}}
watch(monday,load);watch(()=>store.version,load);watch(()=>route.query.date,v=>{if(/^\d{4}-\d{2}-\d{2}$/.test(v||''))monday.value=weekStart(v);});load();
const isThisWeek=computed(()=>monday.value===weekStart(store.today));
const childTasks=g=>(w.value?.goal_tasks||[]).filter(t=>t.goal_id===g.id);
const progress=g=>{const ts=childTasks(g);return ts.length?Math.round(ts.filter(t=>t.status==='done').length/ts.length*100):g.status==='done'?100:g.progress||0;};
const dayTasks=date=>(w.value?.tasks||[]).filter(t=>t.date===date);
async function run(key,fn){if(busy[key])return false;busy[key]=true;try{await fn();return true;}catch(e){fail(e);return false;}finally{busy[key]=false;}}
async function saveWeek(fields){await run('week',async()=>{const b={};for(const k of fields)b[k]=form[k];if(fields.includes('target_hours')){delete b.target_hours;b.target_minutes=form.target_hours!=null?Math.round(form.target_hours*60):null;}await api.put(`/week/${monday.value}`,b);toast('已保存');});}
async function addGoal(){if(!newGoal.title.trim())return;await run('add',async()=>{await api.post('/goals',{...newGoal,title:newGoal.title.trim(),week_id:monday.value,due_date:newGoal.due_date||null});Object.assign(newGoal,{title:'',project_id:null,weight:1,due_date:'',criteria:''});changed();});}
async function patchGoal(g,b){return run(`goal-${g.id}`,async()=>{await api.patch(`/goals/${g.id}`,b);changed();});}
async function delGoal(g){await run(`goal-${g.id}`,async()=>{await api.del(`/goals/${g.id}`);changed();});}
async function carryGoals(){await run('carry',async()=>{const r=await api.post('/goals/carry',{to_week:monday.value});toast(r.created.length?`已带入 ${r.created.length} 个未完成计划`:'上周没有未完成计划');changed();});}
async function saveEdit(){const g=editGoal.value;if(!g?.title.trim())return;const ok=await patchGoal(g,{title:g.title.trim(),criteria:g.criteria,weight:g.weight,project_id:g.project_id,due_date:g.due_date||null,note:g.note});if(ok)editGoal.value=null;}
const where=(date,period)=>`${fmtDate(date)} · ${period?PERIOD_LABEL[period]:'未定时段'}`;
// 排期板放下：周子任务 → 安排到这一天这一段；日任务 → 换天 / 换时段
async function place({kind,id,date,period}){
  if(kind==='goal-task')return run(`schedule-${id}-${date}`,async()=>{await api.post(`/goal-tasks/${id}/schedule`,{date,period,planned:true});toast(`已安排到 ${where(date,period)}`);changed();});
  const t=(w.value?.tasks||[]).find(x=>x.id===id);
  if(t && t.date===date && (t.period||null)===period)return;
  return run(`task-${id}`,async()=>{await api.post(`/tasks/${id}/move`,{date,period});toast(`已移到 ${where(date,period)}`);changed();});
}
async function setPeriod(t,period){await place({kind:'task',id:t.id,date:t.date,period});}
const poolPeriod=computed(()=>isThisWeek.value?currentPeriod(store.timezone):'morning');
async function toggleTask(t){await run(`task-${t.id}`,async()=>{await api.patch(`/tasks/${t.id}`,{status:t.status==='done'?'todo':'done'});changed();});}
async function carryTask(t){await run(`task-${t.id}`,async()=>{if(t.goal_task_id)await api.post(`/goal-tasks/${t.goal_task_id}/schedule`,{date:addDays(t.date,1),planned:true});else await api.post('/tasks/carry',{ids:[t.id],to:addDays(t.date,1)});toast('已安排到下一天');changed();});}
async function dropTask(t){await run(`task-${t.id}`,async()=>{await api.patch(`/tasks/${t.id}`,{status:t.status==='dropped'?'todo':'dropped'});changed();});}
async function removeTask(t){if(!(await confirm('删除日任务？',`「${t.title}」已有的计时记录会保留。`,'删除')))return;await run(`task-${t.id}`,async()=>{await api.del(`/tasks/${t.id}`);changed();});}
</script>
<template>
  <div class="page">
    <div class="page-head"><NButton quaternary @click="monday=addDays(monday,-7)">‹ 上周</NButton><h1>周计划</h1><span class="muted">{{ fmtDate(monday,false) }} – {{ fmtDate(addDays(monday,6),false) }}</span><NButton quaternary @click="monday=addDays(monday,7)">下周 ›</NButton><NButton v-if="!isThisWeek" size="small" secondary @click="monday=weekStart(store.today)">本周</NButton></div>
    <div v-if="error" class="card row"><span>{{ error }}</span><NButton size="small" @click="load">重试</NButton></div>
    <template v-if="w">
      <SubmissionCountdown compact />
      <div class="board-layout">
        <aside class="pool-column" data-testid="task-pool">
          <div class="card pool-card">
            <div class="card-title"><h3>本周大计划</h3><NButton size="tiny" quaternary :loading="busy.carry" @click="carryGoals">带入上周</NButton></div>
            <NInput v-model:value="form.focus" size="small" placeholder="本周主题（可选）" @blur="saveWeek(['focus'])" />
            <p class="small muted pool-hint">把小任务拖到右边某一天的上午 / 下午 / 晚上；也可以点「安排」。</p>
            <p v-if="!w.goals.length" class="muted small">先写下一件这周想推进的大事。</p>
            <article v-for="g in w.goals" :key="g.id" class="weekly-goal" :class="{dropped:g.status==='dropped'}" :data-testid="`pool-goal-${g.id}`">
              <div class="goal-head"><h3 class="goal-name">{{ g.title }}</h3><span class="small muted goal-count">{{ childTasks(g).length ? `${childTasks(g).filter(t=>t.status==='done').length}/${childTasks(g).length}` : `${progress(g)}%` }}</span><NButton size="tiny" quaternary :disabled="busy[`goal-${g.id}`]" @click="editGoal={...g}">编辑</NButton></div>
              <div class="goal-bar" aria-hidden="true"><span :style="{width:progress(g)+'%'}" /></div>
              <div v-if="g.criteria || g.project_name || g.due_date" class="small muted criteria">{{ [g.criteria, g.project_name, g.due_date ? '截止 ' + fmtDate(g.due_date,false) : ''].filter(Boolean).join(' · ') }}</div>
              <GoalTaskList :goal="g" :tasks="w.goal_tasks || []" :date="isThisWeek?store.today:monday" :default-period="poolPeriod" compact />
              <details v-if="!childTasks(g).length" class="manual-progress"><summary class="small muted">手动记录进度</summary><NSlider v-model:value="g.progress" :step="10" :disabled="busy[`goal-${g.id}`]" @dragend="patchGoal(g,{progress:g.progress})"/><NButton size="tiny" secondary @click="patchGoal(g,{status:g.status==='done'?'open':'done'})">{{ g.status==='done'?'重新打开':'标为完成' }}</NButton></details>
            </article>
            <div class="new-goal"><NInput v-model:value="newGoal.title" size="small" placeholder="＋ 新的大计划" :disabled="busy.add"/><div class="row" style="margin-top:8px"><NInput v-model:value="newGoal.criteria" size="small" placeholder="完成标准（可选）" class="grow"/><NButton type="primary" size="small" :loading="busy.add" :disabled="!newGoal.title.trim()" @click="addGoal">添加计划</NButton></div></div>
          </div>
        </aside>
        <section class="board-column">
          <div class="board-heading"><div><h3>七天安排</h3><span class="small muted">课程和会议按开始时间放进上午 / 下午 / 晚上；任务可以在格子之间拖动，换天或换时段。</span></div><span class="small muted">{{ isoWeek(monday) }}</span></div>
          <div class="plan-board card" data-testid="plan-board">
            <div class="board-head-row" aria-hidden="true"><span></span><span v-for="p in PERIODS" :key="p.key"><b>{{ p.label }}</b><small>{{ p.range }}</small></span></div>
            <WeekBoardDay v-for="dd in w.days" :key="dd.date" :date="dd.date" :kind="dd.kind" :today="dd.date===store.today" :events="eventsOn(dd.date)" :tasks="dayTasks(dd.date)" :minutes="dd.minutes" :loading="calendarLoading" :error="calendarError" :busy="busy"
              @place="place" @toggle="toggleTask" @edit="editingTask=$event" @period="setPeriod" @carry="carryTask" @drop="dropTask" @remove="removeTask" @add-event="openEvent(dd.date)" @edit-event="ev=>openEvent(dd.date,ev)" @retry="loadCalendar" />
          </div>
          <details class="card secondary-section"><summary>本周执行与工时</summary><ScoreCard :score="w.score" title="本周执行" :due-by-today="w.score.dueByToday"/><p class="small">已记录 {{ fmtMin(w.minutes) }} · 本周计划 {{ fmtMin(w.targetMinutes) }}</p><NInputNumber v-model:value="form.target_hours" :min="0" placeholder="计划小时数" @blur="saveWeek(['target_hours'])"><template #suffix>小时</template></NInputNumber></details>
          <details class="card secondary-section"><summary>周复盘</summary><div class="review"><label>得到的结论</label><NInput v-model:value="form.conclusions" type="textarea" :autosize="{minRows:2}"/><label>排除的路线</label><NInput v-model:value="form.ruled_out" type="textarea" :autosize="{minRows:2}"/><label>仍未解决</label><NInput v-model:value="form.open_questions" type="textarea" :autosize="{minRows:2}"/><label>其他</label><NInput v-model:value="form.review" type="textarea" :autosize="{minRows:2}"/></div><NButton size="small" type="primary" :loading="busy.week" @click="saveWeek(['review','conclusions','ruled_out','open_questions'])">保存复盘</NButton></details>
        </section>
      </div>
    </template><div v-else-if="loading" class="empty">加载中…</div>
    <NModal :show="!!editGoal" preset="card" title="编辑周计划" style="width:min(560px,95vw)" @update:show="v=>!v && (editGoal=null)"><div v-if="editGoal" class="review"><label>计划</label><NInput v-model:value="editGoal.title"/><label>完成标准</label><NInput v-model:value="editGoal.criteria" type="textarea" :autosize="{minRows:1}"/><label>项目</label><ItemPicker v-model="editGoal.project_id" type="project"/><label>权重</label><NSelect v-model:value="editGoal.weight" :options="[1,2,3,4,5].map(value=>({label:String(value),value}))"/><label>截止日</label><input v-model="editGoal.due_date" type="date"/><label>备注</label><NInput v-model:value="editGoal.note" type="textarea" :autosize="{minRows:1}"/></div><template #footer><div class="row"><NPopconfirm @positive-click="delGoal(editGoal);editGoal=null"><template #trigger><NButton type="error" quaternary size="small">删除计划</NButton></template>删除这个周计划？已有日任务和计时记录会保留。</NPopconfirm><span class="grow"/><NButton @click="editGoal=null">取消</NButton><NButton type="primary" :loading="editGoal && busy[`goal-${editGoal.id}`]" :disabled="!editGoal?.title?.trim()" @click="saveEdit">保存</NButton></div></template></NModal>
    <ScheduleEventEditor v-model:show="eventOpen" :event="selectedEvent" :date="eventDate" />
    <TaskEditModal :task="editingTask" :goals="w?.goals || []" @close="editingTask=null" @saved="editingTask=null;changed()"/>
  </div>
</template>
<style scoped>
.board-layout{display:grid;grid-template-columns:minmax(250px,300px) minmax(0,1fr);gap:18px;align-items:start}
.pool-column{position:sticky;top:12px;max-height:calc(100dvh - 24px);overflow-y:auto;overscroll-behavior:contain;min-width:0;border-radius:14px}
.pool-card{margin:0;padding:18px 16px}.pool-hint{margin:8px 0 2px;line-height:1.6}
.weekly-goal{padding:12px 0;border-bottom:1px solid var(--line-soft)}.weekly-goal:last-of-type{border-bottom:0}.weekly-goal.dropped{opacity:.6}
.goal-head{display:flex;align-items:baseline;gap:6px}.goal-name{flex:1;min-width:0;font-size:14px;line-height:1.5;margin:0;overflow-wrap:anywhere}.goal-count{white-space:nowrap;font-variant-numeric:tabular-nums}
.goal-bar{height:3px;border-radius:3px;background:var(--line-soft);margin:6px 0 2px;overflow:hidden}.goal-bar span{display:block;height:100%;background:var(--accent);border-radius:3px}
.criteria{margin-top:4px;overflow-wrap:anywhere}.manual-progress{margin-top:8px}.new-goal{margin-top:14px}
.board-column{min-width:0}
.board-heading{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:10px}.board-heading h3{margin:0 0 4px}
.plan-board{padding:0;overflow:hidden;--board-date-col:150px}
.board-head-row{display:grid;grid-template-columns:var(--board-date-col) repeat(3,minmax(0,1fr));background:var(--surface-soft);font-size:12px;color:var(--ink-2)}
.board-head-row span{padding:9px 8px}.board-head-row span+span{border-left:1px dashed var(--line-soft)}.board-head-row b{font-size:14px;color:var(--ink);margin-right:3px}.board-head-row small{color:var(--ink-3);margin-left:4px;font-size:11px}
.secondary-section summary{cursor:pointer;font-size:14px;font-weight:500}.secondary-section[open] summary{margin-bottom:14px}.review{display:grid;grid-template-columns:90px minmax(0,1fr);gap:10px;margin:10px 0}.review label{font-size:13px;color:var(--ink-2);padding-top:5px}.review input{min-width:0;border:1px solid var(--line);border-radius:7px;padding:7px;font:inherit;background:white;color:var(--ink)}
@media(max-width:1280px){.plan-board{--board-date-col:120px}.board-layout{grid-template-columns:minmax(230px,260px) minmax(0,1fr);gap:14px}}
@media(max-width:900px){.board-layout{grid-template-columns:minmax(0,1fr)}.pool-column{position:static;max-height:none;overflow:visible}}
@media(max-width:760px){.plan-board{background:transparent;border:0;box-shadow:none;overflow:visible}.board-head-row{display:none}.board-heading{flex-wrap:wrap}.review{grid-template-columns:1fr}}
</style>
