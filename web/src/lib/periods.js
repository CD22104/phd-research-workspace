// 日任务的粗略时段：上午（12 点前）/ 下午（12–18 点）/ 晚上（18 点后）。与 server/routes/planning.ts 的 periodOfMinute 保持一致。
export const PERIODS = [
  { key: 'morning', label: '上午', range: '12 点前', from: 0, to: 720 },
  { key: 'afternoon', label: '下午', range: '12–18 点', from: 720, to: 1080 },
  { key: 'evening', label: '晚上', range: '18 点后', from: 1080, to: 1440 },
];
export const PERIOD_LABEL = { morning: '上午', afternoon: '下午', evening: '晚上' };
export const GOAL_TASK_DRAG_TYPE = 'application/x-honey-goal-task';

export const periodOfMinute = (m) => (m < 720 ? 'morning' : m < 1080 ? 'afternoon' : 'evening');

/** 'HH:MM' → 时段；全天或格式不对返回 null */
export function periodOfTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return periodOfMinute(h * 60 + m);
}

/** 工作区时区里的当前时段 */
export function currentPeriod(zone = 'Asia/Singapore', now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return periodOfMinute(Number(parts.hour) * 60 + Number(parts.minute));
}

/** 日程按开始时间分到时段；全天安排单独放 */
export function eventsByPeriod(events = []) {
  const out = { allDay: [], morning: [], afternoon: [], evening: [] };
  for (const e of [...events].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '') || a.id - b.id)) {
    const p = e.all_day ? null : periodOfTime(e.start_time);
    (p ? out[p] : out.allDay).push(e);
  }
  return out;
}

/** 从拖拽数据里读出来源：周子任务（安排）或已有日任务（移动） */
export function readPlanDrag(e, dayTaskType) {
  const types = [...(e.dataTransfer?.types || [])];
  const goal = types.includes(GOAL_TASK_DRAG_TYPE) ? Number(e.dataTransfer.getData(GOAL_TASK_DRAG_TYPE)) : null;
  if (goal) return { kind: 'goal-task', id: goal };
  const task = types.includes(dayTaskType) ? Number(e.dataTransfer.getData(dayTaskType)) : null;
  if (task) return { kind: 'task', id: task };
  try {
    const plain = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (plain?.goal_task_id) return { kind: 'goal-task', id: Number(plain.goal_task_id) };
    if (plain?.task_id) return { kind: 'task', id: Number(plain.task_id) };
  } catch { /* 不是我们的拖拽 */ }
  return null;
}
export const acceptsPlanDrag = (e, dayTaskType) => [...(e.dataTransfer?.types || [])].some((t) => t === GOAL_TASK_DRAG_TYPE || t === dayTaskType);
