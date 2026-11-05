// 显示用的小工具
export const STATUS = {
  reading: { none: '未计划', planned: '待读', reading: '在读', done: '已读', done_more: '已读 · 有新计划', dropped: '放弃' },
  plan: { planned: '待读', reading: '在读', done: '已完成', dropped: '放弃' },
  idea: { seed: '种子', exploring: '调研中', drafting: '撰写中', experimenting: '实验中', mature: '成型', shelved: '搁置', dropped: '放弃' },
  project: { active: '活跃', paused: '暂缓', done: '完成', archived: '归档' },
  projectKind: { explore: '广泛探索', research: '研究项目', course: '课程', other: '其他' },
  goal: { open: '进行中', done: '已完成', dropped: '放弃' },
  task: { todo: '待办', done: '完成', dropped: '放弃', moved: '已顺延' },
  dayKind: { work: '工作日', rest: '休息', leave: '请假' },
  runner: { codex: 'Codex 定时任务', server: '服务器', claude: 'Claude 定时任务', chatgpt: 'ChatGPT 任务', manual: '手动' },
  triage: { untriaged: '未整理', partial: '部分整理', done: '已整理' },
  stage: { candidate: '候选', library: '正式清单', rejected: '已拒绝' },
  source: { feishu: '飞书', claude: 'Claude 对话', chatgpt: 'GPT 对话', paste: '粘贴', feed: '信息流', manual: '手动', api: 'API', mcp: 'MCP' },
};

export const READING_TONE = { none: 'eeyore', planned: 'sky', reading: 'tigger', done: 'read', done_more: 'read', dropped: 'berry' };
export const IDEA_TONE = { seed: 'leaf', exploring: 'sky', drafting: 'tigger', experimenting: 'piglet', mature: '', shelved: 'eeyore', dropped: 'berry' };

export function fmtMin(m) {
  const mm = Math.round(m || 0);
  const h = Math.floor(mm / 60);
  const r = mm % 60;
  if (!h) return `${r} 分钟`;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
}

export function fmtHours(m) {
  return `${(Math.round(((m || 0) / 60) * 10) / 10).toFixed(1)} h`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(iso)}`;
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];
export function fmtDate(date, withWeek = true) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日${withWeek ? ` 周${WD[wd]}` : ''}`;
}

export function addDays(date, n) {
  const t = Date.parse(date + 'T00:00:00Z') + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function weekStart(date) {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, d === 0 ? -6 : 1 - d);
}

export function isoWeek(date) {
  const thu = addDays(weekStart(date), 3);
  const y = Number(thu.slice(0, 4));
  const w1 = weekStart(`${y}-01-04`);
  return `${y} 第 ${Math.round((Date.parse(thu) - Date.parse(addDays(w1, 3))) / 604800000) + 1} 周`;
}

export function readingLabel(r) {
  if (!r) return '未计划';
  const base = r.state === 'reading' && Number(r.done) > 0 ? '已读 · 重读中' : STATUS.reading[r.state] || r.state;
  if (r.state === 'done' && r.done_depth) return `已读 · ${r.done_depth}`;
  if (r.state === 'done_more') return `已读${r.done_depth ? ' · ' + r.done_depth : ''} · 另有 ${r.open} 个计划`;
  if ((r.state === 'planned' || r.state === 'reading') && r.target_depth) return `${base} · ${r.target_depth}`;
  return base;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深啦，早点休息';
  if (h < 11) return '早上好呀';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsText(file, 'utf-8');
  });
}

// Read history is independent of whether today's task or a new reading round is complete.
export function hasRead(paper) {
  const r = paper?.reading;
  return Number(r?.done) > 0 || ['done', 'done_more'].includes(r?.state);
}
export function paperReadLabel(paper) {
  if (!hasRead(paper)) return '';
  if (paper.reading?.state === 'reading') return '已读 · 重读中';
  if (paper.reading?.state === 'done_more') return '已读 · 有新计划';
  return '已读';
}
