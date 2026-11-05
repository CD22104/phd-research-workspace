import { registerConferences } from './routes/conferences';
import { registerBackground } from './routes/background';
import { Hono } from 'hono';
import { authenticate } from './auth';
import { HttpError, first, run, type Actor, type Ctx, type Env } from './db';
import { nowIso } from './lib/time';
import { registerPlanning } from './routes/planning';
import { registerPapers } from './routes/papers';
import { registerIdeas } from './routes/ideas';
import { registerPaperGroups } from './routes/paper_groups';
import { registerMisc } from './routes/misc';
import { registerCalendar } from './routes/calendar';
import { registerTimeBlocks } from './routes/time_blocks';
import { registerPaperMetadata } from './routes/paper_metadata';

export type App = Hono<{ Bindings: Env; Variables: { ctx: Ctx } }>;

export const app: App = new Hono<{ Bindings: Env; Variables: { ctx: Ctx } }>().basePath('/api');

const ACTORS: Actor[] = ['web', 'mcp', 'api', 'script'];

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message, data: err.data ?? null }, err.status as any);
  console.error(err);
  return c.json({ error: `服务器出错：${err.message}` }, 500);
});

app.notFound((c) => c.json({ error: '接口不存在' }, 404));

app.use('*', async (c, next) => {
  const who = await authenticate(c.req.raw, c.env);
  if (!who) return c.json({ error: '未登录或没有权限' }, 401);
  const method = c.req.method;
  // 浏览器登录（Cookie）的写操作必须带自定义请求头：跨站页面无法伪造（会先发预检，而本站不响应跨域）。
  // 服务令牌（MCP / ChatGPT Actions）不依赖 Cookie，不受跨站伪造影响。
  if (!who.service && method !== 'GET' && method !== 'HEAD' && !c.req.header('X-Requested-With')) {
    return c.json({ error: '缺少 X-Requested-With 请求头' }, 403);
  }
  const actorHeader = (c.req.header('X-Actor') || '').toLowerCase() as Actor;
  let actor: Actor = ACTORS.includes(actorHeader) ? actorHeader : who.service ? 'api' : 'web';
  // 服务令牌永远不算「网页」：确认规则（覆盖个人字段、删除、撤销）对它始终生效
  if (who.service && actor === 'web') actor = 'api';
  c.set('ctx', { db: c.env.DB, env: c.env, actor, who: who.email || who.service, tz: c.env.TIMEZONE || 'Asia/Singapore' });
  await next();
});

// 幂等：带 Idempotency-Key 的写请求，同一个键只执行一次，重复提交直接返回第一次的结果
app.use('*', async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  if (!key || c.req.method === 'GET') return next();
  const k = `${c.req.method} ${new URL(c.req.url).pathname} ${key}`.slice(0, 300);
  const prev = await first(c.env.DB, 'SELECT response FROM idempotency WHERE key = ?', k);
  if (prev) {
    if (prev.response === '__pending__') return c.json({ error: '同一请求正在处理中' }, 409);
    const saved = JSON.parse(prev.response);
    return c.json({ ...saved.body, replayed: true }, saved.status);
  }
  try {
    await run(c.env.DB, 'INSERT INTO idempotency(key, response, created_at) VALUES (?, ?, ?)', k, '__pending__', nowIso());
  } catch {
    return c.json({ error: '同一请求正在处理中' }, 409);
  }
  try {
    await next();
  } catch (e) {
    await run(c.env.DB, 'DELETE FROM idempotency WHERE key = ?', k);
    throw e;
  }
  const res = c.res;
  if (res.status < 300 && (res.headers.get('Content-Type') || '').includes('json')) {
    const body = await res.clone().json();
    await run(c.env.DB, 'UPDATE idempotency SET response = ? WHERE key = ?', JSON.stringify({ status: res.status, body }), k);
  } else {
    await run(c.env.DB, 'DELETE FROM idempotency WHERE key = ?', k);
  }
});

registerPlanning(app);
registerBackground(app);
registerPapers(app);
registerIdeas(app);
registerMisc(app);
registerPaperGroups(app);
registerCalendar(app);
registerTimeBlocks(app);
registerPaperMetadata(app);

registerConferences(app);
