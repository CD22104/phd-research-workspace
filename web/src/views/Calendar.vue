<script setup>
import ConferenceDayMarks from '../components/ConferenceDayMarks.vue';
import SubmissionCountdown from '../components/SubmissionCountdown.vue';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NSelect } from 'naive-ui';
import { api } from '../lib/api';
import { changed, store } from '../lib/store';
import { addDays, fmtDate, isoWeek, weekStart } from '../lib/format';
import { fail, toast } from '../lib/ui';
import ScheduleEventEditor from '../components/ScheduleEventEditor.vue';

const route = useRoute();
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const monday = ref(weekStart(validDate(route.query.date) ? route.query.date : store.today));
const rangeEnd = computed(() => addDays(monday.value, 27));
const rangeLabel = computed(() => `${monday.value.slice(0, 4)}年 ${fmtDate(monday.value, false)} – ${rangeEnd.value.slice(0, 4) !== monday.value.slice(0, 4) ? rangeEnd.value.slice(0, 4) + '年 ' : ''}${fmtDate(rangeEnd.value, false)}`);
const data = ref(null);
const weeks = computed(() => {
  const days = data.value?.days || [];
  return Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => ({ start: days[i * 7].date, days: days.slice(i * 7, i * 7 + 7) }));
});
const error = ref('');
const loading = ref(false);
const editorOpen = ref(false);
const selected = ref(null);
const eventDate = ref(store.today);
const eventKind = ref('meeting');
const daySaving = ref({});
const labels = { meeting: '会议', course: '课程', checkin: '打卡', break: '休息活动', other: '其他安排' };
const kindOptions = [{ value: 'work', label: '工作日' }, { value: 'rest', label: '全天休息' }, { value: 'leave', label: '请假' }];
const total = computed(() => data.value?.events.length || 0);
let requestId = 0;
async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.get(`/calendar?from=${monday.value}&to=${rangeEnd.value}`);
    if (id === requestId) data.value = result;
  } catch (e) { if (id === requestId) { data.value = null; error.value = e.message; } }
  finally { if (id === requestId) loading.value = false; }
}
watch([monday, () => store.version], load, { immediate: true });
watch(() => route.query.date, (date) => { if (validDate(date)) monday.value = weekStart(date); });
const eventsOn = (date) => (data.value?.events || []).filter((event) => event.date === date);
function open(date, event = null, kind = 'meeting') { eventDate.value = date; selected.value = event; eventKind.value = kind; editorOpen.value = true; }
async function setKind(date, kind) {
  if (daySaving.value[date]) return;
  daySaving.value[date] = true;
  try { await api.put(`/day/${date}`, { kind }); changed(); toast(kind === 'rest' ? '这天已设为全天休息' : '日期类型已更新'); }
  catch (e) { fail(e); }
  finally { daySaving.value[date] = false; }
}
</script>

<template>
  <div class="page calendar-page">
    <div class="page-head calendar-head">
      <NButton quaternary @click="monday = addDays(monday, -28)">‹ 前四周</NButton>
      <div class="calendar-period"><h1>日程 <span class="period-size">四周</span></h1><span class="small muted" data-testid="calendar-range">{{ rangeLabel }}</span></div>
      <NButton quaternary @click="monday = addDays(monday, 28)">后四周 ›</NButton>
      <NButton secondary size="small" @click="monday = weekStart(store.today)">今天</NButton>
      <NButton data-testid="calendar-add" type="primary" size="small" @click="open(store.today >= monday && store.today <= rangeEnd ? store.today : monday)">＋ 添加日程</NButton>
    </div>
    <SubmissionCountdown compact />
    <div class="calendar-intro">
      <span>按自己的节奏安排会议、课程、打卡、休息和其他活动。</span>
      <span class="small muted">{{ store.timezone === 'Asia/Singapore' ? '新加坡' : store.timezone }} 时间 · 日程时长不计入已工作时间</span>
    </div>
    <div v-if="error" class="card" role="alert">{{ error }} <NButton size="small" @click="load">重试</NButton></div>
    <div v-else-if="loading && !data" class="card muted">正在读取四周日程…</div>
    <template v-if="data">
      <div class="calendar-grid" :aria-busy="loading">
       <template v-for="week in weeks" :key="week.start">
        <div class="calendar-week-heading"><h2>{{ isoWeek(week.start) }}</h2><span class="small muted">{{ fmtDate(week.start, false) }} – {{ fmtDate(addDays(week.start, 6), false) }}</span></div>
        <section v-for="day in week.days" :key="day.date" class="calendar-day" :data-date="day.date" :class="[day.kind, { today: day.date === store.today }]">
          <div class="day-heading">
            <RouterLink :to="{ name: 'today', query: { date: day.date } }">{{ fmtDate(day.date) }}<span v-if="day.date === store.today" class="today-dot"> · 今天</span></RouterLink>
            <NSelect :value="day.kind" :options="kindOptions" size="small" :disabled="daySaving[day.date]" :aria-label="`${day.date}日期类型`" @update:value="(value) => setKind(day.date, value)" />
          </div>
          <div class="day-events">
            <ConferenceDayMarks :date="day.date" />
            <button v-for="event in eventsOn(day.date)" :key="event.id" class="calendar-event" :data-testid="`calendar-event-${event.id}`" :class="event.kind" @click="open(day.date, event)">
              <span class="event-clock">{{ event.all_day ? '全天' : `${event.start_time}–${event.end_time}` }}</span>
              <strong>{{ event.title }}</strong>
              <span v-if="event.location" class="event-location">{{ event.location }}</span>
              <span class="event-type">{{ labels[event.kind] }}{{ event.series_id ? ' · 重复' : '' }}</span>
            </button>
            <div v-if="!eventsOn(day.date).length" class="empty-day">{{ day.kind === 'rest' ? '留一点时间给自己' : day.kind === 'leave' ? '这天请假' : '时间由你安排' }}</div>
          </div>
          <div class="day-add">
            <NButton size="tiny" quaternary @click="open(day.date)">＋ 安排</NButton>
            <NButton v-if="day.kind === 'work'" size="tiny" quaternary :disabled="daySaving[day.date]" @click="setKind(day.date, 'rest')">全天休息</NButton>
          </div>
        </section>
       </template>
      </div>
      <div class="calendar-foot small muted">四周共 {{ total }} 项安排 · 点选安排可修改日期、时间和内容</div>
    </template>
    <ScheduleEventEditor v-model:show="editorOpen" :event="selected" :date="eventDate" :kind="eventKind" />
  </div>
</template>

<style scoped>
.calendar-head { flex-wrap: wrap; gap: 8px; }
.calendar-period { display: grid; gap: 1px; margin-right: auto; }
.calendar-period h1 { margin: 0; }
.period-size { font-size: 13px; font-weight: 400; color: var(--ink-3); margin-left: 8px; vertical-align: middle; }
.calendar-intro { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin: 8px 0 16px; font-size: 14px; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; align-items: stretch; }
.calendar-grid[aria-busy=true] { opacity: .6; pointer-events: none; }
.calendar-week-heading { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; padding-top: 12px; }
.calendar-week-heading:first-child { padding-top: 0; }
.calendar-week-heading h2 { margin: 0; font-size: 13px; font-weight: 600; color: var(--ink-2); }
.calendar-day { min-width: 0; border: 1px solid var(--line-card); border-radius: 13px; background: var(--card); display: flex; flex-direction: column; overflow: hidden; }
.calendar-day.rest, .calendar-day.leave { background: var(--surface-muted); }
.calendar-day.today .day-heading { background: var(--today-head); }
.calendar-day.today .day-heading a, .calendar-day.today .today-dot { color: var(--accent-deep); }
.calendar-day.today { border-color: var(--today-line); box-shadow: var(--shadow); }
.day-heading { background: var(--surface-soft); display: grid; gap: 7px; padding: 10px 8px; }
.day-heading a { font-weight: 600; color: var(--ink); font-size: 12px; text-decoration: none; }
.today-dot { color: var(--honey-deep); white-space: nowrap; }
.day-events { padding: 8px 6px; display: grid; gap: 8px; align-content: start; min-height: 80px; }
.calendar-event { min-width: 0; border: 1px solid transparent; border-left: 3px solid var(--accent); border-radius: 8px; background: var(--honey-mist); padding: 9px 7px; color: var(--ink); font: inherit; text-align: left; display: grid; gap: 4px; cursor: pointer; overflow-wrap: anywhere; }
.calendar-event.checkin { background:var(--ev-checkin-bg); border-left-color:var(--charcoal); }
.calendar-event.course { background:var(--surface-sand); border-left-color:var(--sand-deep); }
.calendar-event.break { background: var(--ev-break-bg); border-color: transparent; border-left-color: var(--ev-break-accent); }
.calendar-event.other { background: var(--surface-warm); border-color: transparent; border-left-color: var(--ev-other-accent); }
.calendar-event:hover { border-color: var(--honey-deep); }
.calendar-event strong { font-size: 13px; font-weight: 500; }
.event-clock, .event-type, .event-location { font-size: 11px; color: var(--ink-2); }
.event-clock { font-variant-numeric: tabular-nums; }
.event-type { color: var(--ink-3); }
.empty-day { color: var(--ink-3); font-size: 12px; padding: 12px 3px; }
.day-add { display: flex; flex-wrap: wrap; gap: 3px; margin-top: auto; padding: 8px; }
.calendar-foot { margin-top: 14px; }
@media (max-width: 1180px) and (min-width: 801px) { .calendar-grid { gap: 7px; } .day-heading { padding: 9px 5px; } .day-add { padding: 6px 3px; } }
@media (max-width: 800px) { .calendar-grid { grid-template-columns: 1fr; gap: 12px; } .day-heading { grid-template-columns: 1fr 112px; align-items: center; padding: 9px 12px; } .day-heading a { font-size: 14px; } .day-events { min-height: 0; padding: 9px 10px; } .calendar-event { grid-template-columns: minmax(84px, auto) 1fr; align-items: baseline; gap: 5px 9px; } .event-location { grid-column: 2; } .event-type { grid-column: 2; } .empty-day { padding: 6px 3px; } .day-add { padding: 5px 8px; } .calendar-head > .n-button { padding-left: 8px; padding-right: 8px; } }
</style>
