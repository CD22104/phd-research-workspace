import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, getSettings, idParam, insert, notFound, remove, stmt, update } from '../db';
import { addDays, isDate, nowIso, todayLocal } from '../lib/time';
import { dayKind } from '../lib/stats';
import { body } from './planning';

const FIELDS = ['date', 'title', 'kind', 'all_day', 'start_time', 'end_time', 'location', 'note'];
const KINDS = ['meeting', 'course', 'checkin', 'break', 'other'];

function calendarDate(value: unknown): string {
  if (!isDate(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw bad('日期必须是有效的 YYYY-MM-DD');
  return value;
}
function textField(value: unknown, name: string, max: number, required = false): string | null {
  if (value == null || value === '') {
    if (required) throw bad(`${name}不能为空`);
    return null;
  }
  if (typeof value !== 'string') throw bad(`${name}必须是文字`);
  const text = value.trim();
  if (required && !text) throw bad(`${name}不能为空`);
  if (text.length > max) throw bad(`${name}最多${max}个字`);
  return text || null;
}
function eventData(input: Record<string, any>): Record<string, any> {
  const allDay = input.all_day ?? false;
  if (![true, false, 0, 1].includes(allDay)) throw bad('全天标记只能是 true / false');
  const row: Record<string, any> = {
    date: calendarDate(input.date), title: textField(input.title, '日程名称', 200, true),
    kind: input.kind ?? 'meeting', all_day: allDay ? 1 : 0,
    location: textField(input.location, '地点', 300), note: textField(input.note, '备注', 5000),
    start_time: null, end_time: null,
  };
  if (!KINDS.includes(row.kind)) throw bad('日程类型只能是 meeting / course / checkin / break / other');
  if (!row.all_day) {
    const valid = (v: unknown) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (!valid(input.start_time) || !valid(input.end_time)) throw bad('请填写开始和结束时间，格式为 HH:mm');
    if (input.end_time <= input.start_time) throw bad('结束时间必须晚于开始时间；跨天安排请分成两天');
    row.start_time = input.start_time;
    row.end_time = input.end_time;
  }
  return row;
}
function sameEvent(a: Record<string, any>, b: Record<string, any>) {
  return FIELDS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

type Recurrence = { frequency: 'daily' | 'weekly'; interval: number; weekdays: number[]; until: string };
function repeatDates(input: any, start: string): { rule: Recurrence | null; dates: string[] } {
  if (input == null) return { rule: null, dates: [start] };
  if (!input || typeof input !== 'object' || !['daily', 'weekly'].includes(input.frequency)) throw bad('重复类型只能是每天或每周');
  const interval = input.interval ?? 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) throw bad('重复间隔应为 1–12');
  const until = calendarDate(input.until);
  const span = (Date.parse(until) - Date.parse(start)) / 86400000;
  if (span < 0 || span > 730) throw bad('重复截止日期应在首次日期起两年内');
  const weekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay() || 7;
  if (input.weekdays != null && !Array.isArray(input.weekdays)) throw bad('重复星期应为数组');
  const weekdays: number[] = input.frequency === 'daily' ? [] : [...new Set<number>(input.weekdays ?? [weekday(start)])].sort();
  if (input.frequency === 'weekly' && (!Array.isArray(input.weekdays ?? []) || !weekdays.length || weekdays.some(n => !Number.isInteger(n) || n < 1 || n > 7) || !weekdays.includes(weekday(start)))) throw bad('请选择星期几，且包含首次日期所在的星期');
  const dates: string[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    if (input.frequency === 'daily' ? i % interval === 0 : Math.floor((i + weekday(start) - 1) / 7) % interval === 0 && weekdays.includes(weekday(date))) dates.push(date);
  }
  if (dates.length > 366) throw bad('一次最多创建 366 次安排，请缩短截止日期');
  return { rule: { frequency: input.frequency, interval, weekdays, until }, dates };
}
function scopeOf(value: unknown) {
  if (value != null && value !== 'single' && value !== 'following') throw bad('修改范围只能是本次或本次及以后');
  return value ?? 'single';
}
async function occurrences(db: D1Database, event: any, scope: unknown) {
  return scope === 'following' && event.series_id
    ? all(db, 'SELECT * FROM schedule_events WHERE series_id = ? AND date >= ? ORDER BY date,id', event.series_id, event.date)
    : [event];
}

export function registerCalendar(app: App) {
  app.get('/calendar', async (c) => {
    const ctx = c.get('ctx');
    const from = calendarDate(c.req.query('from') ?? todayLocal(ctx.tz));
    const to = calendarDate(c.req.query('to') ?? from);
    const span = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (span < 0 || span > 92) throw bad('日程查询范围应为1至93天，结束日期不能早于开始日期');
    const [events, overrides, settings] = await Promise.all([
      all(ctx.db, 'SELECT * FROM schedule_events WHERE date BETWEEN ? AND ? ORDER BY date, all_day DESC, start_time, id', from, to),
      all(ctx.db, 'SELECT date, kind FROM days WHERE date BETWEEN ? AND ?', from, to),
      getSettings(ctx.db),
    ]);
    const byDate = new Map(overrides.map((d: any) => [d.date, d.kind]));
    const days = Array.from({ length: span + 1 }, (_, index) => addDays(from, index)).map((date) => ({
      date, kind: dayKind(date, { kind: byDate.get(date) }, settings),
      explicit_kind: byDate.get(date) || null,
    }));
    return json(c, { from, to, timezone: ctx.tz, today: todayLocal(ctx.tz), events, days });
  });

  app.post('/calendar/events', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const row = eventData(b);
    const repeat = repeatDates(b.recurrence, row.date);
    const recurrence = repeat.rule ? JSON.stringify(repeat.rule) : null;
    const same = (event: any) => sameEvent(event, row) && (event.recurrence ?? null) === recurrence;
    const key = textField(b.client_key, '重试标识', 128);
    if (key && !/^[a-zA-Z0-9_-]+$/.test(key)) throw bad('重试标识格式不正确');
    if (key) {
      const previous = await first(ctx.db, 'SELECT * FROM schedule_events WHERE client_key = ?', key);
      if (previous) {
        if (!same(previous)) throw conflict('这个重试标识已用于另一份日程内容，请刷新查看已保存的安排');
        return json(c, { ...previous, replayed: true });
      }
    }
    let id: number;
    try {
      if (repeat.rule) {
        const series = crypto.randomUUID(), ts = nowIso();
        const cols = [...FIELDS, 'client_key', 'series_id', 'recurrence', 'created_at', 'updated_at'];
        const results = await ctx.db.batch(repeat.dates.map((date, index) => stmt(ctx.db,
          `INSERT INTO schedule_events(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
          ...FIELDS.map(field => field === 'date' ? date : row[field]), index === 0 ? key : null, series, recurrence, ts, ts)));
        id = Number(results[0].meta.last_row_id);
      } else id = await insert(ctx, 'schedule_events', { ...row, client_key: key });
    } catch (error) {
      // 两次并发保存由唯一约束兜底，网络重试不会重复创建。
      if (key) {
        const previous = await first(ctx.db, 'SELECT * FROM schedule_events WHERE client_key = ?', key);
        if (previous && same(previous)) return json(c, { ...previous, replayed: true });
        if (previous) throw conflict('这个重试标识已用于另一份日程内容');
      }
      throw error;
    }
    return json(c, await first(ctx.db, 'SELECT * FROM schedule_events WHERE id = ?', id), 201);
  });

  app.patch('/calendar/events/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const current = await first(ctx.db, 'SELECT * FROM schedule_events WHERE id = ?', id);
    if (!current) throw notFound('日程');
    const b = await body(c);
    if ('client_key' in b && b.client_key !== current.client_key) throw bad('不能修改日程的重试标识');
    if ('recurrence' in b) throw bad('已有日程的重复规则不能直接修改；可删除本次及以后，再按新规则创建');
    const scope = scopeOf(b.scope);
    if (scope === 'following' && b.date && b.date !== current.date) throw bad('批量修改保留原日期；改日期请选择仅本次');
    const affected = await occurrences(ctx.db, current, scope);
    const incoming = Object.fromEntries(FIELDS.filter((k) => k in b).map((k) => [k, b[k]]));
    const row = eventData({ ...current, ...incoming });
    if (ctx.actor !== 'web' && affected.some(event => !sameEvent(event, { ...row, date: scope === 'following' ? event.date : row.date })) && b.confirm !== true) {
      throw conflict('修改日程需要确认：请查看预览后带 confirm: true 提交', { needs_confirm: true, preview: { before: current, after: row, scope, affected: affected.length } });
    }
    if (scope === 'following' && current.series_id) {
      const ts = nowIso();
      await ctx.db.batch(affected.flatMap(event => [
        stmt(ctx.db, `UPDATE schedule_events SET title=?,kind=?,all_day=?,start_time=?,end_time=?,location=?,note=?,updated_at=? WHERE id=?`, row.title,row.kind,row.all_day,row.start_time,row.end_time,row.location,row.note,ts,event.id),
        stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,created_at) VALUES('schedule_event',?,'update','event',?,?,?,?)`, event.id,JSON.stringify(event),JSON.stringify({...event,...row,date:event.date}),ctx.actor,ts),
      ]));
    } else await update(ctx, 'schedule_events', id, row);
    return json(c, await first(ctx.db, 'SELECT * FROM schedule_events WHERE id = ?', id));
  });

  app.delete('/calendar/events/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const event = await first(ctx.db, 'SELECT * FROM schedule_events WHERE id = ?', id);
    if (!event) throw notFound('日程');
    const scope = scopeOf(c.req.query('scope'));
    const affected = await occurrences(ctx.db, event, scope);
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除日程需要确认', { needs_confirm: true, preview: { delete_event: event, scope, affected: affected.length } });
    if (scope === 'following' && event.series_id) {
      const ts = nowIso();
      await ctx.db.batch(affected.flatMap(item => [
        stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,old,actor,created_at) VALUES('schedule_event',?,'delete',?,?,?)`, item.id,JSON.stringify(item),ctx.actor,ts),
        stmt(ctx.db, 'DELETE FROM schedule_events WHERE id = ?', item.id),
      ]));
    } else await remove(ctx, 'schedule_events', id);
    return json(c, { ok: true, deleted: event });
  });
}
