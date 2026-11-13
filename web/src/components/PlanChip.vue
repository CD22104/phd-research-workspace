<script setup>
// 周计划排期板里的一条日任务：可勾选、拖到别的格子（换天 / 换时段）、菜单里也能换时段（手机用）
import { computed } from 'vue';
import { NCheckbox, NButton, NDropdown } from 'naive-ui';
import { TASK_DRAG_TYPE } from '../lib/day-timeline';
import { PERIODS } from '../lib/periods';
const props = defineProps({ task: { type: Object, required: true }, busy: Boolean });
const emit = defineEmits(['toggle', 'edit', 'period', 'carry', 'drop', 'remove']);
const globallyDone = computed(() => props.task.goal_task_status === 'done');
const done = computed(() => props.task.status === 'done' || globallyDone.value);
const inactive = computed(() => ['dropped', 'moved'].includes(props.task.status));
const movable = computed(() => props.task.status === 'todo' && !globallyDone.value && !props.busy);
const note = computed(() => globallyDone.value && props.task.status !== 'done' ? '已在别处完成' : props.task.status === 'moved' ? '已顺延' : props.task.status === 'dropped' ? '已取消' : '');
const menu = computed(() => [
  { label: '编辑', key: 'edit' },
  { type: 'divider', key: 'd0' },
  ...PERIODS.map((p) => ({ label: `移到${p.label}`, key: 'period:' + p.key, disabled: !movable.value || props.task.period === p.key })),
  { label: '移到未定时段', key: 'period:', disabled: !movable.value || !props.task.period },
  { type: 'divider', key: 'd1' },
  { label: props.task.goal_task_id ? '也安排到明天' : '顺延到明天', key: 'carry', disabled: props.task.status !== 'todo' || globallyDone.value },
  { label: props.task.status === 'dropped' ? '恢复安排' : '取消这天的安排', key: 'drop', disabled: globallyDone.value },
  { label: '删除这条日任务', key: 'remove' },
]);
function select(key) {
  if (key.startsWith('period:')) emit('period', props.task, key.slice(7) || null);
  else emit(key, props.task);
}
function drag(e) {
  if (!movable.value) { e.preventDefault(); return; }
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(TASK_DRAG_TYPE, String(props.task.id));
  e.dataTransfer.setData('text/plain', JSON.stringify({ task_id: props.task.id }));
}
</script>

<template>
  <div class="plan-chip" :class="{ done, inactive: inactive && !done }" :draggable="movable" :data-testid="`plan-chip-${task.id}`" :data-task-id="task.id" :title="movable ? '拖到其他格子换天或换时段' : ''" @dragstart="drag">
    <NCheckbox size="small" :checked="done" :disabled="inactive || busy || (globallyDone && task.status !== 'done')" :aria-label="`完成 ${task.title}`" @update:checked="emit('toggle', task)" />
    <div class="chip-body">
      <button type="button" class="chip-title" :disabled="busy" @click="emit('edit', task)">{{ task.title }}</button>
      <span v-if="task.goal_title || note || !task.planned" class="chip-meta"><span v-if="note">{{ note }}</span><span v-if="!task.planned">临时</span><span v-if="task.goal_title">{{ task.goal_title }}</span></span>
    </div>
    <NDropdown :options="menu" trigger="click" :disabled="busy" @select="select"><NButton quaternary circle size="tiny" :disabled="busy" :aria-label="`操作：${task.title}`">⋯</NButton></NDropdown>
  </div>
</template>

<style scoped>
.plan-chip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px; align-items: start; padding: 4px 2px 4px 7px; border-radius: 9px; background: var(--card); border: 1px solid var(--line-soft); }
.plan-chip[draggable=true] { cursor: grab; }
.plan-chip[draggable=true]:hover { border-color: var(--accent); }
.plan-chip > :first-child { margin-top: 2px; }
.chip-body { min-width: 0; }
.chip-title { border: 0; background: none; padding: 0; text-align: left; font: inherit; font-size: 13px; line-height: 1.45; color: var(--ink); cursor: pointer; overflow-wrap: anywhere; }
.done .chip-title { text-decoration: line-through; color: var(--ink-3); }
.inactive { opacity: .55; }
.chip-body { line-height: 1.45; }
.chip-meta { display: inline; margin-left: 6px; font-size: 11px; color: var(--ink-3); }
.chip-meta span + span::before { content: ' · '; }
</style>
