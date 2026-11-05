// 执行评分：衡量「计划执行情况」，不是科研能力。纯函数，便于测试。
// 规则：
//  - 完成率按预先设定的工作量点数 / 目标权重计算，拆成很多小任务不会更容易得分
//  - 周 / 月评分直接按本周期目标计算，不混入日评分平均
//  - 工时达成率可选，达到计划值后封顶
//  - 休息 / 请假日不计入应打卡天数；没有目标或没有记录时「暂不评分」，不记零分
//  - 周期未结束时给出「当前累计」和「截至今天应完成」，周期结束后才是最终评分
//  - 心情 / 精力只用于自我观察，不参与计分

export interface Part { key: string; label: string; weight: number; ratio: number; points: number; detail: string }
export interface Score {
  score: number | null;
  grade: string | null;
  status: 'final' | 'in_progress' | 'none';
  reason?: string;          // 暂不评分的原因
  parts: Part[];
  version: number;
  notes: string[];          // 额外说明（计划调整、计划外任务等）
}

export function grade(score: number): string {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const r1 = (x: number) => Math.round(x * 10) / 10;

function combine(items: Array<Omit<Part, 'points'>>): { score: number; parts: Part[] } {
  const total = items.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  const parts = items.map((p) => {
    const ratio = clamp01(p.ratio);
    return { ...p, ratio, weight: r1((Math.max(0, p.weight) / total) * 100), points: r1((Math.max(0, p.weight) / total) * 100 * ratio) };
  });
  return { score: Math.round(parts.reduce((s, p) => s + p.points, 0)), parts };
}

function none(version: number, reason: string, notes: string[] = []): Score {
  return { score: null, grade: null, status: 'none', reason, parts: [], version, notes };
}

export interface DayInput {
  kind: string;              // work / rest / leave
  plannedPoints: number;     // 计划内任务（不含放弃）的点数
  donePoints: number;        // 其中已完成的点数
  plannedCount: number;
  doneCount: number;
  droppedCount: number;      // 计划调整：放弃的计划内任务
  movedCount: number;        // 顺延到之后的任务（算未完成）
  unplannedDone: number;     // 计划外完成的任务数（单独呈现）
  minutes: number;
  targetMinutes: number;
  final: boolean;            // 这一天是否已经过去
}

export interface ScoreOpts { version: number; hoursInScore: boolean }

export function scoreDay(d: DayInput, w: { plan: number; hours: number }, o: ScoreOpts): Score {
  const notes: string[] = [];
  if (d.droppedCount) notes.push(`调整计划：放弃了 ${d.droppedCount} 项`);
  if (d.movedCount) notes.push(`顺延了 ${d.movedCount} 项（计为未完成）`);
  if (d.unplannedDone) notes.push(`计划外完成 ${d.unplannedDone} 项（不计入完成率）`);
  if (d.plannedPoints <= 0) {
    return none(o.version, d.kind === 'work' ? '没有计划任务，暂不评分' : d.kind === 'leave' ? '请假日，不评分' : '休息日，不评分', notes);
  }
  const items: Array<Omit<Part, 'points'>> = [{
    key: 'plan', label: '计划完成', weight: w.plan, ratio: d.donePoints / d.plannedPoints,
    detail: `完成 ${d.doneCount}/${d.plannedCount} 项，点数 ${d.donePoints}/${d.plannedPoints}`,
  }];
  if (o.hoursInScore && d.targetMinutes > 0) {
    items.push({
      key: 'hours', label: '工时达成', weight: w.hours, ratio: d.minutes / d.targetMinutes,
      detail: `记录工时 ${fmtMin(d.minutes)} / 计划 ${fmtMin(d.targetMinutes)}（达到即封顶）`,
    });
  }
  const { score, parts } = combine(items);
  return { score, grade: grade(score), status: d.final ? 'final' : 'in_progress', parts, version: o.version, notes };
}

export interface GoalInput { weight: number; progress: number; status: string; due_date?: string | null }

export function goalRatio(goals: GoalInput[]): number {
  const live = goals.filter((g) => g.status !== 'dropped');
  const wsum = live.reduce((s, g) => s + Math.max(1, g.weight || 1), 0);
  if (!wsum) return 0;
  const got = live.reduce((s, g) => s + Math.max(1, g.weight || 1) * (g.status === 'done' ? 1 : clamp01((g.progress || 0) / 100)), 0);
  return got / wsum;
}

export interface PeriodInput {
  goals: GoalInput[];
  today: string;
  final: boolean;               // 周期是否已结束
  minutes: number;              // 到目前为止的记录工时
  targetMinutes: number;        // 整个周期的计划工时
  targetSoFar: number;          // 截至今天应达到的计划工时
  requiredDays: number;         // 整个周期应打卡的工作日数（不含休息 / 请假）
  requiredSoFar: number;        // 截至今天应打卡的工作日数
  checkinDays: number;          // 已打卡的应打卡日数
}

export function scorePeriod(p: PeriodInput, w: { goals: number; hours: number; checkin: number }, o: ScoreOpts): Score & { dueByToday: { due: number; done: number } } {
  const live = p.goals.filter((g) => g.status !== 'dropped');
  const due = live.filter((g) => g.due_date && g.due_date <= p.today);
  const dueByToday = { due: due.length, done: due.filter((g) => g.status === 'done').length };
  const notes: string[] = [];
  const dropped = p.goals.length - live.length;
  if (dropped) notes.push(`调整计划：放弃了 ${dropped} 个目标`);
  if (!live.length) return { ...none(o.version, '本周期没有设定目标，暂不评分', notes), dueByToday };

  const doneGoals = live.filter((g) => g.status === 'done').length;
  const gr = goalRatio(p.goals);
  const items: Array<Omit<Part, 'points'>> = [{
    key: 'goals', label: '目标完成', weight: w.goals, ratio: gr,
    detail: `${doneGoals}/${live.length} 个目标已完成；按权重和进度累计 ${Math.round(gr * 100)}%`,
  }];
  const hoursTarget = p.final ? p.targetMinutes : p.targetSoFar;
  if (o.hoursInScore && hoursTarget > 0) {
    items.push({
      key: 'hours', label: '工时达成', weight: w.hours, ratio: p.minutes / hoursTarget,
      detail: `记录工时 ${fmtMin(p.minutes)} / ${p.final ? '计划' : '截至今天应有'} ${fmtMin(hoursTarget)}（达到即封顶）`,
    });
  }
  const req = p.final ? p.requiredDays : p.requiredSoFar;
  if (req > 0) {
    items.push({
      key: 'checkin', label: '打卡', weight: w.checkin, ratio: p.checkinDays / req,
      detail: `${p.checkinDays}/${req} 个应打卡日已打卡（休息、请假不计）`,
    });
  }
  const { score, parts } = combine(items);
  if (!p.final) notes.unshift('周期进行中：这是当前累计，不是最终评分');
  return { score, grade: grade(score), status: p.final ? 'final' : 'in_progress', parts, version: o.version, notes, dueByToday };
}

export function fmtMin(m: number): string {
  const mm = Math.round(m);
  const h = Math.floor(mm / 60);
  const r = mm % 60;
  if (!h) return `${r} 分钟`;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}
