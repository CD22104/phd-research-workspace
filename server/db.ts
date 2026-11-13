// D1 访问与变更记录。所有写入都走这里，网页 / MCP / 脚本共用同一套规则。
import { nowIso } from './lib/time';
import { safeJson } from './lib/papers';

export interface Env {
  DB: D1Database;
  TIMEZONE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAILS?: string;
  SERVICE_TOKEN_IDS?: string;
  DEV_NO_AUTH?: string;
  FEED_MCP_ORIGIN?: string;
  FEED_OAUTH_SECRET?: string;
  LLM_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export type Actor = 'web' | 'mcp' | 'api' | 'script' | 'import' | 'system';

export interface Ctx {
  db: D1Database;
  env: Env;
  actor: Actor;
  who?: string;
  tz: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

export const bad = (msg: string, data?: unknown) => new HttpError(400, msg, data);
export const notFound = (what = '记录') => new HttpError(404, `${what}不存在`);
export const conflict = (msg: string, data?: unknown) => new HttpError(409, msg, data);

export async function all<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params.map(clean)).all<T>();
  return r.results || [];
}

export async function first<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params.map(clean)).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params.map(clean)).run();
}

export function stmt(db: D1Database, sql: string, ...params: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...params.map(clean));
}

function clean(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v);
  return v;
}

// ───────── 各表允许写入的列 ─────────
export const COLUMNS: Record<string, string[]> = {
  paper_groups: ['name'],
  schedule_events: ['date', 'title', 'kind', 'all_day', 'start_time', 'end_time', 'location', 'note', 'client_key', 'series_id', 'recurrence'],
  projects: ['name', 'kind', 'question', 'status', 'next_step', 'description', 'color', 'sort', 'pinned'],
  weeks: ['focus', 'target_minutes', 'review', 'conclusions', 'ruled_out', 'open_questions'],
  goals: ['week_id', 'project_id', 'title', 'criteria', 'weight', 'due_date', 'status', 'progress', 'note', 'sort', 'carried_from'],
  days: ['kind', 'plan_note', 'checkin_at', 'review', 'mood', 'energy', 'target_minutes', 'reviewed_at'],
  goal_tasks: ['goal_id', 'title', 'status', 'points', 'paper_id', 'paper_ids', 'plan_id', 'idea_id', 'project_id', 'criteria', 'note', 'sort', 'done_at', 'carried_from'],
  tasks: ['goal_task_id', 'paper_ids', 'completion_cancelled', 'date', 'title', 'goal_id', 'project_id', 'paper_id', 'plan_id', 'idea_id', 'points', 'criteria', 'planned', 'status', 'done_at', 'carried_from', 'note', 'sort', 'period'],
  sessions: ['task_id', 'project_id', 'paper_id', 'plan_id', 'idea_id', 'label', 'start_at', 'end_at', 'note', 'source'],
  papers: ['title', 'short_name', 'authors', 'team', 'venue', 'published_date', 'url', 'pdf_url', 'code_url', 'arxiv_id', 'doi', 'links',
    'abstract', 'summary', 'collection', 'side', 'direction', 'tags', 'stage', 'possible_dup_of', 'my_note', 'my_question', 'added_at', 'source_id',
    'material_type', 'verification_status', 'verification_note', 'verified_at'],
  reading_plans: ['paper_id', 'purpose', 'project_id', 'idea_id', 'priority', 'depth', 'focus_sections', 'criteria', 'status', 'due_date', 'done_at', 'source_id'],
  reading_logs: ['paper_id', 'plan_id', 'date', 'sections', 'content', 'questions', 'minutes'],
  notes: ['paper_id', 'plan_id', 'idea_id', 'project_id', 'title', 'filename', 'content', 'no_llm'],
  ideas: ['title', 'one_liner', 'kind', 'status', 'priority', 'tags', 'content', 'project_id', 'no_llm', 'source_id'],
  captures: ['content', 'status', 'linked_type', 'linked_id', 'source_id'],
  feed_tasks: ['expected_enabled', 'expected_time', 'expected_days', 'name', 'runner', 'schedule', 'cadence_days', 'sources', 'description', 'status'],
  feed_items: ['reviewed_at', 'task_id', 'run_id', 'title', 'date', 'content', 'url', 'saved_kind', 'read_state', 'triage', 'archived', 'source_id'],
};

const ENTITY: Record<string, string> = {
  paper_groups: 'paper_group', schedule_events: 'schedule_event', projects: 'project', weeks: 'week', goals: 'goal', goal_tasks: 'goal_task', days: 'day', tasks: 'task', sessions: 'session', papers: 'paper',
  reading_plans: 'plan', reading_logs: 'log', notes: 'note', ideas: 'idea', captures: 'capture', feed_tasks: 'feed_task', feed_items: 'feed_item',
};
// 这些表的每次字段修改都记入 changes（计时、打卡这类高频小改动不记）
const AUDITED = new Set(['paper_groups', 'papers', 'reading_plans', 'ideas', 'notes', 'projects', 'goals', 'goal_tasks']);
// 正文类字段只记「已修改」，不把全文塞进变更日志（正文历史见正式版本）
const BODY_FIELDS = new Set(['content']);

export function pick(table: string, input: Record<string, any>): Record<string, any> {
  const cols = COLUMNS[table];
  const out: Record<string, any> = {};
  for (const k of cols) if (k in input) out[k] = input[k] === '' ? null : input[k];
  return out;
}

export interface WriteMeta { origin?: string; source_id?: number | null }

function auditStmt(ctx: Ctx, entity: string, id: number, op: string, field: string | null, oldV: unknown, newV: unknown, meta: WriteMeta = {}) {
  const enc = (v: unknown) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  return stmt(ctx.db,
    'INSERT INTO changes(entity, entity_id, op, field, old, new, actor, origin, source_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    entity, id, op, field, enc(oldV), enc(newV), ctx.actor, meta.origin ?? null, meta.source_id ?? null, nowIso());
}

export async function insert(ctx: Ctx, table: string, data: Record<string, any>, meta: WriteMeta = {}): Promise<number> {
  const row = pick(table, data);
  const ts = nowIso();
  const cols = [...Object.keys(row), 'created_at', 'updated_at'];
  const vals = [...Object.values(row), ts, ts];
  const r = await run(ctx.db, `INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...vals);
  const id = Number(r.meta.last_row_id);
  if (AUDITED.has(table)) await auditStmt(ctx, ENTITY[table], id, 'create', null, null, null, meta).run();
  return id;
}

/** 更新并记录字段级变更；返回真正改动了的字段 */
export async function update(ctx: Ctx, table: string, id: number, patch: Record<string, any>, meta: WriteMeta = {}): Promise<Record<string, any>> {
  const cur = await first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!cur) throw notFound();
  const row = pick(table, patch);
  const changed: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const nv = v != null && typeof v === 'object' ? JSON.stringify(v) : v;
    if (String(cur[k] ?? '') !== String(nv ?? '')) changed[k] = nv;
  }
  if (!Object.keys(changed).length) return {};
  const sets = Object.keys(changed).map((k) => `${k} = ?`).join(', ');
  const batch = [stmt(ctx.db, `UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`, ...Object.values(changed), nowIso(), id)];
  if (AUDITED.has(table)) {
    for (const [k, v] of Object.entries(changed)) {
      batch.push(BODY_FIELDS.has(k)
        ? auditStmt(ctx, ENTITY[table], id, 'update', k, `(${String(cur[k] ?? '').length} 字)`, `(${String(v ?? '').length} 字)`, meta)
        : auditStmt(ctx, ENTITY[table], id, 'update', k, cur[k], v, meta));
    }
  }
  await ctx.db.batch(batch);
  return changed;
}

/** 删除：完整旧记录写进变更日志，必要时可以手动恢复 */
export async function remove(ctx: Ctx, table: string, id: number, extra: D1PreparedStatement[] = [], meta: WriteMeta = {}) {
  const cur = await first(ctx.db, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!cur) throw notFound();
  const batch = [...extra, stmt(ctx.db, `DELETE FROM ${table} WHERE id = ?`, id)];
  batch.push(auditStmt(ctx, ENTITY[table] || table, id, 'delete', null, cur, null, meta));
  await ctx.db.batch(batch);
  return cur;
}

// ───────── 设置 ─────────
// 前端皮肤编号，与 web/src/lib/theme.js 的 THEMES 保持一致
export const THEME_IDS = ['matcha', 'honey', 'blackgold', 'seasalt', 'night'];

export const DEFAULT_SETTINGS = {
  app_name: '研究工作台',
  theme: 'matcha',
  pinned_collections: [] as string[],
  timezone: 'Asia/Singapore',
  workdays: [1, 2, 3, 4, 5, 6, 7],    // 1 = 周一；按生效日期保留历史工作日规则
  workday_versions: [
    { effective_from: '2000-01-01', workdays: [1, 2, 3, 4, 5] },
    { effective_from: '2026-09-26', workdays: [1, 2, 3, 4, 5, 6, 7] },
  ],
  daily_target_minutes: 360,
  weekly_target_minutes: null as number | null, // 为空 = 每日目标 × 工作日数
  hours_in_score: true,               // 工时达成率是否计入评分（封顶，不奖励加班）
  show_grades: true,                  // 是否显示执行等级 S/A/B/C/D
  scoring_versions: [
    {
      version: 1,
      effective_from: '2000-01-01',
      day: { plan: 70, hours: 30 },
      period: { goals: 70, hours: 20, checkin: 10 },
    },
  ],
  llm_provider: 'off',               // off / deepseek / anthropic
  options: {
    collections: ['基础阅读', '方法储备', '前沿跟踪', '待定'],
    sides: ['能力侧', '安全侧', '背景侧'],
    depths: ['速览', '机制理解', '精读验证', '复现'],
    priorities: ['P0', 'P1', 'P2', 'P3'],
    rec_kinds: ['导师', '合作者', 'Claude', 'GPT', 'Newsletter', '自己检索', '引用追踪', '飞书迁移', '其他'],
    relations: ['相关工作', '基线', '方法借鉴', '反例', '数据集', '其他'],
    project_kinds: [
      { value: 'explore', label: '广泛探索' },
      { value: 'research', label: '研究项目' },
      { value: 'course', label: '课程' },
      { value: 'other', label: '其他' },
    ],
  },
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(db: D1Database): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const s: any = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    const v = safeJson(r.value, undefined as any);
    if (v === undefined) continue;
    if (r.key === 'options' && v && typeof v === 'object') s.options = { ...s.options, ...v };
    else s[r.key] = v;
  }
  if (!rows.some(r => r.key === 'workday_versions')) {
    const legacy = rows.find(r => r.key === 'workdays');
    if (legacy) s.workday_versions[0].workdays = safeJson(legacy.value, [1, 2, 3, 4, 5]);
  }
  return s;
}

export async function putSettings(db: D1Database, patch: Record<string, any>) {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  const stmts = Object.entries(patch)
    .filter(([k]) => allowed.has(k))
    .map(([k, v]) => stmt(db, 'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v)));
  if (stmts.length) await db.batch(stmts);
}

export function scoringFor(s: Settings, date: string) {
  const vs = [...(s.scoring_versions || DEFAULT_SETTINGS.scoring_versions)].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  let cur = vs[0];
  for (const v of vs) if (v.effective_from <= date) cur = v;
  return cur;
}

export function int(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function idParam(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('编号不正确');
  return n;
}
