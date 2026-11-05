// 计时操作：开始（已有计时则询问是否切换）、停止、同步
import { api } from './api';
import { store, changed } from './store';
import { confirm, fail, toast } from './ui';

export async function syncTimer() {
  try {
    const r = await api.get('/timer');
    store.running = r.running;
    if (r.background) store.background = r.background;
  } catch {
    /* 离线时保留本地状态 */
  }
}

export async function startTimer(payload) {
  try {
    const r = await api.post('/timer/start', payload);
    store.running = r.running;
    if (r.background) store.background = r.background;
    if (!r.already) toast(`开始计时：${r.running?.label || '未命名'}`);
    changed();
  } catch (e) {
    if (e.status === 409 && e.data?.running) {
      const cur = e.data.running;
      const ok = await confirm('切换计时？', `正在计时「${cur.label || cur.task_title || '未命名'}」，要停止它并开始新的计时吗？`, '切换');
      if (!ok) return;
      try {
        const r = await api.post('/timer/start', { ...payload, switch: true });
        store.running = r.running;
    if (r.background) store.background = r.background;
        toast('已切换计时');
        changed();
      } catch (e2) {
        fail(e2);
      }
    } else fail(e);
  }
}

export async function stopTimer(opts = {}) {
  try {
    const r = await api.post('/timer/stop', { session_id: store.running?.id, ...opts });
    store.running = r.running || null;
    if (r.stopped && !r.already) {
      const min = Math.round((r.stopped.elapsed_ms ?? (Date.parse(r.stopped.end_at) - Date.parse(r.stopped.start_at))) / 60000);
      toast(`记录了 ${min} 分钟`);
    }
    changed();
  } catch (e) {
    fail(e);
  }
}

export function isRunning(match) {
  const r = store.running;
  if (!r || r.paused) return false;
  return Object.entries(match).every(([k, v]) => r[k] === v);
}

export function timerElapsed(r, now = Date.now()) {
  if (!r) return 0;
  return (r.elapsed_before_ms || 0) + (r.paused ? 0 : Math.max(0, now - Date.parse(r.start_at)));
}
export async function pauseTimer() {
  try { const r=await api.post('/timer/pause',{session_id:store.running?.id});store.running=r.running;changed(); }
  catch(e){fail(e);}
}
export async function resumeTimer() {
  try { const r=await api.post('/timer/resume',{session_id:store.running?.id});store.running=r.running;changed(); }
  catch(e){fail(e);}
}
