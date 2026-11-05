// 日期工具：所有「哪一天」的判断都按用户时区（settings.timezone）来算。
// 本地日期统一用 'YYYY-MM-DD' 字符串；时间点统一用 UTC ISO 字符串。

const DAY_MS = 86_400_000;

export function nowIso(): string {
  return new Date().toISOString();
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function zonedParts(ms: number, tz: string) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** 该时刻在 tz 中相对 UTC 的偏移（毫秒）。 */
function tzOffset(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** 时间点（ISO 或毫秒）在 tz 中的本地日期。 */
export function localDate(t: string | number | Date, tz: string): string {
  const ms = typeof t === 'number' ? t : new Date(t).getTime();
  const p = zonedParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function todayLocal(tz: string): string {
  return localDate(Date.now(), tz);
}

/** 本地日期 00:00 对应的 UTC 毫秒。 */
export function localMidnightMs(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let ms = guess - tzOffset(guess, tz);
  // 夏令时切换日再校正一次
  ms = guess - tzOffset(ms, tz);
  return ms;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function addDays(date: string, n: number): string {
  const ms = Date.parse(date + 'T00:00:00Z') + n * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** 1 = 周一 … 7 = 周日 */
export function weekday(date: string): number {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

export function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date));
}

export function monthStart(date: string): string {
  return date.slice(0, 8) + '01';
}

export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(last)}`;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** ISO 周编号，例如 2026-W39 */
export function isoWeekLabel(date: string): string {
  const thursday = addDays(weekStart(date), 3);
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week1 = weekStart(jan4);
  const n = Math.round((Date.parse(thursday) - Date.parse(addDays(week1, 3))) / (7 * DAY_MS)) + 1;
  return `${year}-W${pad(n)}`;
}

/**
 * 把一段时间 [startMs, endMs) 按本地日期拆开，返回 {date: 分钟数}。
 * 跨零点的计时会自动分到两天。
 */
export function splitByLocalDay(startMs: number, endMs: number, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!(endMs > startMs)) return out;
  let cur = startMs;
  let guard = 0;
  while (cur < endMs && guard++ < 400) {
    const d = localDate(cur, tz);
    const next = localMidnightMs(addDays(d, 1), tz);
    const segEnd = Math.min(next, endMs);
    out[d] = (out[d] || 0) + (segEnd - cur) / 60000;
    cur = segEnd;
  }
  return out;
}
