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
import TaskRow from '../components/TaskRow.vue';
import TaskEditModal from '../components/TaskEditModal.vue';
import PlanningDayAgenda from '../components/PlanningDayAgenda.vue';
import ScheduleEventEditor from '../components/ScheduleEventEditor.vue';
const route=useRoute();
const monday=ref(weekStart(/^\d{4}-\d{2}-\d{2}$/.test(route.query.date || '')?route.query.date:store.today));
const w=ref(null),loading=ref(false),error=ref(''),editGoal=ref(null),editingTask=ref(null),dragOver=ref('');
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
function readDrag(e){const raw=e.dataTransfer.getData('application/x-honey-goal-task');if(raw)return Number(raw);try{return Number(JSON.parse(e.dataTransfer.getData('text/plain')).goal_task_id);}catch{return null;}}
async function scheduleDrop(e,date){e.preventDefault();dragOver.value='';const id=readDrag(e);if(!Number.isInteger(id)||id<1)return;await run(`schedule-${id}-${date}`,async()=>{await api.post(`/goal-tasks/${id}/schedule`,{date,planned:true});toast(`已安排到 ${fmtDate(date)}`);changed();});}
function acceptDrag(e,date){if([...e.dataTransfer.types].includes('application/x-honey-goal-task')){e.preventDefault();e.dataTransfer.dropEffect='copy';dragOver.value=date;}}
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
      <div class="week-layout">
        <section class="goal-column">
          <div class="card">
            <div class="card-title"><h3>本周大计划</h3><NButton size="tiny" quaternary :loading="busy.carry" @click="carryGoals">带入上周</NButton></div>
            <NInput v-model:value="form.focus" size="small" placeholder="本周主题（可选）" @blur="saveWeek(['focus'])" />
            <p class="small muted">在每个计划下列小任务，拖到右侧某一天；也可以点「安排」选择日期。</p>
            <p v-if="!w.goals.length" class="muted small">先写下一件这周想推进的大事。</p>
            <article v-for="g in w.goals" :key="g.id" class="weekly-goal" :class="{dropped:g.status==='dropped'}">
              <div class="row"><h3 class="grow goal-name">{{ g.title }}</h3><NButton size="tiny" quaternary :disabled="busy[`goal-${g.id}`]" @click="editGoal={...g}">编辑</NButton></div>
              <div v-if="g.criteria" class="small muted criteria">{{ g.criteria }}</div>
              <div class="progress-row"><NProgress type="line" :percentage="progress(g)" :height="6" :show-indicator="false"/><span class="small muted">{{ childTasks(g).length ? `${childTasks(g).filter(t=>t.status==='done').length}/${childTasks(g).length}` : `${progress(g)}%` }}</span></div>
              <div v-if="g.project_name || g.due_date" class="small muted">{{ g.project_name }}<span v-if="g.due_date"> · 截止 {{ fmtDate(g.due_date,false) }}</span></div>
              <GoalTaskList :goal="g" :tasks="w.goal_tasks || []" :date="isThisWeek?store.today:monday" />
              <details v-if="!childTasks(g).length" class="manual-progress"><summary class="small muted">手动记录进度</summary><NSlider v-model:value="g.progress" :step="10" :disabled="busy[`goal-${g.id}`]" @dragend="patchGoal(g,{progress:g.progress})"/><NButton size="tiny" secondary @click="patchGoal(g,{status:g.status==='done'?'open':'done'})">{{ g.status==='done'?'重新打开':'标为完成' }}</NButton></details>
            </article>
            <div class="new-goal"><NInput v-model:value="newGoal.title" placeholder="＋ 新的大计划" :disabled="busy.add"/><div class="row" style="margin-top:8px"><NInput v-model:value="newGoal.criteria" size="small" placeholder="完成标准（可选）" class="grow"/><NButton type="primary" size="small" :loading="busy.add" :disabled="!newGoal.title.trim()" @click="addGoal">添加计划</NButton></div></div>
          </div>
          <details class="card secondary-section"><summary>本周执行与工时</summary><ScoreCard :score="w.score" title="本周执行" :due-by-today="w.score.dueByToday"/><p class="small">已记录 {{ fmtMin(w.minutes) }} · 本周计划 {{ fmtMin(w.targetMinutes) }}</p><NInputNumber v-model:value="form.target_hours" :min="0" placeholder="计划小时数" @blur="saveWeek(['target_hours'])"><template #suffix>小时</template></NInputNumber></details>
        </section>
        <section class="days-column">
          <div class="board-heading"><div><h3>七天日计划</h3><span class="small muted">先看当天日程，再安排任务；未完成的小任务可以安排到多天。</span></div><span class="small muted">{{ isoWeek(monday) }}</span></div>
          <p class="agenda-hint small muted">日程占用时长已合并重叠时段，全天安排单列。未固定上下班时间，可结合这些安排判断当天余量。</p>
          <div class="days">
            <article v-for="dd in w.days" :key="dd.date" :data-testid="`day-drop-${dd.date}`" class="day card" :class="{today:dd.date===store.today,over:dragOver===dd.date}" @dragover="e=>acceptDrag(e,dd.date)" @dragleave.self="dragOver=''" @drop="e=>scheduleDrop(e,dd.date)">
              <div class="day-head"><RouterLink :to="{name:'today',query:{date:dd.date}}" class="day-title">{{ fmtDate(dd.date) }}<span v-if="dd.date===store.today" class="pill">今天</span></RouterLink><span class="small muted">{{ STATUS.dayKind[dd.kind] }}{{ dd.checkin?' · 已确认':'' }}</span></div>
              <PlanningDayAgenda :date="dd.date" :events="eventsOn(dd.date)" :kind="dd.kind" :loading="calendarLoading" :error="calendarError" interactive @retry="loadCalendar" @add="openEvent(dd.date)" @edit="event=>openEvent(dd.date,event)" />
              <div class="day-tasks"><TaskRow v-for="t in dayTasks(dd.date)" :key="t.id" :task="t" :busy="busy[`task-${t.id}`]" @toggle="toggleTask" @edit="editingTask=$event" @carry="carryTask" @drop="dropTask" @remove="removeTask"/><div v-if="!dayTasks(dd.date).length" class="day-empty">把左侧小任务拖到这里</div></div>
              <div class="day-foot"><RouterLink :to="{name:'today',query:{date:dd.date}}" class="small">＋ 添加日任务 / 阅读</RouterLink><span class="small muted">{{ fmtMin(dd.minutes) }}</span></div>
            </article>
          </div>
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
.agenda-hint{margin:0 0 14px;line-height:1.65}.week-layout{display:grid;grid-template-columns:minmax(300px,.8fr) minmax(0,1.5fr);gap:20px;align-items:start}.goal-column,.days-column{min-width:0}.goal-column>.card:first-child{margin-top:0}.weekly-goal{padding:18px 0;border-bottom:1px solid var(--line-soft)}.weekly-goal.dropped{opacity:.6}.goal-name{font-size:15px;line-height:1.5;margin:0;overflow-wrap:anywhere}.criteria{margin-top:5px}.progress-row{display:flex;gap:10px;align-items:center;margin:9px 0}.progress-row>:first-child{flex:1}.progress-row>span{white-space:nowrap}.manual-progress{margin-top:10px}.new-goal{margin-top:18px}.board-heading{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:12px}.board-heading h3{margin:0 0 5px}.days{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.day.card{min-width:0;margin:0;padding:18px;min-height:150px}.day.today{border-color:var(--today-line);background:var(--today-bg)}.day.over{background:var(--honey-mist);box-shadow:0 0 0 2px var(--honey)}.day-head,.day-foot{display:flex;align-items:center;justify-content:space-between;gap:7px;flex-wrap:wrap}.day-title{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--ink)}.day-empty{padding:24px 4px;color:var(--ink-3);font-size:12px;text-align:center;background:var(--surface-warm);border-radius:9px;margin:12px 0}.day-foot{padding-top:10px;margin-top:8px;border-top:1px solid var(--line-soft)}.secondary-section summary{cursor:pointer;font-size:14px;font-weight:500}.secondary-section[open] summary{margin-bottom:14px}.review{display:grid;grid-template-columns:90px minmax(0,1fr);gap:10px;margin:10px 0}.review label{font-size:13px;color:var(--ink-2);padding-top:5px}.review input{min-width:0;border:1px solid var(--line);border-radius:7px;padding:7px;font:inherit;background:white;color:var(--ink)}@media(min-width:1600px){.days{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:1000px){.week-layout{grid-template-columns:minmax(270px,.85fr) minmax(0,1fr)}.days{grid-template-columns:minmax(0,1fr)}}@media(max-width:760px){.week-layout{grid-template-columns:minmax(0,1fr)}.board-heading{flex-wrap:wrap}.review{grid-template-columns:1fr}.days{grid-template-columns:minmax(0,1fr)}}
</style>
