// Calendar times are local HH:mm values; merge overlaps rather than double-counting them.
export const scheduleLabels = { meeting: '会议', course: '课程', checkin: '打卡', break: '休息', other: '其他' };
function minute(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
export function summarizeSchedule(events = []) {
  const intervals = events.filter(e => !e.all_day).map(e => [minute(e.start_time), minute(e.end_time)])
    .filter(([s, e]) => s != null && e != null && e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];let overlap = false;
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      if (start < last[1]) overlap = true;
      last[1] = Math.max(last[1], end);
    } else merged.push([start, end]);
  }
  return { minutes: merged.reduce((sum, [s, e]) => sum + e - s, 0), allDay: events.filter(e => e.all_day).length, overlap };
}
export function sortedSchedule(events = []) {
  return [...events].sort((a, b) => Number(!!b.all_day) - Number(!!a.all_day) || (a.start_time || '').localeCompare(b.start_time || '') || a.id - b.id);
}
