<script setup>
// 全局计时条：显示正在进行的计时，跨设备同步（每 30 秒、切回页面时）
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { NButton, NPopover, NInput, NDatePicker } from 'naive-ui';
import { store } from '../lib/store';
import { stopTimer, syncTimer, pauseTimer, resumeTimer, timerElapsed } from '../lib/timer';
import { fmtClock, fmtTime } from '../lib/format';

const now = ref(Date.now());
const note = ref('');
const endAt = ref(null);
let tick;
const onFocus = () => syncTimer();
onMounted(() => {
  tick = setInterval(() => (now.value = Date.now()), 1000);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
});
onUnmounted(() => {
  clearInterval(tick);
  window.removeEventListener('focus', onFocus);
  document.removeEventListener('visibilitychange', onFocus);
});
const elapsed = computed(() => timerElapsed(store.running,now.value));
const long = computed(() => elapsed.value > 10 * 3600 * 1000);
const label = computed(() => store.running?.label || store.running?.task_title || '计时中');
async function stop() {
  await stopTimer({ note: note.value || undefined, end_at: endAt.value ? new Date(endAt.value).toISOString() : undefined });
  note.value = '';
  endAt.value = null;
}
</script>

<template>
  <NPopover v-if="store.running" trigger="click" placement="bottom-end" :width="300">
    <template #trigger>
      <button class="chip" :class="{ long }" :title="label">
        <span class="timer-dot" aria-hidden="true"></span>
        <span class="lbl ellipsis">{{ label }}</span>
        <span v-if="store.running.paused" class="small">暂停</span><span v-if="store.background.length" class="small">后台 {{ store.background.length }}</span><span class="clock mono">{{ fmtClock(elapsed) }}</span>
      </button>
    </template>
    <div>
      <div class="small muted">{{ fmtTime(store.running.start_at) }} 开始 · 个人工作计时</div>
      <div v-if="long" class="small" style="color: var(--berry); margin-top: 6px">已经计时超过 10 小时，是不是忘记停止了？可以在下面设置实际结束时间。</div>
      <NInput v-model:value="note" size="small" placeholder="备注（可选）" style="margin-top: 8px" />
      <NDatePicker v-if="long" v-model:value="endAt" type="datetime" size="small" clearable placeholder="实际结束时间（可选）" style="margin-top: 8px; width: 100%" />
      <NButton secondary block style="margin-top:10px" @click="store.running.paused?resumeTimer():pauseTimer()">{{store.running.paused?'继续计时':'暂停计时'}}</NButton>
      <NButton type="primary" block style="margin-top: 10px" @click="stop">⏹ 停止并保存</NButton>
    </div>
  </NPopover>
</template>

<style scoped>
.chip {
  display: inline-flex; align-items: center; gap: 8px; max-width: 320px; border: 1px solid var(--line); cursor: pointer;
  background: var(--charcoal); color: var(--text-on-dark); border-radius: 20px; padding: 5px 12px 5px 8px;
  box-shadow: none; font-size: 13.5px;
}
.chip.long { background: var(--danger-deep); border-color: var(--danger-deep); }
.timer-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--sand); }
.lbl { max-width: 170px; }
.clock { font-weight: 600; }
@media (max-width: 640px) { .lbl { max-width: 90px; } }
</style>
