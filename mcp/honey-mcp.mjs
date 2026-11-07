#!/usr/bin/env node
// 研究工作台 MCP 服务（stdio，零依赖，Node ≥ 18）
// 在 Claude 电脑端里用：见 mcp/README.md
//
// 环境变量：
//   HONEY_URL                工作台地址，例如 https://choose-project-name.pages.dev
//   CF_ACCESS_CLIENT_ID      Cloudflare Access 服务令牌（只给 MCP 用，可单独吊销）
//   CF_ACCESS_CLIENT_SECRET
//
// 规则（与网页共用同一套服务端校验）：
//   - 低风险操作直接完成：加入候选区、随手记、任务、计时、新建 Idea / 计划 / 笔记
//   - 覆盖个人内容、撤销导入：先返回预览，需要 confirm: true 再执行
//   - 标记「不发送给外部模型」的 Idea 和笔记，不把正文返回给模型
//   - 附件：attach_file 读取本机文件上传；只返回文件名和下载链接，不把附件内容返回给模型
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const BASE = (process.env.HONEY_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const HEADERS = {
  'Content-Type': 'application/json',
  'X-Requested-With': 'honey-mcp',
  'X-Actor': 'mcp',
  ...(process.env.CF_ACCESS_CLIENT_ID ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET || '' } : {}),
};

class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function api(method, path, body, extraHeaders = {}) {
  let res;
  try {
    res = await fetch(BASE + '/api' + path, { method, headers: { ...HEADERS, ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  } catch (e) {
    throw new ApiError(0, `连不上工作台（${BASE}）：${e.message}`);
  }
  if (res.status >= 300 && res.status < 400) throw new ApiError(401, '被 Cloudflare Access 拦下了：请检查服务令牌是否正确、是否已加入访问策略');
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, `工作台返回了无法识别的内容（${res.status}）`);
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `请求失败（${res.status}）`, data.data);
  return data;
}

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const today = () => api('GET', '/bootstrap').then((b) => b.today);
const j = (v) => JSON.stringify(v, null, 1);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, o[k]]));
const needsConfirm = (e) => e instanceof ApiError && e.status === 409 && e.data?.needs_confirm;
const fileSize = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const attachmentInfo = (a) => ({ id: a.id, filename: a.filename, size: fileSize(a.size), download: `${BASE}/api/attachments/${a.id}/download` });
const OWNER = { type: 'string', enum: ['idea', 'paper', 'note'], description: '挂在哪类记录下：idea（Idea / Proposal）、paper（论文）、note（笔记）' };
const confirmText = (e) => `⚠️ ${e.message}\n变更预览：\n${j(e.data.preview)}\n请把预览告诉用户，得到明确同意后再用 confirm: true 调用一次。`;

// ───────── 工具 ─────────
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (d) => ({ type: 'string', description: d });
const int = (d) => ({ type: 'integer', description: d });
const bool = (d) => ({ type: 'boolean', description: d });

const TOOLS = [
  {
    name: 'search', description: '在工作台里搜索论文、Idea、项目（按标题、作者、标签、arXiv 号等）。加论文前先搜一下是否已有。',
    inputSchema: S({ q: str('搜索词') }, ['q']), annotations: { readOnlyHint: true },
    run: async ({ q }) => j(await api('GET', '/search?q=' + encodeURIComponent(q))),
  },
  {
    name: 'get_paper', description: '查看一篇论文：资料、阅读计划、阅读记录、推荐来源。标记为不发送给外部模型的笔记不返回正文。',
    inputSchema: S({ id: int('论文编号') }, ['id']), annotations: { readOnlyHint: true },
    run: async ({ id }) => {
      const d = await api('GET', `/papers/${id}`);
      return j({
        paper: pick(d.paper, ['id', 'title', 'short_name', 'authors', 'venue', 'published_date', 'url', 'arxiv_id', 'collection', 'side', 'direction', 'tags', 'stage', 'summary', 'my_note', 'my_question']),
        reading: d.reading,
        plans: d.plans.map((p) => pick(p, ['id', 'status', 'purpose', 'depth', 'priority', 'focus_sections', 'criteria', 'idea_title', 'done_at'])),
        logs: d.logs.map((l) => pick(l, ['date', 'sections', 'content', 'questions'])),
        recommendations: d.recommendations.map((r) => pick(r, ['kind', 'recommender', 'reason', 'source_name', 'created_at'])),
        notes: d.notes.map((n) => (n.no_llm ? { id: n.id, title: n.title, content: '（设置为不发送给外部模型）' } : { id: n.id, title: n.title, content: n.content })),
        ideas: d.ideas.map((i) => pick(i, ['id', 'title', 'relation'])),
        attachments: (d.attachments || []).map(attachmentInfo),
      });
    },
  },
  {
    name: 'add_papers',
    description: '把论文加入工作台。默认进「候选区」（stage=candidate），用户明确说「加进清单 / 要读」时用 stage=library 并可带阅读计划字段。'
      + '已存在的论文（arXiv / DOI / 链接相同）只新增一条推荐记录并补空字段，不会重复；标题相似但没有标识符的会作为疑似重复进入候选区等用户确认。'
      + '不要编造链接和 arXiv 号。同样内容重复提交只会导入一次。返回 source_id，可用 undo_import 撤销。',
    inputSchema: S({
      papers: {
        type: 'array', description: '论文列表',
        items: S({
          title: str('原标题'), url: str('链接'), arxiv_id: str('arXiv 号'), authors: str('作者'), venue: str('发表地'), year: str('年份'),
          summary: str('一句话简介（中文）'), rec_reason: str('为什么推荐给用户、与其工作的关系'), tags: { type: 'array', items: { type: 'string' }, description: '主题标签' },
          priority: str('P0-P3（仅在用户或上下文明确时）'), depth: str('速览 / 机制理解 / 精读验证 / 复现'), focus_sections: str('重点章节'), purpose: str('阅读原因'),
        }),
      },
      stage: { type: 'string', enum: ['candidate', 'library'], description: '候选区（默认）或正式清单' },
      source_name: str('来源名称，例如「Claude：检索增强相关工作」'),
      rec_kind: str('推荐来源，默认 Claude；也可以是 导师 / 合作者 / Newsletter 等'),
      recommender: str('推荐人（如导师姓名）'),
      collection: str('集合'), project_id: int('关联项目'), idea_id: int('关联 Idea'),
      raw_excerpt: str('对话里与这些论文相关的原文片段（用于溯源，可选）'),
    }, ['papers']),
    run: async (a) => {
      const defaults = { stage: a.stage || 'candidate', rec_kind: a.rec_kind || 'Claude', recommender: a.recommender, collection: a.collection, project_id: a.project_id, idea_id: a.idea_id, create_plan: a.stage === 'library' };
      const pv = await api('POST', '/import/preview', { items: a.papers, defaults });
      const res = await api('POST', '/import/commit', {
        import_key: 'mcp-' + hash({ p: a.papers, s: a.source_name, st: defaults.stage }),
        source: { kind: 'claude', name: a.source_name || 'Claude 对话', channel: 'Claude 电脑端', raw: a.raw_excerpt || JSON.stringify(a.papers) },
        items: pv.items.map((i) => ({ draft: i.draft, raw: i.raw, origins: i.origins, action: i.action, target_id: i.match?.id })),
        defaults,
      });
      const lines = pv.items.map((i) => {
        const t = i.draft.title;
        if (i.action === 'skip') return `· 跳过：${t}（${i.note || '重复'}）`;
        if (i.action === 'merge') return `· 已存在，记下新的推荐：#${i.match.id} ${t}${i.merge?.conflicts?.length ? '（发表信息与已有记录不一致，保留原值）' : ''}`;
        if (i.action === 'review') return `· 疑似与 #${i.match.id}「${i.match.title}」重复，已放进候选区等用户确认：${t}`;
        return `· ${defaults.stage === 'library' ? '已加入清单' : '已放进候选区'}：${t}`;
      });
      return `${res.replayed ? '（这批内容之前已导入过，没有重复写入）\n' : ''}${lines.join('\n')}\n\n来源记录 #${res.source_id}，如需撤销可调用 undo_import。${pv.warnings?.length ? '\n注意：' + pv.warnings.join('；') : ''}`;
    },
  },
  {
    name: 'undo_import', description: '整批撤销一次导入（add_papers 或网页导入）。第一次调用返回预览；用户确认后带 confirm: true 再调用。',
    inputSchema: S({ source_id: int('来源记录编号'), confirm: bool('用户已确认') }, ['source_id']), annotations: { destructiveHint: true },
    run: async ({ source_id, confirm }) => {
      const r = await api('POST', `/sources/${source_id}/undo`, { confirm: !!confirm });
      return `已撤销：删除 ${r.deleted.length} 篇新建论文，改回 ${r.reverted.length} 个字段${r.kept.length ? `；保留 ${r.kept.length} 篇（${r.kept.map((k) => '#' + k.id + ' ' + k.why).join('；')}）` : ''}`;
    },
  },
  {
    name: 'delete_papers',
    description: '删除论文（可一次删多篇）。会连同它的阅读计划、阅读记录、笔记、推荐记录一起删除；任务和计时记录保留，只解除关联。'
      + '第一次调用（不带 confirm）只返回预览：把预览告诉用户，用户明确同意后再带 confirm: true 调用一次。'
      + '如果用户只是不想读、也不想以后再被推荐，更合适的是 update_paper 把 stage 设为 rejected（拒绝）：删除后同一篇再被推荐时会重新入库。',
    inputSchema: S({ ids: { type: 'array', items: { type: 'integer' }, description: '论文编号（最多 50 个）' }, confirm: bool('用户已看过预览并同意删除') }, ['ids']),
    annotations: { destructiveHint: true },
    run: async ({ ids, confirm }) => {
      const list = [...new Set((ids || []).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
      if (!list.length) return '没有给出论文编号';
      if (list.length > 50) return '一次最多删除 50 篇，请分批';
      const found = [];
      const missing = [];
      for (const id of list) {
        try {
          const d = await api('GET', `/papers/${id}`);
          found.push({ id, title: d.paper.title, plans: d.plans.length, logs: d.logs.length, notes: d.notes.length, ideas: d.ideas.length });
        } catch (e) {
          if (e.status === 404) missing.push(id);
          else throw e;
        }
      }
      if (!found.length) return `这些论文不存在（可能已经删除）：${missing.map((x) => '#' + x).join('、')}`;
      if (!confirm) {
        const lines = found.map((p) => `· #${p.id} ${p.title}（阅读计划 ${p.plans}、阅读记录 ${p.logs}、笔记 ${p.notes}${p.ideas ? `、关联 Idea ${p.ideas} 个` : ''}）`);
        const notes = found.reduce((s, p) => s + p.notes, 0);
        return `⚠️ 将删除 ${found.length} 篇论文：\n${lines.join('\n')}${notes ? `\n其中共有 ${notes} 篇笔记会一起删除。` : ''}`
          + `${missing.length ? `\n不存在：${missing.map((x) => '#' + x).join('、')}` : ''}\n删除记录会保留在变更日志里。请把这份预览告诉用户，得到明确同意后再带 confirm: true 调用。`;
      }
      const done = [];
      const failed = [];
      for (const p of found) {
        try {
          await api('DELETE', `/papers/${p.id}?confirm=1`);
          done.push(`#${p.id} ${p.title}`);
        } catch (e) {
          if (e.status === 404) done.push(`#${p.id} ${p.title}（之前已删除）`);
          else failed.push(`#${p.id} ${p.title}：${e.message}`);
        }
      }
      return `已删除 ${done.length} 篇：\n${done.map((x) => '· ' + x).join('\n')}${failed.length ? `\n删除失败：\n${failed.map((x) => '· ' + x).join('\n')}` : ''}`;
    },
  },
  {
    name: 'update_paper', description: '修改论文资料字段（标题、发表地、标签、集合、简介等）。覆盖「我的备注 / 我的问题」需要先预览、用户确认后带 confirm: true。',
    inputSchema: S({ id: int('论文编号'), fields: { type: 'object', description: '要改的字段，例如 {"venue": "ICLR 2025", "tags": ["可信监控"]}' }, confirm: bool('用户已确认') }, ['id', 'fields']),
    run: async ({ id, fields, confirm }) => {
      const r = await api('PATCH', `/papers/${id}`, { ...fields, confirm: !!confirm, origin: 'Claude 对话' });
      return Object.keys(r.changed).length ? `已修改：${Object.keys(r.changed).join('、')}` : '没有变化';
    },
  },
  {
    name: 'add_reading_plan', description: '给论文新建一轮阅读计划（为什么读、目标深度、重点章节、完成标准）。已读过的论文也可以为新的目的再建一轮。',
    inputSchema: S({ paper_id: int('论文编号'), purpose: str('阅读原因'), depth: str('速览 / 机制理解 / 精读验证 / 复现'), priority: str('P0-P3'),
      focus_sections: str('重点章节'), criteria: str('完成标准'), idea_id: int('服务于哪个 Idea'), project_id: int('项目'), due_date: str('截止日期 YYYY-MM-DD') }, ['paper_id']),
    run: async (a) => {
      const p = await api('POST', '/plans', a);
      return `已新建阅读计划 #${p.id}`;
    },
  },
  {
    name: 'update_reading_plan', description: '更新阅读计划状态：planned 待读 / reading 在读 / done 达到目标 / dropped 放弃。',
    inputSchema: S({ plan_id: int('计划编号'), status: { type: 'string', enum: ['planned', 'reading', 'done', 'dropped'] } }, ['plan_id', 'status']),
    run: async ({ plan_id, status }) => {
      await api('PATCH', `/plans/${plan_id}`, { status });
      return '已更新';
    },
  },
  {
    name: 'add_reading_log', description: '记一笔阅读记录：读了哪些部分、收获、疑问。',
    inputSchema: S({ paper_id: int('论文编号'), plan_id: int('阅读计划编号'), date: str('日期 YYYY-MM-DD，默认今天'), sections: str('读了哪些'), content: str('收获'), questions: str('疑问'), minutes: int('分钟数（可空）') }, ['paper_id']),
    run: async (a) => {
      await api('POST', '/logs', a);
      return '已记录';
    },
  },
  {
    name: 'add_note', description: '新建一篇 Markdown 笔记，挂在论文 / Idea / 项目下（只新建，不覆盖已有笔记）。',
    inputSchema: S({ title: str('标题'), content: str('Markdown 正文'), paper_id: int('论文'), idea_id: int('Idea'), project_id: int('项目') }, ['title', 'content']),
    run: async (a) => {
      const n = await api('POST', '/notes', { ...a, filename: null }, { 'Idempotency-Key': 'note-' + hash(a) });
      return `已保存笔记 #${n.id}`;
    },
  },
  {
    name: 'capture', description: '随手记：把一个想法、链接或待整理的东西放进收件箱（不会自动变成任务或论文）。',
    inputSchema: S({ content: str('内容') }, ['content']),
    run: async ({ content }) => {
      await api('POST', '/captures', { content }, { 'Idempotency-Key': 'cap-' + hash(content) });
      return '已放进收件箱';
    },
  },
  {
    name: 'get_today', description: '查看某天（默认今天）的打卡、任务、本周目标、计时和执行评分。',
    inputSchema: S({ date: str('YYYY-MM-DD，默认今天') }), annotations: { readOnlyHint: true },
    run: async ({ date }) => {
      const d = await api('GET', `/day/${date || 'today'}`);
      return j({
        date: d.date, checked_in: !!d.day?.checkin_at, plan_note: d.day?.plan_note, review: d.day?.review,
        tasks: d.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, planned: !!t.planned, points: t.points, goal: t.goal_title, paper: t.paper_title, minutes: t.minutes })),
        week_goals: d.goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress, due: g.due_date })),
        recorded_minutes: d.summary?.minutes, target_minutes: d.summary?.targetMinutes,
        score: d.summary?.score && { score: d.summary.score.score, status: d.summary.score.status, reason: d.summary.score.reason, parts: d.summary.score.parts.map((p) => `${p.label} ${p.detail}`) },
      });
    },
  },
  {
    name: 'checkin', description: '打卡：写下今天最重要的目标。打卡之后新加的任务会记为「计划外」。',
    inputSchema: S({ plan_note: str('今日主要目标'), date: str('YYYY-MM-DD，默认今天') }, ['plan_note']),
    run: async ({ plan_note, date }) => {
      await api('POST', `/day/${date || 'today'}/checkin`, { plan_note });
      return '已打卡';
    },
  },
  {
    name: 'add_task', description: '添加任务（默认今天）。可以挂到周目标、论文、阅读计划或 Idea。points 是工作量点数（1/2/3/5），完成率按点数算。',
    inputSchema: S({ title: str('任务'), date: str('YYYY-MM-DD'), goal_id: int('周目标'), paper_id: int('论文'), plan_id: int('阅读计划'), idea_id: int('Idea'), project_id: int('项目'), points: int('1/2/3/5'), criteria: str('完成标准') }, ['title']),
    run: async (a) => {
      const date = a.date || (await today());
      const t = await api('POST', '/tasks', { ...a, date }, { 'Idempotency-Key': 'task-' + hash({ ...a, date }) });
      return `已添加任务 #${t.id}${t.planned ? '' : '（打卡后添加，记为计划外）'}`;
    },
  },
  {
    name: 'update_task', description: '更新任务：完成（done）、恢复（todo）、放弃（dropped，算计划调整），或改名、改点数。',
    inputSchema: S({ task_id: int('任务编号'), status: { type: 'string', enum: ['todo', 'done', 'dropped'] }, title: str('新名称'), points: int('点数') }, ['task_id']),
    run: async ({ task_id, ...b }) => {
      await api('PATCH', `/tasks/${task_id}`, b);
      return '已更新';
    },
  },
  {
    name: 'save_day_review', description: '保存晚间复盘（结论、卡点、明天先做什么）和心情 / 精力（1-5，只用于自我观察）。已有复盘时需要用户确认后带 confirm: true 覆盖。',
    inputSchema: S({ review: str('复盘内容'), mood: int('1-5'), energy: int('1-5'), date: str('YYYY-MM-DD'), confirm: bool('用户已确认覆盖') }, ['review']),
    run: async ({ review, mood, energy, date, confirm }) => {
      const d = await api('GET', `/day/${date || 'today'}`);
      if (d.day?.review && !confirm && d.day.review !== review) return `这一天已经有复盘：\n「${d.day.review}」\n请问用户是覆盖还是合并后再保存（确认后带 confirm: true）。`;
      await api('PUT', `/day/${d.date}`, pick({ review, mood, energy }, ['review', 'mood', 'energy']));
      return '复盘已保存';
    },
  },
  {
    name: 'start_timer', description: '开始计时（个人工作计时）。关联任务 / 论文 / Idea 或给一个名称。已有计时时默认不切换，除非 switch: true。',
    inputSchema: S({ task_id: int('任务'), paper_id: int('论文'), plan_id: int('阅读计划'), idea_id: int('Idea'), label: str('名称'), switch: bool('停止当前计时并开始新的') }),
    run: async (a) => {
      try {
        const r = await api('POST', '/timer/start', a);
        return r.already ? `已经在计时：${r.running.label}` : `开始计时：${r.running.label || '未命名'}${r.stopped ? `（已停止「${r.stopped.label}」）` : ''}`;
      } catch (e) {
        if (e.status === 409 && e.data?.running) return `正在计时「${e.data.running.label || '未命名'}」。要切换的话请带 switch: true。`;
        throw e;
      }
    },
  },
  {
    name: 'stop_timer', description: '停止当前计时。',
    inputSchema: S({ note: str('备注') }),
    run: async ({ note }) => {
      const r = await api('POST', '/timer/stop', { note });
      if (!r.stopped) return '现在没有在计时';
      const min = Math.round((Date.parse(r.stopped.end_at) - Date.parse(r.stopped.start_at)) / 60000);
      return `已停止「${r.stopped.label || '未命名'}」，记录 ${min} 分钟`;
    },
  },
  {
    name: 'get_week', description: '查看某周（默认本周）的目标、每天情况、执行评分和周复盘。',
    inputSchema: S({ date: str('这一周里的任意日期') }), annotations: { readOnlyHint: true },
    run: async ({ date }) => {
      const w = await api('GET', `/week/${date || 'today'}`);
      return j({
        week: w.from + ' ~ ' + w.to, focus: w.week?.focus,
        goals: w.goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress, criteria: g.criteria, due: g.due_date, tasks: `${g.task_done}/${g.task_total}` })),
        days: w.days.map((d) => ({ date: d.date, kind: d.kind, checkin: d.checkin, minutes: Math.round(d.minutes), score: d.score.score })),
        score: { score: w.score.score, status: w.score.status, reason: w.score.reason, due_by_today: w.score.dueByToday, parts: w.score.parts.map((p) => `${p.label} ${p.detail}`) },
        review: pick(w.week || {}, ['conclusions', 'ruled_out', 'open_questions', 'review']),
      });
    },
  },
  {
    name: 'add_goal', description: '给某周（默认本周）添加目标。写清完成标准；有截止日时填 due_date。',
    inputSchema: S({ title: str('目标'), criteria: str('完成标准'), weight: int('权重 1-5'), due_date: str('YYYY-MM-DD'), project_id: int('项目'), week_date: str('这一周里的任意日期') }, ['title']),
    run: async (a) => {
      const g = await api('POST', '/goals', { ...a, week_id: a.week_date || (await today()) }, { 'Idempotency-Key': 'goal-' + hash(a) });
      return `已添加目标 #${g.id}`;
    },
  },
  {
    name: 'update_goal', description: '更新周目标进度（0-100）或状态（open / done / dropped）。',
    inputSchema: S({ goal_id: int('目标编号'), progress: int('0-100'), status: { type: 'string', enum: ['open', 'done', 'dropped'] } }, ['goal_id']),
    run: async ({ goal_id, ...b }) => {
      await api('PATCH', `/goals/${goal_id}`, b);
      return '已更新';
    },
  },
  {
    name: 'list_ideas', description: '列出 Idea 仓库（标题、状态、关联论文数、已读够的篇数）。', inputSchema: S({}), annotations: { readOnlyHint: true },
    run: async () => j((await api('GET', '/ideas')).ideas.map((i) => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, one_liner: i.no_llm ? undefined : i.one_liner, papers: i.paper_count, satisfied: i.satisfied_count }))),
  },
  {
    name: 'get_idea', description: '查看一个 Idea 及其关联论文的阅读情况。设置为不发送给外部模型的 Idea 只返回标题和关联论文。',
    inputSchema: S({ id: int('Idea 编号') }, ['id']), annotations: { readOnlyHint: true },
    run: async ({ id }) => {
      const d = await api('GET', `/ideas/${id}`);
      const i = d.idea;
      return j({
        id: i.id, title: i.title, kind: i.kind, status: i.status, project: i.project_name,
        ...(i.no_llm ? { content: '（这个 Idea 设置为不发送给外部模型；用户可以在网页上关闭这个开关）' } : { one_liner: i.one_liner, content: i.content }),
        papers: d.papers.map((p) => ({ id: p.id, title: p.title, relation: p.relation, reading_for_this_idea: p.reading.state })),
        summary: `关联 ${d.papers.length} 篇；其中 ${d.satisfied} 篇已完成本 Idea 所需的阅读目标`,
        attachments: i.no_llm ? `${(d.attachments || []).length} 个` : (d.attachments || []).map(attachmentInfo),
      });
    },
  },
  {
    name: 'create_idea', description: '新建 Idea 或 Proposal（默认不发送给外部模型，之后读取不会返回正文）。可以同时关联论文。',
    inputSchema: S({ title: str('标题'), one_liner: str('一句话'), content: str('Markdown 正文'), kind: { type: 'string', enum: ['idea', 'proposal'] }, project_id: int('项目'), paper_ids: { type: 'array', items: { type: 'integer' } } }, ['title']),
    run: async ({ paper_ids, ...a }) => {
      const i = await api('POST', '/ideas', a, { 'Idempotency-Key': 'idea-' + hash(a) });
      for (const pid of paper_ids || []) await api('POST', `/ideas/${i.id}/papers`, { paper_id: pid });
      return `已新建 Idea #${i.id}`;
    },
  },
  {
    name: 'link_paper_to_idea', description: '把论文关联到 Idea（关系：相关工作 / 基线 / 方法借鉴 / 反例 / 数据集 / 其他）。',
    inputSchema: S({ idea_id: int('Idea'), paper_id: int('论文'), relation: str('关系'), note: str('说明') }, ['idea_id', 'paper_id']),
    run: async ({ idea_id, ...b }) => {
      await api('POST', `/ideas/${idea_id}/papers`, b);
      return '已关联';
    },
  },
  {
    name: 'list_attachments', description: '列出某个 Idea / 论文 / 笔记下的附件（文件名、大小、下载链接）。不返回文件内容。',
    inputSchema: S({ owner_type: OWNER, owner_id: int('记录编号') }, ['owner_type', 'owner_id']), annotations: { readOnlyHint: true },
    run: async ({ owner_type, owner_id }) => {
      const r = await api('GET', `/attachments?owner_type=${owner_type}&owner_id=${owner_id}`);
      return r.attachments.length ? j(r.attachments.map(attachmentInfo)) : '还没有附件';
    },
  },
  {
    name: 'attach_file',
    description: '把本机的一个文件（Excel、PDF、Word、图片等，最大 10 MB）作为附件挂到 Idea / 论文 / 笔记下。path 是这台电脑上的文件路径。'
      + '同名且内容相同的文件重复上传只保存一次。返回下载链接，可以写进正文，例如 [文件名](下载链接)。',
    inputSchema: S({ owner_type: OWNER, owner_id: int('记录编号'), path: str('本机文件的完整路径'), filename: str('保存的文件名（默认用原文件名）'), note: str('备注') }, ['owner_type', 'owner_id', 'path']),
    run: async ({ owner_type, owner_id, path, filename, note }) => {
      let info;
      try {
        info = await stat(path);
      } catch {
        return `找不到文件：${path}`;
      }
      if (!info.isFile()) return `这不是一个文件：${path}`;
      if (info.size > 10 * 1024 * 1024) return `文件 ${fileSize(info.size)}，超过单个附件上限 10 MB`;
      const data = await readFile(path);
      const name = filename || basename(path);
      const r = await api('POST', '/attachments', { owner_type, owner_id, filename: name, note, data_base64: data.toString('base64') },
        { 'Idempotency-Key': 'att-' + createHash('sha256').update(data).update(`${owner_type}:${owner_id}:${name}`).digest('hex').slice(0, 32) });
      return `${r.duplicate || r.replayed ? '这个文件之前已经上传过' : '已上传附件'} #${r.id}「${r.filename}」（${fileSize(r.size)}）\n下载链接：${BASE}/api/attachments/${r.id}/download`;
    },
  },
  {
    name: 'delete_attachment',
    description: '删除一个附件（删除后无法恢复）。第一次调用（不带 confirm）只返回预览：把预览告诉用户，用户明确同意后再带 confirm: true 调用一次。',
    inputSchema: S({ id: int('附件编号'), confirm: bool('用户已看过预览并同意删除') }, ['id']),
    annotations: { destructiveHint: true },
    run: async ({ id, confirm }) => {
      const r = await api('DELETE', `/attachments/${id}${confirm ? '?confirm=1' : ''}`);
      return `已删除附件 #${id}「${r.deleted.filename}」（${r.deleted.size}，原来挂在 ${r.deleted.owner}）`;
    },
  },
  {
    name: 'list_projects', description: '列出项目 / 探索主题（核心问题、下一步、关联数量）。', inputSchema: S({}), annotations: { readOnlyHint: true },
    run: async () => j((await api('GET', '/projects')).projects.map((p) => pick(p, ['id', 'name', 'kind', 'status', 'question', 'next_step', 'paper_count', 'idea_count', 'open_goals']))),
  },
  {
    name: 'create_project', description: '新建项目 / 探索主题（广泛探索也可以，不必先有假设）。',
    inputSchema: S({ name: str('名称'), kind: { type: 'string', enum: ['explore', 'research', 'course', 'other'] }, question: str('当前核心问题'), next_step: str('下一步') }, ['name']),
    run: async (a) => `已新建项目 #${(await api('POST', '/projects', a, { 'Idempotency-Key': 'proj-' + hash(a) })).id}`,
  },
  {
    name: 'save_feed_result', description: '保存一次定时任务 / Newsletter 整理的结果到信息流（例如 领域周报跟踪）。不会自动产生待办或论文。同一个 run_key 重复保存只记一次。',
    inputSchema: S({ task_name: str('定时任务名称（需已在网页上建好）'), title: str('这期标题'), content: str('Markdown 内容（摘要或原文）'), date: str('YYYY-MM-DD'), url: str('原文链接'),
      run_key: str('这次运行的唯一编号，例如「latent-2026-09-26」'), status: { type: 'string', enum: ['success', 'partial', 'failed'] }, message: str('失败原因或备注') }, ['task_name', 'title', 'content']),
    run: async (a) => {
      try {
        const r = await api('POST', '/feeds/runs', { task_name: a.task_name, run_key: a.run_key || 'mcp-' + hash([a.task_name, a.title, a.date]), status: a.status || 'success', message: a.message,
          items: [{ title: a.title, content: a.content, date: a.date, url: a.url }] });
        return r.replayed ? '这次运行之前已经保存过' : `已保存到信息流（动态 #${r.items[0]?.id}）`;
      } catch (e) {
        if (e.status === 400 && /定时任务/.test(e.message)) {
          const t = await api('GET', '/feeds');
          return `找不到名为「${a.task_name}」的定时任务。已有：${t.tasks.map((x) => x.name).join('、') || '（无）'}。请让用户先在网页「信息流」里建好。`;
        }
        throw e;
      }
    },
  },
  {
    name: 'get_stats', description: '查看日 / 周 / 月统计：记录工时、计划完成、时间花在哪、执行评分及依据。',
    inputSchema: S({ range: { type: 'string', enum: ['day', 'week', 'month'] }, date: str('YYYY-MM-DD') }), annotations: { readOnlyHint: true },
    run: async ({ range, date }) => {
      const s = await api('GET', `/stats?range=${range || 'week'}&date=${date || 'today'}`);
      const sc = range === 'day' ? s.days[0].score : s.score;
      return j({
        period: `${s.from} ~ ${s.to}`, recorded_minutes: s.breakdown.total,
        score: sc && { score: sc.score, status: sc.status, reason: sc.reason, parts: sc.parts.map((p) => `${p.label}（${p.weight}%）${p.detail}`), notes: sc.notes },
        projects: s.breakdown.projects, papers: s.breakdown.papers, tasks: s.breakdown.tasks.slice(0, 8),
      });
    },
  },
];

// ───────── MCP（JSON-RPC over stdio）─────────
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = '这是用户的个人科研工作台「研究工作台」。加论文前先 search；推荐的论文默认进候选区，用户明确要读时才进正式清单。'
  + '覆盖个人内容、撤销导入、删除论文或附件时先把预览告诉用户，得到同意再带 confirm。用户给出本机文件时可以用 attach_file 挂成附件。不要编造链接、arXiv 号或作者。';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // 通知，不需要回复
  try {
    if (method === 'initialize') {
      const v = SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'research-workspace', version: '0.1.0' }, instructions: INSTRUCTIONS } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })) } });
    }
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `没有这个工具：${params?.name}` } });
      try {
        const text = await tool.run(params.arguments || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        const text = needsConfirm(e) ? confirmText(e) : `出错了：${e.message}${e.data ? '\n' + j(e.data) : ''}`;
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: !needsConfirm(e) } });
      }
    }
    if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `不支持的方法：${method}` } });
  } catch (e) {
    return send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '无法解析的消息' } });
  }
  handle(msg);
});
process.stderr.write(`[honey-mcp] 已启动，连接 ${BASE}\n`);
