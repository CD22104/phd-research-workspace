<script setup>
import { computed, reactive, ref } from 'vue';
import { NButton, NCheckbox, NInput, NModal, NPopconfirm, NRadioButton, NRadioGroup, NSelect } from 'naive-ui';
import PaperTaskLink from './PaperTaskLink.vue';
import PaperSchedulePicker from './PaperSchedulePicker.vue';
import ScheduleDateContext from './ScheduleDateContext.vue';
import { api } from '../lib/api';
import { changed, store } from '../lib/store';
import { fail, toast } from '../lib/ui';
import { fmtDate } from '../lib/format';
import { GOAL_TASK_DRAG_TYPE, PERIODS, PERIOD_LABEL } from '../lib/periods';
const props = defineProps({ goal: { type: Object, required:true }, tasks: { type:Array, default:()=>[] }, date: { type:String, default:'' }, compact:Boolean, defaultPeriod: { type:String, default:'morning' } });
const rows = computed(() => props.tasks.filter(t => t.goal_id === props.goal.id));
// 任务池（compact）：没做完的放上面，做完的收进「已完成 N 项」
const openRows = computed(() => props.compact ? rows.value.filter(t => t.status !== 'done') : rows.value);
const doneRows = computed(() => props.compact ? rows.value.filter(t => t.status === 'done') : []);
const WD = ['日','一','二','三','四','五','六'];
const shortDay = d => `周${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]}`;
const where = t => (t.scheduled || t.scheduled_dates?.map(date => ({date})) || []).map(x => `${props.compact ? shortDay(x.date) : fmtDate(x.date,false)}${x.period ? '·' + PERIOD_LABEL[x.period] : ''}`).join('、');
const PERIOD_OPTIONS = [...PERIODS.map(p => ({ value:p.key, label:p.label })), { value:'none', label:'未定' }];
const newTitle = ref(''), newPapers = ref([]), newPaperRows = ref([]), adding = ref(false), busy = reactive({}), dates = reactive({}), editing = ref(null), saving = ref(false);
const planRemoved = computed(() => !!editing.value?.plan_id && editing.value.plan_paper_id != null && !(editing.value.paper_ids || []).includes(Number(editing.value.plan_paper_id)));
const POINTS = [1,2,3,5].map(value => ({label:`${value} 点`,value}));
const scheduling = ref(null), periods = reactive({});
const targetDate = t => dates[t.id] ?? (props.date || store.today);
const targetPeriod = t => periods[t.id] ?? props.defaultPeriod ?? 'none';
function choosePapers(papers) { newPaperRows.value = papers; if (!newTitle.value.trim() && papers.length) newTitle.value = papers.length === 1 ? `阅读：${papers[0].short_name || papers[0].title}` : `阅读选中的 ${papers.length} 篇论文`; }
async function add() {
  if (adding.value || !newTitle.value.trim()) return;
  adding.value = true;
  try { await api.post('/goal-tasks', {goal_id:props.goal.id, title:newTitle.value.trim(), paper_ids:newPapers.value}); newTitle.value = ''; newPapers.value = []; newPaperRows.value = []; changed(); }
  catch(e) { fail(e); } finally { adding.value = false; }
}
async function toggle(t) {
  if (busy[t.id]) return; busy[t.id] = true;
  try { await api.patch(`/goal-tasks/${t.id}`, {status:t.status === 'done' ? 'todo' : 'done'}); changed(); }
  catch(e) { fail(e); } finally { busy[t.id] = false; }
}
async function schedule(t) {
  if (busy[t.id] || t.status === 'done' || !targetDate(t)) return; busy[t.id] = true;
  const period = targetPeriod(t) === 'none' ? null : targetPeriod(t);
  try { await api.post(`/goal-tasks/${t.id}/schedule`, {date:targetDate(t),period,planned:true}); toast(`已安排到 ${fmtDate(targetDate(t))}${period ? ' · ' + PERIOD_LABEL[period] : ''}`); scheduling.value = null; changed(); }
  catch(e) { fail(e); } finally { busy[t.id] = false; }
}
function drag(e,t) { if(t.status==='done'||busy[t.id]) { e.preventDefault(); return; } e.dataTransfer.effectAllowed='copy'; e.dataTransfer.setData(GOAL_TASK_DRAG_TYPE, String(t.id)); e.dataTransfer.setData('text/plain', JSON.stringify({goal_task_id:t.id})); }
function edit(t) { editing.value = {...t,paper_ids:[...(t.paper_ids || [])]}; }
async function save() { if(saving.value || !editing.value?.title.trim()) return; saving.value=true; try { const t=editing.value; await api.patch(`/goal-tasks/${t.id}`, {title:t.title.trim(),points:t.points,paper_ids:t.paper_ids,...(planRemoved.value ? {plan_id:null} : {})}); editing.value=null; changed(); } catch(e){fail(e);} finally {saving.value=false;} }
async function remove(t) { if(busy[t.id])return; busy[t.id]=true; try {await api.del(`/goal-tasks/${t.id}`); changed();}catch(e){fail(e);}finally{busy[t.id]=false;} }
</script>
<template>
  <div class="goal-tasks" :class="{ compact }">
    <div v-for="t in openRows" :key="t.id" :data-testid="`goal-task-${t.id}`" class="goal-task" :class="{ done:t.status==='done' }" :draggable="t.status!=='done' && !busy[t.id]" @dragstart="e => drag(e,t)">
      <div class="task-top">
        <span class="drag-handle" :title="t.status==='done' ? '已完成' : '拖到某一天的上午 / 下午 / 晚上'" aria-hidden="true">⠿</span>
        <NCheckbox :checked="t.status==='done'" :disabled="busy[t.id]" :aria-label="`完成 ${t.title}`" @update:checked="toggle(t)" />
        <button class="task-title" @click="edit(t)">{{ t.title }}</button>
        <NButton size="tiny" secondary :disabled="t.status==='done' || busy[t.id]" @click="scheduling=t">安排</NButton>
      </div>
      <div v-if="t.papers?.length" class="task-papers"><PaperTaskLink v-for="p in t.papers" :key="p.id" :paper="p" /></div>
      <div class="small muted task-dates" v-if="t.scheduled_dates?.length">{{ t.status==='done' ? '已完成 · ' : '已安排 · ' }}{{ where(t) }}</div>
      <div v-else-if="t.status==='done'" class="small muted task-dates">已完成</div>
    </div>
    <details v-if="doneRows.length" class="done-fold"><summary class="small muted">已完成 {{ doneRows.length }} 项</summary>
      <div v-for="t in doneRows" :key="t.id" :data-testid="`goal-task-${t.id}`" class="goal-task done">
        <div class="task-top"><span class="drag-handle" aria-hidden="true"></span><NCheckbox :checked="true" :disabled="busy[t.id]" :aria-label="`恢复未完成 ${t.title}`" @update:checked="toggle(t)" /><button class="task-title" @click="edit(t)">{{ t.title }}</button></div>
        <div v-if="t.scheduled_dates?.length" class="small muted task-dates">{{ where(t) }}</div>
      </div>
    </details>
    <div class="add-subtask">
      <NInput v-model:value="newTitle" size="small" placeholder="＋ 添加小任务" :data-testid="`new-goal-task-${goal.id}`" :disabled="adding" />
      <div v-if="!compact || newTitle.trim() || newPapers.length" class="add-tools"><PaperSchedulePicker v-model="newPapers" :papers="newPaperRows" :disabled="adding" label="关联论文" @selected="choosePapers" /><NButton size="small" type="primary" :loading="adding" :disabled="!newTitle.trim()" @click="add">添加</NButton></div>
    </div>
  </div>
  <NModal :show="!!scheduling" preset="card" title="安排日任务" style="width:min(440px,95vw)" :mask-closable="!busy[scheduling?.id]" :close-on-esc="!busy[scheduling?.id]" @update:show="v => !v && !busy[scheduling?.id] && (scheduling=null)">
    <div v-if="scheduling" class="schedule-pop" data-testid="goal-task-schedule">
      <p class="schedule-task-name">{{ scheduling.title }}</p>
      <label class="small">安排日期<input type="date" :value="targetDate(scheduling)" :disabled="busy[scheduling.id]" @input="dates[scheduling.id]=$event.target.value" /></label>
      <div class="small period-pick"><span>时段</span><NRadioGroup :value="targetPeriod(scheduling)" size="small" :disabled="busy[scheduling.id]" name="schedule-period" @update:value="v => periods[scheduling.id]=v"><NRadioButton v-for="o in PERIOD_OPTIONS" :key="o.value" :value="o.value" :label="o.label" :data-testid="`schedule-period-${o.value}`" /></NRadioGroup></div>
      <div class="schedule-agenda"><ScheduleDateContext :date="targetDate(scheduling)" /></div>
    </div>
    <template #footer><div v-if="scheduling" class="schedule-actions"><NButton :disabled="busy[scheduling.id]" @click="scheduling=null">取消</NButton><NButton type="primary" :loading="busy[scheduling.id]" :disabled="!targetDate(scheduling)" @click="schedule(scheduling)">加入日计划</NButton></div></template>
  </NModal>
  <NModal :show="!!editing" preset="card" title="编辑小任务" style="width:min(560px,95vw)" @update:show="v => !v && !saving && (editing=null)">
    <div v-if="editing" class="edit-task"><NInput v-model:value="editing.title" placeholder="小任务名称" /><NSelect v-model:value="editing.points" :options="POINTS" /><PaperSchedulePicker v-model="editing.paper_ids" :papers="editing.papers || []" />
      <p v-if="planRemoved" class="small muted">原论文已移除，保存时也会解除它的阅读计划关联。</p>
      <p class="small muted">这里更新周任务；已经安排的日任务保留当时的内容。</p>
      <NPopconfirm @positive-click="remove(editing); editing=null"><template #trigger><NButton size="small" quaternary type="error">删除小任务</NButton></template>删除小任务？已有计时记录会保留。</NPopconfirm>
    </div>
    <template #footer><div class="row" style="justify-content:flex-end"><NButton :disabled="saving" @click="editing=null">取消</NButton><NButton type="primary" :loading="saving" :disabled="!editing?.title?.trim()" @click="save">保存</NButton></div></template>
  </NModal>
</template>
<style scoped>
.goal-tasks { margin-top:9px; }.goal-task { padding:12px 0; }.goal-task[draggable=true] { cursor:grab; }.task-top { display:flex; gap:7px; align-items:center; }.drag-handle { color:var(--ink-3); font-size:18px; }.task-title { border:0; background:none; padding:0; text-align:left; flex:1; min-width:0; font:inherit; color:var(--ink); cursor:pointer; overflow-wrap:anywhere; }.done .task-title { text-decoration:line-through; color:var(--ink-3); }.task-papers { margin:10px 0 0 29px; display:grid; gap:5px; }.task-dates { margin:8px 0 0 29px; }.add-subtask { margin:24px 0 8px; padding:16px; background:var(--surface-warm); border-radius:12px; }.add-tools { display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:flex-start; margin-top:12px; }.add-tools > :first-child { flex:1; min-width:120px; }.schedule-pop { display:grid; gap:12px; min-width:0; }.schedule-task-name { margin:0; max-height:48px; overflow-y:auto; font-size:13px; line-height:1.7; overflow-wrap:anywhere; color:var(--ink-2); }.schedule-agenda { max-height:min(420px,calc(100dvh - 330px)); overflow-y:auto; min-height:80px; overscroll-behavior:contain; }.schedule-actions { display:flex; gap:10px; justify-content:flex-end; }.schedule-pop label { display:grid; gap:5px; }.schedule-pop input { border:1px solid var(--line); border-radius:7px; padding:7px; font:inherit; background:var(--card); color:var(--ink); }.edit-task { display:grid; gap:12px; }
.period-pick { display:grid; gap:5px; }
.compact .goal-task { padding:6px 0; }.compact .task-top { gap:6px; }.compact .drag-handle { font-size:15px; }.compact .task-title { font-size:13.5px; line-height:1.5; }.compact .task-dates { margin:3px 0 0 26px; font-size:11.5px; }.compact .task-papers { margin:6px 0 0 26px; }
.compact .add-subtask { margin:6px 0 2px; padding:0; background:none; }.compact .add-tools { margin-top:8px; gap:8px; }
.done-fold { margin-top:4px; }.done-fold summary { cursor:pointer; padding:4px 0; }.done-fold .goal-task { padding:4px 0; }
</style>
