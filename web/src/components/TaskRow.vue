<script setup>
import { computed, ref } from 'vue';
import { NCheckbox, NButton, NDropdown } from 'naive-ui';
import PaperTaskLink from './PaperTaskLink.vue';
import { isRunning, startTimer, stopTimer } from '../lib/timer';
import { fmtMin } from '../lib/format';
import { TASK_DRAG_TYPE } from '../lib/day-timeline';
import { PERIODS } from '../lib/periods';
const props = defineProps({ task: { type:Object, required:true }, readonly:Boolean, busy:Boolean, schedulable:Boolean, periods:Boolean });
const emit = defineEmits(['toggle','edit','carry','drop','remove','background','schedule','period']);
const timerBusy = ref(false);
const running = computed(() => isRunning({task_id:props.task.id}));
const globallyDone = computed(() => props.task.goal_task_status === 'done');
const done = computed(() => props.task.status === 'done' || globallyDone.value);
const inactive = computed(() => ['dropped','moved'].includes(props.task.status));
const completedElsewhere = computed(() => globallyDone.value && props.task.status !== 'done');
const papers = computed(() => props.task.papers?.length ? props.task.papers : props.task.paper_id ? [{id:props.task.paper_id,title:props.task.paper_title || `论文 #${props.task.paper_id}`}] : []);
const menu = computed(() => [
  {label:'编辑',key:'edit'},
  ...(props.periods?[...PERIODS.map(p=>({label:`移到${p.label}`,key:'period:'+p.key,disabled:inactive.value||done.value||props.task.period===p.key})),{label:'移到未定时段',key:'period:',disabled:inactive.value||done.value||!props.task.period},{type:'divider',key:'divider-period'}]:[]),
  ...(props.schedulable?[{label:'安排到具体几点',key:'schedule',disabled:inactive.value||done.value}]:[]),
  {label:'作为后台任务计时',key:'background'},
  {label: props.task.goal_task_id ? '也安排到明天' : '顺延到明天',key:'carry',disabled:props.task.status!=='todo'||globallyDone.value},
  {label:props.task.status==='dropped' ? '恢复安排' : '取消这天的安排',key:'drop',disabled:globallyDone.value},
  {type:'divider',key:'divider'},
  {label:'删除这条日任务',key:'remove'},
]);
function dragTask(e){e.dataTransfer.setData(TASK_DRAG_TYPE,String(props.task.id));e.dataTransfer.setData('text/plain',JSON.stringify({task_id:props.task.id}));e.dataTransfer.effectAllowed='copyMove';}
function select(key){if(key.startsWith('period:'))emit('period',props.task,key.slice(7)||null);else emit(key,props.task);}
async function toggleTimer() { if(timerBusy.value || props.busy || props.readonly || (!running.value && (done.value || inactive.value))) return; timerBusy.value=true; try {if(running.value) await stopTimer(); else await startTimer({task_id:props.task.id});}finally {timerBusy.value=false;} }
</script>
<template>
  <div class="task" :class="{done,inactive:inactive && !done,running}" :data-task-id="task.id" :data-testid="`day-task-${task.id}`">
    <NCheckbox :data-testid="`complete-task-${task.id}`" :checked="done" :disabled="inactive || readonly || busy || completedElsewhere" size="large" :aria-label="`完成 ${task.title}`" @update:checked="emit('toggle',task)" />
    <div class="body grow">
      <button class="title" :disabled="readonly || busy" @click="emit('edit',task)">{{ task.title }}</button>
      <div class="meta">
        <span v-if="completedElsewhere" class="pill leaf">已在其他安排中完成</span>
        <span v-else-if="task.status==='moved'" class="pill eeyore">已顺延</span>
        <span v-else-if="task.status==='dropped'" class="pill berry">已取消</span>
        <span v-if="task.planned===0" class="pill tigger" title="确认日计划后临时加入，不计入完成率">临时</span>
        <span v-if="task.points>1" class="pill">{{ task.points }} 点</span>
        <span v-if="task.goal_title" class="pill leaf" :title="'周计划：'+task.goal_title">{{ task.goal_title }}</span>
        <span v-if="task.project_name" class="pill eeyore">{{ task.project_name }}</span>
        <RouterLink v-if="task.idea_title" :to="`/ideas/${task.idea_id}`" class="pill piglet">💡 {{ task.idea_title }}</RouterLink>
        <span v-if="task.criteria" class="muted small">{{ task.criteria }}</span>
      </div>
    </div>
    <div class="task-actions"><span v-if="task.minutes" class="mins muted small">{{ fmtMin(task.minutes) }}</span>
      <button v-if="schedulable&&!readonly&&!inactive&&!done" class="task-time-handle" draggable="true" :disabled="busy" :aria-label="`安排时间：${task.title}`" title="拖到其他时段或时间轴；点击排到具体几点" @dragstart="dragTask" @click="emit('schedule',task)">⠿</button>
      <NButton v-if="!readonly && (running || (task.status==='todo' && !globallyDone))" circle size="small" :loading="timerBusy" :disabled="busy" :type="running ? 'warning' : 'primary'" :secondary="!running" :title="running ? '停止计时' : '开始计时'" :aria-label="running ? '停止计时' : `开始计时：${task.title}`" @click="toggleTimer">{{ running ? '⏸' : '▶' }}</NButton>
      <NDropdown v-if="!readonly" :options="menu" trigger="click" :disabled="busy" @select="select"><NButton quaternary circle size="small" :disabled="busy" aria-label="任务操作">⋯</NButton></NDropdown>
    </div>
    <div v-if="papers.length" class="task-papers">
      <PaperTaskLink v-for="p in papers" :key="p.id" :paper="p" />
    </div>
  </div>
</template>
<style scoped>
.task-time-handle{border:0;background:transparent;color:var(--ink-3);font-size:20px;padding:2px;line-height:24px;cursor:grab}.task-time-handle:hover{color:var(--accent-deep)}.task-time-handle:focus-visible{outline:2px solid var(--accent);border-radius:4px}
.task { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:start; gap:0 12px; padding:18px 0; border-bottom:1px solid var(--line-soft); }.task:last-child {border-bottom:0}.task.running {background:var(--honey-mist);border-left:3px solid var(--accent);padding-left:12px;padding-right:10px;border-radius:10px}.title {border:0;background:none;padding:0;text-align:left;color:var(--ink);font:inherit;cursor:pointer;font-size:15px;font-weight:500;line-height:1.6;overflow-wrap:anywhere}.done .title {text-decoration:line-through;color:var(--ink-3)}.inactive {opacity:.6}.meta {display:flex;flex-wrap:wrap;gap:4px 6px;margin-top:7px}.meta:empty{display:none}.task-papers{grid-column:2 / -1;display:grid;gap:5px;margin-top:10px;padding:6px;background:var(--surface-soft);border-radius:9px}.task>:first-child{margin-top:3px}.task-actions {display:flex;align-items:center;gap:4px;padding-top:1px}.mins {white-space:nowrap}.body {min-width:0}@media(max-width:640px){.task {column-gap:7px}.task-actions{flex-wrap:wrap;justify-content:flex-end;max-width:72px}.mins{font-size:11px;flex-basis:100%;text-align:right}}
</style>
