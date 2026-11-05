<script setup>
import ConferenceDayMarks from './ConferenceDayMarks.vue';
import { computed } from 'vue';
import { NButton } from 'naive-ui';
import { fmtMin } from '../lib/format';
import { scheduleLabels, sortedSchedule, summarizeSchedule } from '../lib/calendar-summary';
const props = defineProps({ date: String, events: { type: Array, default: () => [] }, kind: String, loading: Boolean, error: String, interactive: Boolean });
const emit = defineEmits(['edit', 'add', 'retry']);
const rows = computed(() => sortedSchedule(props.events));
const summary = computed(() => summarizeSchedule(props.events));
</script>
<template>
  <section class="planning-agenda" :data-testid="`planning-agenda-${date}`" :aria-busy="loading">
    <div class="agenda-heading"><h4>当天日程</h4><NButton v-if="interactive" size="tiny" quaternary :aria-label="`添加 ${date} 日程`" @click="emit('add')">＋ 日程</NButton><RouterLink v-else class="small" :to="{name:'calendar',query:{date}}">查看日程 ›</RouterLink></div>
    <p v-if="kind==='rest' || kind==='leave'" class="day-unavailable">{{ kind==='rest'?'全天休息':'请假' }} · 按需安排任务</p>
    <p v-if="loading" class="muted small agenda-state">正在读取日程…</p>
    <p v-else-if="error" class="agenda-state small" role="alert">日程读取失败 <NButton size="tiny" @click="emit('retry')">重试</NButton></p>
    <template v-else>
      <p v-if="!rows.length" class="muted small agenda-state">暂无日程安排</p>
      <div v-else class="agenda-events">
        <component :is="interactive?'button':'div'" v-for="event in rows" :key="event.id" :type="interactive?'button':undefined" class="agenda-event" :class="event.kind" :data-testid="`agenda-event-${event.id}`" @click="interactive && emit('edit',event)">
          <span class="agenda-time">{{ event.all_day?'全天':`${event.start_time}–${event.end_time}` }}</span>
          <span class="agenda-detail"><span class="agenda-title">{{ event.title }}</span><span class="agenda-meta">{{ scheduleLabels[event.kind] || '安排' }}{{ event.series_id?' · 重复':'' }}<span v-if="event.location"> · {{ event.location }}</span></span></span>
        </component>
      </div>
      <div v-if="rows.length" class="agenda-summary small" data-testid="agenda-summary">
        <span v-if="summary.minutes">定时安排占用 <b>{{ fmtMin(summary.minutes) }}</b></span>
        <span v-if="summary.allDay">{{ summary.minutes?'另有 ':'' }}{{ summary.allDay }} 项全天安排</span>
        <span v-if="summary.overlap" class="overlap">有时段重叠</span>
      </div>
    </template>
    <ConferenceDayMarks :date="date" />
  </section>
</template>
<style scoped>
.planning-agenda { min-width:0; padding:12px 0 14px; border-bottom:1px solid var(--line-soft); margin-bottom:8px; }
.agenda-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
.agenda-heading h4 { font-size:12px; font-weight:600; color:var(--ink-2); margin:0; }
.agenda-events { display:grid; gap:6px; }
.agenda-event { display:flex; align-items:flex-start; gap:8px; width:100%; min-width:0; text-align:left; font:inherit; color:var(--ink); padding:8px; border:1px solid transparent; border-radius:8px; background:var(--honey-mist); }
button.agenda-event { cursor:pointer; }
button.agenda-event:hover { border-color:var(--accent); }
.agenda-event.course { background:var(--surface-sand); }
.agenda-event.break,.agenda-event.other { background:var(--surface-warm); }
.agenda-event.checkin { background:var(--ev-checkin-bg); }
.agenda-time { width:78px; flex:none; font-size:11px; line-height:20px; font-variant-numeric:tabular-nums; color:var(--ink-2); }
.agenda-detail { display:grid; gap:3px; flex:1; min-width:0; }
.agenda-title { font-size:12px; line-height:20px; overflow-wrap:anywhere; }
.agenda-meta { font-size:10px; line-height:1.5; color:var(--ink-2); overflow-wrap:anywhere; }
.agenda-summary { display:flex; gap:4px 10px; flex-wrap:wrap; margin-top:9px; color:var(--ink-2); font-size:11px; }
.overlap { color:var(--sand-deep); }
.agenda-state { margin:8px 0 2px; }
.day-unavailable { font-size:12px; margin:8px 0; color:var(--ink-2); }
</style>
