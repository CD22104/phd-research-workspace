// 统计：按本地日期汇总任务、计时和打卡，再交给评分规则。
import { all, getSettings, scoringFor, type Ctx, type Settings } from '../db';
import { addDays, daysBetween, localMidnightMs, splitByLocalDay, weekday, weekStart, monthStart, monthEnd, todayLocal } from './time';
import { scoreDay, scorePeriod, type Score } from './scoring';

export interface DayAgg {
  date: string;
  kind: string;
  checkin: boolean;
  reviewed: boolean;
  mood: number | null;
  energy: number | null;
  targetMinutes: number;
  plannedPoints: number;
  donePoints: number;
  plannedCount: number;
  doneCount: number;
  droppedCount: number;
  movedCount: number;
  unplannedDone: number;
  unplannedCount: number;
  minutes: number;
  goalMinutes: number;       // 花在挂了周目标的任务上的分钟
  byProject: Record<string, number>;
  score: Score;
}

export interface SessionRow {
  id: number; task_id: number | null; project_id: number | null; paper_id: number | null; idea_id: number | null; plan_id: number | null;
  label: string | null; start_at: string; end_at: string | null; goal_id: number | null; task_title: string | null;
  paper_title: string | null; idea_title: string | null; project_name: string | null; note: string | null; source: string;
}

export async function sessionsBetween(ctx: Ctx, from: string, to: string): Promise<SessionRow[]> {
  const startIso = new Date(localMidnightMs(from, ctx.tz)).toISOString();
  const endIso = new Date(localMidnightMs(addDays(to, 1), ctx.tz)).toISOString();
  return all<SessionRow>(ctx.db, `
    SELECT s.id, s.task_id, s.paper_id, s.plan_id, s.idea_id, s.label, s.start_at, s.end_at, s.note, s.source,
           t.goal_id, t.title AS task_title, p.title AS paper_title, i.title AS idea_title,
           COALESCE(pr.name, gp.name) AS project_name, COALESCE(s.project_id, t.project_id, g.project_id) AS project_id
    FROM sessions s
    LEFT JOIN tasks t ON t.id = s.task_id
    LEFT JOIN goals g ON g.id = t.goal_id
    LEFT JOIN projects gp ON gp.id = COALESCE(t.project_id, g.project_id)
    LEFT JOIN projects pr ON pr.id = s.project_id
    LEFT JOIN papers p ON p.id = s.paper_id
    LEFT JOIN ideas i ON i.id = s.idea_id
    WHERE s.start_at < ? AND (s.end_at IS NULL OR s.end_at > ?)
    ORDER BY s.start_at`, endIso, startIso);
}

export function dayKind(date: string, row: { kind?: string | null } | undefined, s: Settings): string {
  if (row?.kind) return row.kind;
  const versions = [...(s.workday_versions || [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let workdays = s.workdays || [1, 2, 3, 4, 5];
  for (const v of versions) if (v.effective_from <= date) workdays = v.workdays;
  return workdays.includes(weekday(date)) ? 'work' : 'rest';
}

export async function aggregateDays(ctx: Ctx, from: string, to: string, settings?: Settings): Promise<Map<string, DayAgg>> {
  const s = settings || (await getSettings(ctx.db));
  const today = todayLocal(ctx.tz);
  const [dayRows, taskRows, sess] = await Promise.all([
    all(ctx.db, 'SELECT * FROM days WHERE date BETWEEN ? AND ?', from, to),
    all(ctx.db, 'SELECT id, date, goal_id, points, planned, status FROM tasks WHERE date BETWEEN ? AND ?', from, to),
    sessionsBetween(ctx, from, to),
  ]);
  const dayMap = new Map(dayRows.map((d: any) => [d.date, d]));
  const out = new Map<string, DayAgg>();
  for (const date of daysBetween(from, to)) {
    const d: any = dayMap.get(date);
    const kind = dayKind(date, d, s);
    out.set(date, {
      date, kind, checkin: !!d?.checkin_at, reviewed: !!(d?.review && String(d.review).trim()),
      mood: d?.mood ?? null, energy: d?.energy ?? null,
      targetMinutes: d?.target_minutes ?? (kind === 'work' ? s.daily_target_minutes : 0),
      plannedPoints: 0, donePoints: 0, plannedCount: 0, doneCount: 0, droppedCount: 0, movedCount: 0, unplannedDone: 0, unplannedCount: 0,
      minutes: 0, goalMinutes: 0, byProject: {}, score: null as any,
    });
  }
  for (const t of taskRows as any[]) {
    const a = out.get(t.date);
    if (!a) continue;
    const pts = Math.max(1, t.points || 1);
    if (!t.planned) {
      a.unplannedCount++;
      if (t.status === 'done') a.unplannedDone++;
      continue;
    }
    if (t.status === 'dropped') {
      a.droppedCount++;
      continue;
    }
    a.plannedCount++;
    a.plannedPoints += pts;
    if (t.status === 'done') {
      a.doneCount++;
      a.donePoints += pts;
    }
    if (t.status === 'moved') a.movedCount++;
  }
  const nowMs = Date.now();
  for (const x of sess) {
    const end = x.end_at ? Date.parse(x.end_at) : nowMs;
    const parts = splitByLocalDay(Date.parse(x.start_at), end, ctx.tz);
    for (const [date, min] of Object.entries(parts)) {
      const a = out.get(date);
      if (!a) continue;
      a.minutes += min;
      if (x.goal_id) a.goalMinutes += min;
      const key = x.project_name || '未归属项目';
      a.byProject[key] = (a.byProject[key] || 0) + min;
    }
  }
  for (const a of out.values()) {
    const v = scoringFor(s, a.date);
    a.score = scoreDay({ ...a, final: a.date < today }, v.day, { version: v.version, hoursInScore: s.hours_in_score });
    a.minutes = Math.round(a.minutes * 10) / 10;
    a.goalMinutes = Math.round(a.goalMinutes * 10) / 10;
  }
  return out;
}

/** 周期（周 / 月）评分与汇总 */
export async function periodSummary(ctx: Ctx, range: 'week' | 'month', date: string) {
  const s = await getSettings(ctx.db);
  const today = todayLocal(ctx.tz);
  const from = range === 'week' ? weekStart(date) : monthStart(date);
  const to = range === 'week' ? addDays(from, 6) : monthEnd(date);
  const days = await aggregateDays(ctx, from, to, s);

  // 周目标：周以周一为 id；月份取「周四落在本月」的那些周
  let weekIds: string[];
  if (range === 'week') weekIds = [from];
  else {
    weekIds = [];
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
      if (addDays(w, 3).slice(0, 7) === from.slice(0, 7)) weekIds.push(w);
    }
  }
  const ph = weekIds.map(() => '?').join(',') || "''";
  const goals = await all(ctx.db, `SELECT g.*, p.name AS project_name FROM goals g LEFT JOIN projects p ON p.id = g.project_id WHERE g.week_id IN (${ph}) ORDER BY g.week_id, g.sort, g.id`, ...weekIds);
  const weeks = await all(ctx.db, `SELECT * FROM weeks WHERE id IN (${ph})`, ...weekIds);

  let minutes = 0;
  let targetMinutes = 0;
  let targetSoFar = 0;
  let requiredDays = 0;
  let requiredSoFar = 0;
  let checkinDays = 0;
  for (const a of days.values()) {
    minutes += a.minutes;
    targetMinutes += a.targetMinutes;
    if (a.date <= today) targetSoFar += a.targetMinutes;
    if (a.kind === 'work') {
      requiredDays++;
      if (a.date <= today) {
        requiredSoFar++;
        if (a.checkin) checkinDays++;
      }
    }
  }
  // 周计划工时：优先用本周设置的值，其次用设置里的每周默认
  if (range === 'week') {
    const wk: any = weeks[0];
    const wkTarget = wk?.target_minutes ?? s.weekly_target_minutes;
    if (wkTarget != null) {
      const ratio = targetMinutes > 0 ? targetSoFar / targetMinutes : Math.min(1, daysBetween(from, today < to ? today : to).length / 7);
      targetMinutes = wkTarget;
      targetSoFar = Math.round(wkTarget * ratio);
    }
  }
  const final = to < today;
  const v = scoringFor(s, to);
  const score = scorePeriod({
    goals, today, final, minutes, targetMinutes, targetSoFar, requiredDays, requiredSoFar, checkinDays,
  }, v.period, { version: v.version, hoursInScore: s.hours_in_score });

  return { range, from, to, today, final, days: [...days.values()], goals, weeks, minutes: Math.round(minutes), targetMinutes, targetSoFar, score };
}
