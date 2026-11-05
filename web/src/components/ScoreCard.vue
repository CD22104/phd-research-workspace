<script setup>
// 执行评分卡：分项和依据都展示出来；可以关掉等级显示
import { NProgress, NTooltip } from 'naive-ui';
import { store } from '../lib/store';
defineProps({ score: { type: Object, default: null }, title: { type: String, default: '执行评分' }, dueByToday: { type: Object, default: null }, compact: { type: Boolean, default: false } });
const statusText = { final: '最终评分', in_progress: '进行中 · 当前累计', none: '暂不评分' };
</script>

<template>
  <div class="score" :class="{ compact }">
    <div class="score-value"><strong>{{ score?.score ?? "—" }}</strong><span v-if="score?.grade && store.settings?.show_grades !== false">{{ score.grade }}</span><span v-else>执行评分</span></div>
    <div class="grow">
      <div class="row">
        <b style="font-family: var(--font-cute); font-size: 16px">{{ title }}</b>
        <span class="pill" :class="{ leaf: score?.status === 'final', sky: score?.status === 'in_progress' }">{{ statusText[score?.status || 'none'] }}</span>
        <NTooltip v-if="score?.version">
          <template #trigger><span class="muted small">公式 v{{ score.version }}</span></template>
          评分衡量的是计划执行情况，不代表科研能力。修改权重会生成新版本，不影响历史分数。
        </NTooltip>
      </div>
      <div v-if="score?.reason" class="muted small" style="margin-top: 6px">{{ score.reason }}</div>
      <div v-for="p in score?.parts || []" :key="p.key" class="part">
        <div class="row small"><span>{{ p.label }}</span><span class="muted">占 {{ p.weight }}%</span><span class="grow" /><b>{{ p.points }}</b></div>
        <NProgress type="line" :percentage="Math.round(p.ratio * 100)" :show-indicator="false" :height="6" />
        <div class="muted small">{{ p.detail }}</div>
      </div>
      <div v-if="dueByToday && dueByToday.due" class="small" style="margin-top: 6px">截至今天应完成 {{ dueByToday.due }} 个目标，已完成 {{ dueByToday.done }} 个</div>
      <div v-for="n in score?.notes || []" :key="n" class="muted small" style="margin-top: 4px">· {{ n }}</div>
    </div>
  </div>
</template>

<style scoped>
.score-value { min-width: 66px; display: flex; flex-direction: column; align-items: center; color: var(--honey-deep); }
.score-value strong { font-size: 36px; font-weight: 500; line-height: 1.2; font-variant-numeric: tabular-nums; }
.score-value span { font-size: 11px; color: var(--ink-3); margin-top: 6px; }
.score { display: flex; gap: 16px; align-items: flex-start; }
.part { margin-top: 8px; }
.compact .part { margin-top: 5px; }
</style>
