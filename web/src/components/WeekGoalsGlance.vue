<script setup>
// 今日页的「本周计划」：周目标 + 进度 + 未完成的子任务。子任务可以拖进日计划，也可以点「加入今天」（手机上用这个）；
// 编辑目标和子任务仍在周计划页面
import { computed, reactive } from 'vue';
import { api } from '../lib/api';
import { isoWeek, weekStart } from '../lib/format';
import { changed, store } from '../lib/store';
import { fail, toast } from '../lib/ui';
import { GOAL_TASK_DRAG_TYPE, PERIOD_LABEL } from '../lib/periods';
const props = defineProps({ date: { type: String, required: true }, week: Object, goals: Array, goalTasks: Array, tasks: Array, defaultPeriod: { type: String, default: null } });
const busy = reactive({});
const thisWeek = computed(() => weekStart(props.date) === weekStart(store.today));
const dayWord = computed(() => props.date === store.today ? '今天' : '这天');
const rows = computed(() => (props.goals || []).filter((g) => g.status !== 'dropped').map((g) => {
  const children = (props.goalTasks || []).filter((t) => t.goal_id === g.id);
  const done = children.filter((t) => t.status === 'done').length;
  const pct = children.length ? Math.round((done / children.length) * 100) : g.status === 'done' ? 100 : g.progress || 0;
  const today = (props.tasks || []).filter((t) => t.goal_id === g.id && !['dropped', 'moved'].includes(t.status)).length;
  const finished = g.status === 'done' || pct === 100;
  const open = finished ? [] : children.filter((t) => t.status === 'todo').map((t) => ({ id: t.id, title: t.title, here: (t.scheduled_dates || []).includes(props.date) }));
  return { id: g.id, title: g.title, pct, finished, count: children.length ? `${done}/${children.length}` : `${pct}%`, today, open };
}));
const finished = computed(() => rows.value.filter((r) => r.finished).length);
const anyOpen = computed(() => rows.value.some((r) => r.open.some((t) => !t.here)));
function drag(e, t) {
  if (t.here || busy[t.id]) { e.preventDefault(); return; }
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(GOAL_TASK_DRAG_TYPE, String(t.id));
  e.dataTransfer.setData('text/plain', JSON.stringify({ goal_task_id: t.id }));
}
async function add(t) {
  if (busy[t.id]) return;
  busy[t.id] = true;
  const period = props.defaultPeriod && props.defaultPeriod !== 'none' ? props.defaultPeriod : null;
  try { await api.post(`/goal-tasks/${t.id}/schedule`, { date: props.date, period, planned: true }); toast(`已加入日计划${period ? ' · ' + PERIOD_LABEL[period] : ''}`); changed(); }
  catch (e) { fail(e); }
  finally { busy[t.id] = false; }
}
</script>

<template>
  <section class="card week-glance" data-testid="week-glance">
    <div class="card-title">
      <h3>{{ thisWeek ? '本周计划' : '这一周的计划' }} <span class="small muted">{{ isoWeek(date) }}<template v-if="rows.length"> · 完成 {{ finished }}/{{ rows.length }}</template></span></h3>
      <RouterLink :to="{ name: 'week', query: { date } }" class="small">周计划 ›</RouterLink>
    </div>
    <p v-if="week?.focus" class="glance-focus small">主题：{{ week.focus }}</p>
    <p v-if="anyOpen" class="glance-hint small muted">把子任务拖进日计划的上午 / 下午 / 晚上，或点「加入{{ dayWord }}」放进{{ defaultPeriod && defaultPeriod !== 'none' ? '「' + PERIOD_LABEL[defaultPeriod] + '」' : '日计划' }}。</p>
    <ul v-if="rows.length" class="glance-list">
      <li v-for="r in rows" :key="r.id" :class="{ finished: r.finished }" :data-testid="`week-glance-goal-${r.id}`">
        <div class="glance-line">
          <span class="glance-mark" aria-hidden="true">{{ r.finished ? '✓' : '' }}</span>
          <span class="glance-name">{{ r.title }}</span>
          <span class="glance-meta small"><template v-if="r.today">{{ dayWord }} {{ r.today }} 项 · </template>{{ r.count }}</span>
        </div>
        <div class="glance-bar" aria-hidden="true"><span :style="{ width: r.pct + '%' }" /></div>
        <ul v-if="r.open.length" class="glance-subtasks">
          <li v-for="t in r.open" :key="t.id" class="glance-subtask" :class="{ here: t.here }" :draggable="!t.here && !busy[t.id]" :data-testid="`week-glance-task-${t.id}`" :title="t.here ? '' : '拖进日计划'" @dragstart="(e) => drag(e, t)">
            <span class="glance-handle" aria-hidden="true">{{ t.here ? '' : '⠿' }}</span>
            <span class="glance-task-name">{{ t.title }}</span>
            <span v-if="t.here" class="small muted">{{ dayWord }}已安排</span>
            <button v-else type="button" class="glance-add small" :disabled="busy[t.id]" :aria-label="`加入${dayWord}：${t.title}`" :data-testid="`week-glance-add-${t.id}`" @click="add(t)">加入{{ dayWord }}</button>
          </li>
        </ul>
      </li>
    </ul>
    <p v-else class="small muted glance-empty">{{ thisWeek ? '这周' : '这一周' }}还没有周目标。<RouterLink :to="{ name: 'week', query: { date } }">去周计划添加 ›</RouterLink></p>
  </section>
</template>

<style scoped>
.week-glance .card-title { margin-bottom: 12px; }
.week-glance h3 { margin: 0; }
.week-glance h3 .small { font-weight: 400; margin-left: 6px; }
.glance-focus { margin: 0 0 8px; color: var(--ink-2); overflow-wrap: anywhere; }
.glance-hint { margin: 0 0 12px; }
.glance-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.glance-line { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; }
.glance-mark { width: 14px; height: 14px; border: 1.5px solid var(--line); border-radius: 50%; font-size: 10px; line-height: 12px; text-align: center; color: var(--card); align-self: center; }
.finished .glance-mark { background: var(--leaf); border-color: var(--leaf); }
.glance-name { font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.finished .glance-name { color: var(--ink-3); }
.glance-meta { color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.glance-bar { height: 3px; margin: 6px 0 0 24px; border-radius: 3px; background: var(--line-soft); overflow: hidden; }
.glance-bar span { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
.finished .glance-bar span { background: var(--leaf); }
.glance-subtasks { list-style: none; margin: 8px 0 0 18px; padding: 0; display: grid; gap: 2px; }
.glance-subtask { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; gap: 6px; align-items: center; padding: 5px 6px; border-radius: 8px; font-size: 13px; }
.glance-subtask[draggable=true] { cursor: grab; }
.glance-subtask[draggable=true]:hover { background: var(--surface-warm); }
.glance-subtask.here .glance-task-name { color: var(--ink-3); }
.glance-handle { color: var(--ink-3); font-size: 14px; line-height: 1; }
.glance-task-name { overflow-wrap: anywhere; line-height: 1.45; }
.glance-add { border: 0; background: none; padding: 2px 4px; color: var(--accent-deep); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; border-radius: 6px; }
.glance-add:hover { background: var(--honey-mist); }
.glance-add:disabled { opacity: .5; cursor: default; }
.glance-empty { margin: 0; }
</style>
