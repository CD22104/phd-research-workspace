<script setup>
import ConferenceDayMarks from './ConferenceDayMarks.vue';
import { ref, watch } from 'vue';
import { NButton } from 'naive-ui';
import { api } from '../lib/api';
import { store } from '../lib/store';
import ScheduleEventEditor from './ScheduleEventEditor.vue';

const props = defineProps({ date: { type: String, required: true } });
const events = ref([]);
const error = ref('');
const loading = ref(false);
const editorOpen = ref(false);
const selected = ref(null);
const kind = ref('meeting');
const labels = { meeting: '会议', course: '课程', checkin: '打卡', break: '休息', other: '安排' };
let requestId = 0;
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.get(`/calendar?from=${props.date}&to=${props.date}`);
    if (id === requestId) events.value = result.events;
  } catch (e) { if (id === requestId) { events.value = []; error.value = e.message; } }
  finally { if (id === requestId) loading.value = false; }
}
function open(event = null, eventKind = 'meeting') { selected.value = event; kind.value = eventKind; editorOpen.value = true; }
watch([() => props.date, () => store.version], load, { immediate: true });
</script>

<template>
  <section class="card day-schedule">
    <div class="card-title"><h3>当天日程</h3><RouterLink :to="{ name: 'calendar', query: { date } }" class="small">看整周 ›</RouterLink></div>
    <div v-if="error" class="small" role="alert">{{ error }} <NButton size="tiny" @click="load">重试</NButton></div>
    <div v-else-if="loading" class="small muted">正在读取日程…</div>
    <div v-else-if="!events.length" class="small muted">还没有安排，按自己的节奏来。</div>
    <div v-else class="schedule-list">
      <button v-for="event in events" :key="event.id" class="schedule-event" :class="event.kind" @click="open(event)">
        <span class="schedule-time">{{ event.all_day ? '全天' : `${event.start_time}–${event.end_time}` }}</span>
        <span class="schedule-title">{{ event.title }}</span>
        <span class="schedule-kind">{{ labels[event.kind] }}{{ event.series_id ? ' · 重复' : '' }}</span>
        <span v-if="event.location" class="schedule-location">{{ event.location }}</span>
      </button>
    </div>
    <ConferenceDayMarks :date="date" />
    <div class="row quick-schedule">
      <NButton size="small" secondary @click="open(null, 'meeting')">＋ 会议</NButton>
      <NButton size="small" secondary @click="open(null, 'course')">＋ 课程</NButton>
      <NButton size="small" secondary @click="open(null, 'checkin')">＋ 打卡</NButton>
      <NButton size="small" secondary @click="open(null, 'break')">＋ 休息活动</NButton>
      <NButton size="small" quaternary @click="open(null, 'other')">其他</NButton>
    </div>
    <ScheduleEventEditor v-model:show="editorOpen" :event="selected" :date="date" :kind="kind" />
  </section>
</template>

<style scoped>
.schedule-list { display: grid; gap: 7px; }
.schedule-event { text-align: left; display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; width: 100%; border: 1px solid transparent; border-left: 3px solid var(--accent); border-radius: 9px; padding: 12px; background: var(--ev-default-bg); color: var(--ink); font: inherit; cursor: pointer; }
.schedule-event.checkin { border-left-color:var(--charcoal); background:var(--ev-checkin-bg); }
.schedule-event.course { border-left-color:var(--sand-deep); background:var(--surface-sand); }
.schedule-event.break { border-left-color: var(--ev-break-accent); background: var(--ev-break-bg); }
.schedule-event.other { border-left-color: var(--ev-other-accent); }
.schedule-event:hover { border-color: var(--honey); }
.schedule-time { grid-column: 1 / -1; color: var(--ink-3); font-size: 11px; }
.schedule-title { font-size: 13px; overflow-wrap: anywhere; }
.schedule-kind { color: var(--ink-3); font-size: 11px; white-space: nowrap; }
.schedule-location { grid-column: 1 / -1; font-size: 11px; color: var(--ink-3); overflow-wrap: anywhere; }
.quick-schedule { margin-top: 12px; }
</style>
