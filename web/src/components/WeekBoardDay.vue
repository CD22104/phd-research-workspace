<script setup>
// 周计划排期板的一行：左边是日期（日程摘要、全天安排、投稿节点、未定时段的任务），右边是上午 / 下午 / 晚上三格。
// 每一格都能放下：从任务池拖来的周子任务（安排到这一天这一段），或别的格子里的日任务（换天 / 换时段）。
import { computed, ref } from 'vue';
import { NButton } from 'naive-ui';
import ConferenceDayMarks from './ConferenceDayMarks.vue';
import PlanChip from './PlanChip.vue';
import { TASK_DRAG_TYPE } from '../lib/day-timeline';
import { PERIODS, acceptsPlanDrag, eventsByPeriod, readPlanDrag } from '../lib/periods';
import { scheduleLabels, summarizeSchedule } from '../lib/calendar-summary';
import { fmtDate, fmtMin } from '../lib/format';
const props = defineProps({
  date: { type: String, required: true }, kind: String, today: Boolean, events: { type: Array, default: () => [] }, tasks: { type: Array, default: () => [] },
  minutes: Number, loading: Boolean, error: String, busy: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['place', 'toggle', 'edit', 'period', 'carry', 'drop', 'remove', 'add-event', 'edit-event', 'retry']);
const over = ref('');
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const shortDate = computed(() => { const [, m, d] = props.date.split('-').map(Number); return `周${WD[new Date(`${props.date}T00:00:00Z`).getUTCDay()]} ${m}/${d}`; });
const grouped = computed(() => eventsByPeriod(props.events));
const summary = computed(() => summarizeSchedule(props.events));
const tasksIn = (period) => props.tasks.filter((t) => (t.period || null) === period);
const unassigned = computed(() => tasksIn(null));
const rest = computed(() => props.kind === 'rest' || props.kind === 'leave');
function dragOver(e, key) { if (!acceptsPlanDrag(e, TASK_DRAG_TYPE)) return; e.preventDefault(); e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes(TASK_DRAG_TYPE) ? 'move' : 'copy'; over.value = key; }
function dragLeave(e, key) { if (!e.currentTarget.contains(e.relatedTarget) && over.value === key) over.value = ''; }
function dropOn(e, period) {
  e.preventDefault(); over.value = '';
  const source = readPlanDrag(e, TASK_DRAG_TYPE);
  if (source && Number.isInteger(source.id) && source.id > 0) emit('place', { ...source, date: props.date, period });
}
const chipEvents = { toggle: (t) => emit('toggle', t), edit: (t) => emit('edit', t), period: (t, p) => emit('period', t, p), carry: (t) => emit('carry', t), drop: (t) => emit('drop', t), remove: (t) => emit('remove', t) };
</script>

<template>
  <div class="board-day" :class="{ today, rest }" :data-testid="`board-day-${date}`">
    <div class="board-date" :class="{ over: over === 'none' }" :data-testid="`board-cell-${date}-none`" :aria-busy="loading" @dragover="(e) => dragOver(e, 'none')" @dragleave="(e) => dragLeave(e, 'none')" @drop="(e) => dropOn(e, null)">
      <div class="date-head">
        <RouterLink :to="{ name: 'today', query: { date } }" class="date-link" :title="fmtDate(date)">{{ shortDate }}</RouterLink>
        <span v-if="today" class="pill">今天</span>
        <NButton size="tiny" quaternary class="add-event" :aria-label="`添加 ${date} 日程`" title="添加日程" @click="emit('add-event')">＋ 日程</NButton>
      </div>
      <div class="date-meta small">
        <span v-if="rest">{{ kind === 'rest' ? '全天休息' : '请假' }}</span>
        <span v-if="minutes">已记录 {{ fmtMin(minutes) }}</span>
      </div>
      <p v-if="loading" class="small muted date-state">正在读取日程…</p>
      <p v-else-if="error" class="small date-state" role="alert">日程读取失败 <NButton size="tiny" @click="emit('retry')">重试</NButton></p>
      <div v-else-if="events.length" class="day-summary small" data-testid="agenda-summary">
        <span v-if="summary.minutes">定时安排占用 <b>{{ fmtMin(summary.minutes) }}</b></span>
        <span v-if="summary.allDay">{{ summary.minutes ? '另有 ' : '' }}{{ summary.allDay }} 项全天安排</span>
        <span v-if="summary.overlap" class="overlap">有时段重叠</span>
      </div>
      <button v-for="ev in grouped.allDay" :key="ev.id" type="button" class="board-event" :class="ev.kind" :data-testid="`agenda-event-${ev.id}`" @click="emit('edit-event', ev)"><span class="ev-time">全天</span><span class="ev-title">{{ ev.title }}</span><span class="ev-meta">{{ scheduleLabels[ev.kind] || '安排' }}{{ ev.series_id ? ' · 重复' : '' }}</span></button>
      <ConferenceDayMarks :date="date" />
    </div>
    <div v-for="p in PERIODS" :key="p.key" class="board-cell" :class="{ over: over === p.key }" :data-testid="`board-cell-${date}-${p.key}`" @dragover="(e) => dragOver(e, p.key)" @dragleave="(e) => dragLeave(e, p.key)" @drop="(e) => dropOn(e, p.key)">
      <span class="cell-label small">{{ p.label }}</span>
      <template v-if="!loading && !error">
        <button v-for="ev in grouped[p.key]" :key="ev.id" type="button" class="board-event" :class="ev.kind" :data-testid="`agenda-event-${ev.id}`" @click="emit('edit-event', ev)"><span class="ev-time">{{ ev.start_time }}–{{ ev.end_time }}</span><span class="ev-title">{{ ev.title }}</span><span class="ev-meta">{{ scheduleLabels[ev.kind] || '安排' }}{{ ev.series_id ? ' · 重复' : '' }}<template v-if="ev.location"> · {{ ev.location }}</template></span></button>
      </template>
      <div class="chips"><PlanChip v-for="t in tasksIn(p.key)" :key="t.id" :task="t" :busy="busy[`task-${t.id}`]" v-on="chipEvents" /></div>
    </div>
    <!-- 还没定时段的任务：横跨上午 / 下午 / 晚上三格，拖进上面某一格就定下时段 -->
    <div v-if="unassigned.length" class="board-loose" :class="{ over: over === 'loose' }" :data-testid="`board-loose-${date}`" @dragover="(e) => dragOver(e, 'loose')" @dragleave="(e) => dragLeave(e, 'loose')" @drop="(e) => dropOn(e, null)">
      <span class="loose-label small">未定时段</span>
      <PlanChip v-for="t in unassigned" :key="t.id" :task="t" :busy="busy[`task-${t.id}`]" v-on="chipEvents" />
    </div>
  </div>
</template>

<style scoped>
.board-day { display: grid; grid-template-columns: var(--board-date-col, 150px) repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line-soft); }
.board-day.today { background: var(--today-bg); }
.board-day.rest .board-cell { background: var(--surface-muted); }
.board-date, .board-cell { min-width: 0; padding: 8px 7px; display: flex; flex-direction: column; gap: 5px; transition: background .12s, box-shadow .12s; }
.board-cell { border-left: 1px dashed var(--line-soft); min-height: 52px; }
.over { background: var(--honey-mist) !important; box-shadow: inset 0 0 0 2px var(--honey); border-radius: 8px; }
.date-head { display: flex; align-items: center; gap: 4px 6px; flex-wrap: wrap; }
.date-link { font-weight: 600; color: var(--ink); font-size: 13px; text-decoration: none; }
.today .date-link { color: var(--accent-deep); }
.date-meta { display: flex; flex-wrap: wrap; gap: 2px 8px; color: var(--ink-3); }
.date-meta:empty { display: none; }
.date-state { margin: 0; }
.day-summary { display: flex; flex-direction: column; gap: 1px; color: var(--ink-2); font-size: 11px; }
.overlap { color: var(--berry, #b5524b); }
.board-event { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; width: 100%; min-width: 0; text-align: left; font: inherit; color: var(--ink); padding: 3px 7px; border: 1px solid transparent; border-left: 3px solid var(--line); border-radius: 7px; background: var(--surface-soft); cursor: pointer; }
.board-event:hover { border-color: var(--line); }
.board-event.meeting { border-left-color: var(--accent); }
.board-event.course { border-left-color: var(--sand-deep); background: var(--surface-sand); }
.board-event.break { border-left-color: var(--ev-break-accent); background: var(--ev-break-bg); }
.board-event.checkin { border-left-color: var(--charcoal); background: var(--ev-checkin-bg); }
.board-event.other { border-left-color: var(--ev-other-accent); }
.ev-time { font-size: 10.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.ev-title { font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
.ev-meta { font-size: 10.5px; color: var(--ink-3); }
.chips { display: grid; gap: 5px; }
.chips:empty { display: none; }
.board-loose { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 5px; padding: 6px 7px 8px; border-top: 1px dashed var(--line-soft); border-left: 1px dashed var(--line-soft); }
.board-loose > .plan-chip { flex: 0 1 230px; min-width: 150px; }
.loose-label { align-self: center; color: var(--ink-3); margin-right: 2px; white-space: nowrap; }
.add-event { margin-left: auto; padding: 0 4px; color: var(--ink-3); }
.cell-label { display: none; color: var(--ink-3); font-weight: 600; }
@media (max-width: 760px) {
  .board-day { grid-template-columns: minmax(0, 1fr); border: 1px solid var(--line-card); border-radius: 12px; background: var(--card); margin-top: 12px; overflow: hidden; }
  .board-date { border-bottom: 1px solid var(--line-soft); background: var(--surface-soft); }
  .board-cell { border-left: 0; border-top: 1px dashed var(--line-soft); min-height: 0; }
  .cell-label { display: block; }
  .board-loose { grid-column: 1; border-left: 0; }
  .board-loose > .plan-chip { flex: 1 1 100%; }
}
</style>
