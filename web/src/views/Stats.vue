<script setup>
import { computed, ref, watch } from 'vue';
import { NButton, NRadioGroup, NRadioButton, NDataTable } from 'naive-ui';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { BarChart, LineChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkLineComponent, CalendarComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { api } from '../lib/api';
import { store } from '../lib/store';
import { theme, chartColors } from '../lib/theme';
import { fail } from '../lib/ui';
import { addDays, fmtDate, fmtHours, fmtMin, fmtTime, weekStart, isoWeek } from '../lib/format';
import ScoreCard from '../components/ScoreCard.vue';
import Empty from '../components/Empty.vue';

use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, MarkLineComponent, CalendarComponent, VisualMapComponent, SVGRenderer]);

// 颜色跟随当前皮肤（单一系列用主色；热力图用同一色相的 5 档，每套皮肤在 themes.css 里定义）
const C = computed(() => chartColors(theme.tokens));
const alpha = (hex, a) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

const range = ref('week');
const date = ref(store.today);
const s = ref(null);
const heat = ref(null);
const showTable = ref(false);

async function load() {
  try {
    s.value = await api.get(`/stats?range=${range.value}&date=${date.value}`);
  } catch (e) {
    fail(e);
  }
}
async function loadHeat() {
  heat.value = await api.get(`/stats/heatmap?to=${store.today}&days=182`).catch(() => null);
}
watch([range, date], load);
load();
loadHeat();

function shift(n) {
  if (range.value === 'day') date.value = addDays(date.value, n);
  else if (range.value === 'week') date.value = addDays(weekStart(date.value), 7 * n);
  else {
    const [y, m] = date.value.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    date.value = d.toISOString().slice(0, 10);
  }
}
const label = computed(() => {
  if (!s.value) return '';
  if (range.value === 'day') return fmtDate(s.value.from);
  if (range.value === 'week') return `${isoWeek(s.value.from)}（${fmtDate(s.value.from, false)}–${fmtDate(s.value.to, false)}）`;
  return `${s.value.from.slice(0, 4)} 年 ${Number(s.value.from.slice(5, 7))} 月`;
});

const kpi = computed(() => {
  if (!s.value) return null;
  const days = s.value.days.filter((d) => d.date <= s.value.today);
  const work = days.filter((d) => d.kind === 'work');
  const total = days.reduce((a, d) => a + d.minutes, 0);
  const planned = days.reduce((a, d) => a + d.plannedCount, 0);
  const done = days.reduce((a, d) => a + d.doneCount, 0);
  const unplanned = days.reduce((a, d) => a + d.unplannedDone, 0);
  return {
    total, avg: work.length ? total / work.length : 0, planned, done, unplanned,
    checkin: work.filter((d) => d.checkin).length, work: work.length,
  };
});

const dayRows = computed(() => (s.value?.days || []).filter((d) => d.date <= s.value.today || d.minutes));
const tip = () => ({ backgroundColor: C.value.tipBg, borderColor: C.value.tipBorder, textStyle: { color: C.value.tipInk, fontSize: 12 }, extraCssText: `border-radius:10px;box-shadow:0 4px 14px ${C.value.shadow};` });
const axisX = (data) => ({ type: 'category', data, axisLine: { lineStyle: { color: C.value.grid } }, axisTick: { show: false }, axisLabel: { color: C.value.ink, fontSize: 11 } });
const axisY = (fmt) => ({ type: 'value', splitLine: { lineStyle: { color: C.value.grid, type: 'solid' } }, axisLabel: { color: C.value.ink, fontSize: 11, formatter: fmt } });

const hoursOption = computed(() => {
  if (!s.value || range.value === 'day') return null;
  const days = s.value.days;
  const target = Math.max(0, ...days.map((d) => d.targetMinutes));
  return {
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: {
      ...tip(), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: alpha(C.value.series, 0.08) } },
      formatter: (ps) => {
        const d = days[ps[0].dataIndex];
        return `<b>${fmtDate(d.date)}</b><br/>记录工时 ${fmtMin(d.minutes)}（计划 ${fmtMin(d.targetMinutes)}）<br/>计划任务 ${d.doneCount}/${d.plannedCount}${d.unplannedDone ? `，计划外 ${d.unplannedDone}` : ''}<br/>执行评分 ${d.score.score ?? '暂不评分'}`;
      },
    },
    xAxis: axisX(days.map((d) => (range.value === 'week' ? fmtDate(d.date).slice(-2) : Number(d.date.slice(8))))),
    yAxis: { ...axisY((v) => `${v}h`), max: (v) => Math.ceil(Math.max(v.max, target / 60)) },
    series: [{
      type: 'bar', data: days.map((d) => Math.round((d.minutes / 60) * 10) / 10), barMaxWidth: 24, barGap: '2px',
      itemStyle: { color: C.value.series, borderRadius: [4, 4, 0, 0] }, emphasis: { itemStyle: { color: C.value.series } },
      markLine: target ? { symbol: 'none', silent: true, lineStyle: { color: C.value.muted, type: 'solid', width: 1 }, label: { formatter: `每日计划 ${Math.round(target / 6) / 10}h`, color: C.value.ink, fontSize: 11, position: 'insideEndTop' }, data: [{ yAxis: Math.round(target / 6) / 10 }] } : undefined,
    }],
  };
});

const scoreOption = computed(() => {
  if (!s.value || range.value === 'day') return null;
  const days = s.value.days;
  if (!days.some((d) => d.score.score != null)) return null;
  return {
    grid: { left: 40, right: 16, top: 16, bottom: 28 },
    tooltip: { ...tip(), trigger: 'axis', formatter: (ps) => { const d = days[ps[0].dataIndex]; return `<b>${fmtDate(d.date)}</b><br/>执行评分 ${d.score.score ?? '暂不评分'}${d.score.reason ? `<br/><span style="color:${C.value.muted}">${d.score.reason}</span>` : ''}`; } },
    xAxis: axisX(days.map((d) => (range.value === 'week' ? fmtDate(d.date).slice(-2) : Number(d.date.slice(8))))),
    yAxis: { ...axisY((v) => v), min: 0, max: 100 },
    series: [{
      type: 'line', data: days.map((d) => d.score.score), connectNulls: false, lineStyle: { width: 2, color: C.value.series, cap: 'round', join: 'round' },
      symbol: 'circle', symbolSize: 9, itemStyle: { color: C.value.series, borderColor: C.value.ring, borderWidth: 2 }, areaStyle: { color: alpha(C.value.series, 0.12) },
    }],
  };
});

const heatOption = computed(() => {
  if (!heat.value) return null;
  const data = heat.value.days.map((d) => [d.date, Math.round((d.minutes / 60) * 10) / 10]);
  return {
    tooltip: { ...tip(), formatter: (p) => `${fmtDate(p.data[0])}<br/>记录工时 ${p.data[1]} 小时` },
    visualMap: {
      type: 'piecewise', orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 12, itemHeight: 12, textStyle: { color: C.value.ink, fontSize: 11 },
      pieces: [
        { value: 0, color: C.value.zero, label: '0' }, { gt: 0, lte: 1, color: C.value.ramp[0], label: '≤1h' }, { gt: 1, lte: 2, color: C.value.ramp[1], label: '1–2h' },
        { gt: 2, lte: 4, color: C.value.ramp[2], label: '2–4h' }, { gt: 4, lte: 6, color: C.value.ramp[3], label: '4–6h' }, { gt: 6, color: C.value.ramp[4], label: '>6h' },
      ],
    },
    calendar: {
      range: [heat.value.from, heat.value.to], top: 22, left: 30, right: 10, cellSize: ['auto', 14], splitLine: { show: false },
      itemStyle: { borderColor: C.value.ring, borderWidth: 2, color: C.value.zero }, yearLabel: { show: false },
      dayLabel: { firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六'], color: C.value.ink, fontSize: 10 },
      monthLabel: { nameMap: 'ZH', color: C.value.ink, fontSize: 11 },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data }],
  };
});

const maxProject = computed(() => Math.max(1, ...(s.value?.breakdown.projects || []).map((p) => p.minutes)));
const tableCols = [
  { title: '日期', key: 'date', render: (r) => fmtDate(r.date) },
  { title: '类型', key: 'kind', render: (r) => ({ work: '工作日', rest: '休息', leave: '请假' })[r.kind] },
  { title: '打卡', key: 'checkin', render: (r) => (r.checkin ? '✓' : '') },
  { title: '记录工时', key: 'minutes', render: (r) => fmtMin(r.minutes) },
  { title: '计划任务', key: 'tasks', render: (r) => `${r.doneCount}/${r.plannedCount}` },
  { title: '计划外', key: 'unplannedDone' },
  { title: '执行评分', key: 'score', render: (r) => r.score.score ?? '—' },
];
</script>

<template>
  <div class="page">
    <div class="page-head">
      <NRadioGroup v-model:value="range" size="small"><NRadioButton value="day">日</NRadioButton><NRadioButton value="week">周</NRadioButton><NRadioButton value="month">月</NRadioButton></NRadioGroup>
      <NButton quaternary size="small" @click="shift(-1)">‹</NButton>
      <b>{{ label }}</b>
      <NButton quaternary size="small" @click="shift(1)">›</NButton>
      <NButton size="small" secondary @click="date = store.today">回到今天</NButton>
      <span class="grow" />
      <span class="muted small">评分衡量的是计划执行，不是科研能力</span>
    </div>

    <template v-if="s && kpi">
      <div class="tiles">
        <div class="tile"><div class="k">记录工时</div><div class="v">{{ fmtHours(kpi.total) }}</div><div class="muted small">计时时长，不代表一直专注</div></div>
        <div class="tile" v-if="range !== 'day'"><div class="k">工作日日均</div><div class="v">{{ fmtHours(kpi.avg) }}</div><div class="muted small">{{ kpi.work }} 个工作日</div></div>
        <div class="tile"><div class="k">计划任务完成</div><div class="v">{{ kpi.done }}<span class="unit">/ {{ kpi.planned }}</span></div><div class="muted small">计划外另完成 {{ kpi.unplanned }} 项</div></div>
        <div class="tile" v-if="range !== 'day'"><div class="k">打卡</div><div class="v">{{ kpi.checkin }}<span class="unit">/ {{ kpi.work }}</span></div><div class="muted small">休息、请假不计</div></div>
      </div>

      <div class="grid-2" style="margin-top: 14px">
        <div>
          <template v-if="range !== 'day'">
            <div class="card">
              <div class="card-title"><h3>每天记录工时</h3><NButton size="tiny" quaternary @click="showTable = !showTable">{{ showTable ? '看图' : '看表格' }}</NButton></div>
              <NDataTable v-if="showTable" :columns="tableCols" :data="dayRows" size="small" />
              <VChart v-else-if="hoursOption" :option="hoursOption" autoresize style="height: 240px" />
            </div>
            <div class="card">
              <div class="card-title"><h3>每天执行评分</h3><span class="muted small">没有计划任务的日子不评分（断开）</span></div>
              <VChart v-if="scoreOption" :option="scoreOption" autoresize style="height: 200px" />
              <Empty v-else text="这段时间还没有可以评分的日子" />
            </div>
          </template>
          <div v-else class="card">
            <div class="card-title"><h3>这一天的计时</h3></div>
            <Empty v-if="!s.sessions.length" text="这一天没有计时记录" />
            <div v-for="x in s.sessions" :key="x.id" class="row sess">
              <span class="mono muted">{{ fmtTime(x.start_at) }}–{{ x.end_at ? fmtTime(x.end_at) : '进行中' }}</span>
              <span class="grow">{{ x.task_title || x.label || '未命名' }}</span>
              <span v-if="x.project_name" class="pill eeyore">{{ x.project_name }}</span>
              <span class="muted small">{{ fmtMin(((x.end_at ? Date.parse(x.end_at) : Date.now()) - Date.parse(x.start_at)) / 60000) }}</span>
            </div>
          </div>

          <div class="card">
            <div class="card-title"><h3>时间花在哪</h3><span class="muted small">同一段时间只算一次，按计时记录的主关联归属</span></div>
            <Empty v-if="!s.breakdown.total" text="还没有计时记录" />
            <template v-else>
              <div class="sub">项目</div>
              <div v-for="p in s.breakdown.projects" :key="p.key" class="hbar">
                <span class="name ellipsis">{{ p.label }}</span>
                <span class="track"><span class="fill" :style="{ width: (p.minutes / maxProject) * 100 + '%' }" /></span>
                <span class="val">{{ fmtMin(p.minutes) }}</span>
              </div>
              <div class="cols">
                <div>
                  <div class="sub">论文</div>
                  <div v-if="!s.breakdown.papers.length" class="muted small">—</div>
                  <div v-for="p in s.breakdown.papers" :key="p.key" class="row small line"><span class="grow ellipsis">{{ p.label }}</span><span class="muted">{{ fmtMin(p.minutes) }}</span></div>
                </div>
                <div>
                  <div class="sub">任务</div>
                  <div v-for="p in s.breakdown.tasks" :key="p.key" class="row small line"><span class="grow ellipsis">{{ p.label }}</span><span class="muted">{{ fmtMin(p.minutes) }}</span></div>
                </div>
              </div>
              <template v-if="s.breakdown.ideas.length">
                <div class="sub">Idea</div>
                <div v-for="p in s.breakdown.ideas" :key="p.key" class="row small line"><span class="grow ellipsis">{{ p.label }}</span><span class="muted">{{ fmtMin(p.minutes) }}</span></div>
              </template>
            </template>
          </div>
        </div>

        <div>
          <div class="card">
            <ScoreCard :score="range === 'day' ? s.days[0].score : s.score" :title="range === 'day' ? '当日执行' : range === 'week' ? '本周执行' : '本月执行'" :due-by-today="s.score?.dueByToday" />
          </div>
          <div v-if="range === 'week' && s.weeks[0] && (s.weeks[0].conclusions || s.weeks[0].ruled_out || s.weeks[0].open_questions)" class="card">
            <div class="card-title"><h3>本周结论</h3></div>
            <div v-if="s.weeks[0].conclusions" class="small"><b>得到的结论</b><div class="pre">{{ s.weeks[0].conclusions }}</div></div>
            <div v-if="s.weeks[0].ruled_out" class="small"><b>排除的假设</b><div class="pre">{{ s.weeks[0].ruled_out }}</div></div>
            <div v-if="s.weeks[0].open_questions" class="small"><b>仍未解决</b><div class="pre">{{ s.weeks[0].open_questions }}</div></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 14px">
        <div class="card-title"><h3>最近半年</h3><span class="muted small">每天的记录工时</span></div>
        <VChart v-if="heatOption" :option="heatOption" autoresize style="height: 180px; min-width: 640px" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.tile { background: var(--card); border: 1px solid var(--line-card); border-radius: var(--radius); padding: 20px 22px; box-shadow: var(--shadow); }
.tile .k { font-size: 13px; color: var(--ink-2); }
.tile .v { font-size: 30px; font-weight: 600; color: var(--ink); margin: 2px 0; }
.tile .unit { font-size: 15px; color: var(--ink-3); font-weight: normal; margin-left: 4px; }
.sub { font-size: 12.5px; color: var(--ink-3); margin: 12px 0 6px; }
.hbar { display: grid; grid-template-columns: 130px 1fr 90px; gap: 10px; align-items: center; font-size: 13px; margin: 5px 0; }
.track { height: 12px; background: var(--track); border-radius: 0 4px 4px 0; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--accent); border-radius: 0 4px 4px 0; }
.val { text-align: right; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.line { padding: 3px 0; border-bottom: 1px dashed var(--line-soft); }
.sess { padding: 6px 0; border-bottom: 1px dashed var(--line-soft); }
.pre { white-space: pre-wrap; margin: 2px 0 8px; }
.card:has(> .echarts) { overflow-x: auto; }
@media (max-width: 640px) { .cols { grid-template-columns: 1fr; } .hbar { grid-template-columns: 90px 1fr 70px; } }
</style>
