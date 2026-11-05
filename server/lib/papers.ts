// 论文导入：把各种来源（飞书 CSV、JSON、BibTeX、Markdown 表格、链接列表）解析成统一字段，并做查重。

export const STATUS_LABELS: Record<string, string> = {
  inbox: '待筛选', to_read: '待读', reading: '在读', skimmed: '已扫读', done: '已读', dropped: '放弃',
};

// 论文资料字段（导入合并时只补空值；my_note / my_question 为个人字段，合并时永不写入）
export const PAPER_FIELDS = [
  'title', 'short_name', 'authors', 'team', 'venue', 'published_date', 'url', 'pdf_url', 'code_url',
  'arxiv_id', 'doi', 'abstract', 'summary', 'collection', 'side', 'direction', 'tags', 'my_note', 'my_question', 'added_at',
  'material_type', 'verification_status', 'verification_note', 'verified_at',
] as const;
export const PERSONAL_FIELDS = ['my_note', 'my_question'] as const;
// 发表信息：新旧不一致时列出差异，等待确认
export const CONFLICT_FIELDS = ['venue', 'published_date', 'authors'] as const;
// 阅读计划字段
export const PLAN_FIELDS = ['status', 'priority', 'depth', 'focus_sections', 'purpose', 'criteria', 'started_at', 'finished_at'] as const;
// 推荐记录字段
export const REC_FIELDS = ['rec_kind', 'recommender', 'rec_reason'] as const;

export const ALL_FIELDS = [...PAPER_FIELDS, ...PLAN_FIELDS, ...REC_FIELDS] as const;
export type Field = typeof ALL_FIELDS[number];
export type PaperDraft = Partial<Record<Field, any>> & { tags?: string[] };

export const DEPTHS = ['速览', '机制理解', '精读验证', '复现'];
export const REC_KINDS = ['导师', '合作者', 'Claude', 'GPT', 'Newsletter', '自己检索', '引用追踪', '飞书迁移', '其他'];

// 通用别名（JSON / Markdown 表格 / 一般 CSV）
const ALIASES: Record<string, Field> = {};
function alias(field: Field, ...names: string[]) {
  for (const n of [field, ...names]) ALIASES[keyNorm(n)] = field;
}
function keyNorm(k: string): string {
  return k.toLowerCase().replace(/[\s_\-·:：/（）()]/g, '');
}
alias('title', '论文名称', '论文', '标题', '名称', '论文标题', 'paper', 'papertitle', 'name');
alias('short_name', '简称', 'alias', 'shortname');
alias('authors', '作者', 'author');
alias('team', '主要团队', '团队', '机构', 'institution', 'affiliation', 'org', 'lab');
alias('venue', '发表地', '会议', '期刊', '会议期刊', 'publishedin', 'conference', 'journal', 'booktitle', 'publication');
alias('published_date', '发布日期', '发表时间', '发表日期', '发布时间', 'date', 'year', 'published', 'publicationdate', '年份');
alias('url', '来源网址', '网址', '链接', 'link', 'arxivurl', 'paperurl', 'href');
alias('pdf_url', 'pdf', 'pdf链接');
alias('code_url', '代码', 'code', 'github', 'repo', '代码链接');
alias('arxiv_id', 'arxiv', 'arxivid', 'eprint');
alias('doi');
alias('abstract', '摘要');
alias('summary', '简介', '论文简介', 'tldr', 'description', '一句话', '内容简介');
alias('material_type', '资料类型');
alias('verification_status', '核验状态');
alias('verification_note', '核验说明');
alias('verified_at', '核验日期');
alias('collection', 'group', 'grp', '分组', '集合', '组');
alias('side', '侧重');
alias('direction', '子方向', '研究问题', '方向', '研究方向', 'topic', '主题');
alias('tags', 'topictags', '标签', 'tag', 'keywords', '关键词', '主题标签');
alias('my_note', '备注', '我的备注', 'note', 'notes', 'comment');
alias('my_question', 'myquestion', '我的问题', 'question', 'questions', '问题');
alias('added_at', '加入时间', '加入日期', 'addedat', 'added');
alias('status', '状态', '阅读状态');
alias('priority', 'level', '优先级', '级别');
alias('depth', '深入程度', '阅读深度', '阅读程度', '目标深度', 'readingdepth');
alias('focus_sections', '重点章节', '阅读部分', '重点阅读章节', 'sections', 'focus', '重点');
alias('purpose', '阅读原因', '为什么读', '阅读目的', '目的');
alias('criteria', '完成标准');
alias('started_at', '开始阅读', 'startedat');
alias('finished_at', '阅读时间', '读完日期', '完成时间', 'finishedat', 'readat');
alias('rec_kind', 'reason', '加入原因', '推荐来源', 'source', 'addedby', '来源类型', 'recommendsource');
alias('recommender', '推荐人', 'recommendedby');
alias('rec_reason', '推荐理由', 'why', 'whyread', 'whyrelevant', '相关性', '理由');

// 飞书「My Agent Paper List」导出列 → 字段（「加入原因」列里写的是子方向，「来源」是发表地）
const FEISHU_MAP: Record<string, Field | '_topic' | '_source' | '_card' | '_attach'> = {
  '论文名称': 'title', 'Status': 'status', '分组': 'collection', 'Level': 'priority', 'Topic Tags': '_topic',
  '加入原因': 'direction', '来源': '_source', '来源网址': 'url', '加入时间': 'added_at', '发布日期': 'published_date',
  '简介': 'summary', '阅读时间': 'finished_at', '阅读部分': 'focus_sections', 'My Question': 'my_question',
  '主要团队': 'team', 'Paper Card': '_card', '附件': '_attach',
};

export const SIDES = ['能力侧', '安全侧', '背景侧'];

export function parseStatus(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const s = String(v).trim().toLowerCase().replace(/[\s_\-]/g, '');
  if (s in STATUS_LABELS) return s;
  const map: Record<string, string> = {
    toread: 'to_read', 待读: 'to_read', 未读: 'to_read', todo: 'to_read', 想读: 'to_read',
    done: 'done', 已读: 'done', 读完: 'done', finished: 'done', read: 'done', 完成: 'done', 已完成: 'done',
    reading: 'reading', 在读: 'reading', 阅读中: 'reading', 正在读: 'reading',
    scan: 'skimmed', scanned: 'skimmed', skim: 'skimmed', skimmed: 'skimmed', 略读: 'skimmed', 扫读: 'skimmed', 已扫读: 'skimmed', 已略读: 'skimmed',
    giveup: 'dropped', dropped: 'dropped', 放弃: 'dropped', 不读: 'dropped', drop: 'dropped',
    inbox: 'inbox', 待筛选: 'inbox', 候选: 'inbox', candidate: 'inbox',
  };
  return map[s];
}

export function normDepth(v: unknown): string | undefined {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (/复现|reproduc|replicat/.test(s)) return '复现';
  if (/精读|验证|深读|deep|close/.test(s)) return '精读验证';
  if (/机制|理解|泛读|method|mechan/.test(s)) return '机制理解';
  if (/速览|略读|扫读|浏览|skim|scan|quick|摘要/.test(s)) return '速览';
  return undefined;
}

export function normRecKind(v: unknown): string {
  const s = String(v ?? '').trim();
  const l = s.toLowerCase();
  if (/claude|anthropic/.test(l)) return 'Claude';
  if (/gpt|openai/.test(l)) return 'GPT';
  if (/导师|老师|advisor|supervisor|prof/.test(l)) return '导师';
  if (/师兄|师姐|同门|合作|同学|collab|peer/.test(l)) return '合作者';
  if (/newsletter|日报|周报|动态|latent|ainews|订阅/.test(l)) return 'Newsletter';
  if (/引用|citation|cited/.test(l)) return '引用追踪';
  if (/检索|搜索|search|google|scholar/.test(l)) return '自己检索';
  if (/飞书|feishu|lark/.test(l)) return '飞书迁移';
  return s || '其他';
}

export function normDate(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{4})[\/\-.年](\d{1,2})月?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{4})$/);
  if (m) return m[1];
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return undefined;
}

const ARXIV_NEW = /(?<![\d.])(\d{2}(?:0[1-9]|1[0-2])\.\d{4,5})(v\d+)?(?![\d])/;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf|html)\/([a-z\-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i;

export function arxivFromText(s: unknown): string | undefined {
  if (!s) return undefined;
  const str = String(s);
  const u = str.match(ARXIV_URL);
  if (u) return u[1];
  const p = str.match(/arxiv[:\s]*([0-9]{4}\.[0-9]{4,5})/i);
  if (p) return p[1];
  return undefined;
}

export function cleanUrl(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  const m = s.match(/https?:\/\/[^\s)\]>"'，。；]+/);
  if (!m) return undefined;
  let u = m[0].replace(/[.,;]+$/, '');
  try {
    const url = new URL(u);
    if (!url.hostname || !url.hostname.includes('.')) return undefined;
    for (const [k] of [...(url.searchParams as any).entries()] as Array<[string, string]>) {
      if (/^utm_|^(ref|source|fbclid|gclid)$/i.test(k)) url.searchParams.delete(k);
    }
    u = url.toString();
  } catch {
    return undefined;
  }
  return u;
}

export function splitTags(v: unknown): string[] {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,，;；、|\n]/);
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

const VENUE_RE = /\b(ICML|ICLR|NeurIPS|NIPS|ACL|EMNLP|NAACL|COLM|CVPR|ICCV|ECCV|AAAI|IJCAI|KDD|WWW|USENIX Security|CCS|S&P|NDSS|ICSE|FSE|ASE|TMLR|JMLR|CoRL|RSS|ICRA|IROS|AAMAS|UAI|AISTATS|SaTML)\s*'?(\d{2,4})\b/i;

/** 从标题里剥离「，2025；2512.18311」「，2023 首发，ICML 2024；2312.06942」这类尾巴 */
export function splitTitle(raw: string): { title: string; arxiv?: string; year?: string; venue?: string } {
  let title = raw.trim();
  let arxiv: string | undefined;
  let year: string | undefined;
  let venue: string | undefined;
  const a = title.match(/\s*[；;，,]\s*(?:arxiv[:\s]*)?(\d{4}\.\d{4,5})(v\d+)?\s*$/i);
  if (a) {
    arxiv = a[1];
    title = title.slice(0, a.index).trim();
  }
  // 逐段剥掉结尾含年份的短注释
  for (let i = 0; i < 3; i++) {
    const m = title.match(/[，,；;]\s*([^，,；;]{0,24}?(?:19|20)\d{2}[^，,；;]{0,12})$/);
    if (!m || title.length - m[0].length < 8) break;
    const seg = m[1];
    const y = seg.match(/(?:19|20)\d{2}/);
    if (y && !year) year = y[0];
    const v = seg.match(VENUE_RE);
    if (v && !venue) venue = `${v[1]} ${v[2].length === 2 ? '20' + v[2] : v[2]}`;
    title = title.slice(0, m.index).trim();
  }
  return { title, arxiv, year, venue };
}

/** 把任意键名的记录转成统一字段；未识别的键保留在 extra 里（只进溯源原文） */
export function normalizeRecord(rec: Record<string, any>): { draft: PaperDraft; extra: Record<string, any> } {
  const draft: PaperDraft = {};
  const extra: Record<string, any> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v == null || v === '') continue;
    const f = ALIASES[keyNorm(k)];
    if (!f) {
      extra[k] = v;
      continue;
    }
    if (f === 'tags') draft.tags = [...(draft.tags || []), ...splitTags(v)];
    else if (f === 'authors') draft.authors = Array.isArray(v) ? v.map(authorName).join(', ') : String(v).trim();
    else if (draft[f] == null) draft[f] = typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.join(', ') : v;
  }
  return { draft: finishDraft(draft), extra };
}

function authorName(a: any): string {
  if (a && typeof a === 'object') return a.name || [a.given, a.family].filter(Boolean).join(' ');
  return String(a);
}

/** 统一清洗：状态、日期、链接、arXiv 号、侧重等 */
export function finishDraft(d: PaperDraft): PaperDraft {
  const out: PaperDraft = { ...d };
  if (out.title) {
    const s = splitTitle(String(out.title));
    out.title = s.title;
    if (s.arxiv && !out.arxiv_id) out.arxiv_id = s.arxiv;
    if (s.year && !out.published_date) out.published_date = s.year;
    if (s.venue && !out.venue) out.venue = s.venue;
  }
  if (out.status != null) {
    const st = parseStatus(out.status);
    if (st) out.status = st;
    else delete out.status;
  }
  for (const f of ['published_date', 'added_at', 'started_at', 'finished_at', 'verified_at'] as const) {
    if (out[f] != null) {
      const nd = normDate(out[f]);
      if (nd) out[f] = nd;
      else delete out[f];
    }
  }
  for (const f of ['url', 'pdf_url', 'code_url'] as const) {
    if (out[f] != null) {
      const u = cleanUrl(out[f]);
      if (u) out[f] = u;
      else delete out[f];
    }
  }
  if (out.arxiv_id) {
    const a = arxivFromText('arxiv:' + String(out.arxiv_id).replace(/^arxiv[:\s]*/i, '')) || arxivFromText(out.arxiv_id);
    if (a) out.arxiv_id = a;
    else delete out.arxiv_id;
  }
  if (!out.arxiv_id) {
    const a = arxivFromText(out.url) || arxivFromText(out.pdf_url);
    if (a) out.arxiv_id = a;
  }
  if (out.arxiv_id && !out.url) out.url = `https://arxiv.org/abs/${out.arxiv_id}`;
  if (out.venue && /^arxiv$/i.test(String(out.venue).trim())) out.venue = 'arXiv';
  if (out.doi) out.doi = String(out.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  if (out.priority) {
    const m = String(out.priority).toUpperCase().match(/P\s*([0-3])/);
    if (m) out.priority = `P${m[1]}`;
    else delete out.priority;
  }
  if (out.depth) out.depth = normDepth(out.depth) || out.depth;
  if (out.rec_kind) out.rec_kind = normRecKind(out.rec_kind);
  if (out.tags) out.tags = splitTags(out.tags);
  // 标签里的「能力侧 / 安全侧 / 背景侧」提到侧重字段
  if (out.tags?.length) {
    const rest: string[] = [];
    for (const t of out.tags) {
      const side = SIDES.find((s) => t.startsWith(s));
      if (side) {
        if (!out.side) out.side = side;
        const tail = t.slice(side.length).replace(/^[\/／\s]+/, '');
        if (tail) rest.push(tail);
      } else rest.push(t);
    }
    out.tags = [...new Set(rest)];
  }
  if (out.side) {
    const side = SIDES.find((s) => String(out.side).startsWith(s) || s.startsWith(String(out.side)));
    if (side) out.side = side;
  }
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t || t === '/' || t === '-') delete (out as any)[k];
      else (out as any)[k] = t;
    }
  }
  return out;
}

// ───────── 解析各种格式 ─────────

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function isFeishuHeader(header: string[]): boolean {
  return header.includes('论文名称') && header.includes('Topic Tags');
}

/** 飞书导出的一行 → 字段 */
export function feishuRow(header: string[], row: string[]): { draft: PaperDraft; raw: Record<string, string> } {
  const raw: Record<string, string> = {};
  header.forEach((h, i) => {
    if ((row[i] ?? '') !== '') raw[h] = row[i];
  });
  const d: PaperDraft = {};
  const notes: string[] = [];
  for (const [h, v] of Object.entries(raw)) {
    const f = FEISHU_MAP[h];
    const val = v.trim();
    if (!f || !val) continue;
    if (f === '_topic') d.tags = splitTags(val);
    else if (f === '_source') {
      // 「来源」多数是发表地；纯中文人名视为推荐人
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(val)) {
        d.recommender = val;
        d.rec_kind = '合作者';
      } else d.venue = val;
    } else if (f === '_card') notes.push(`飞书阅读卡片：${val}`);
    else if (f === '_attach') notes.push(`飞书附件（未随 CSV 导出）：${val}`);
    else (d as any)[f] = val;
  }
  if (notes.length) d.my_note = notes.join('\n');
  if (!d.rec_kind) d.rec_kind = '飞书迁移';
  return { draft: finishDraft(d), raw };
}

export function parseBibtex(text: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^(comment|preamble|string)$/i.test(m[1])) continue;
    let i = re.lastIndex;
    let depth = 1;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    const body = text.slice(start, i - 1);
    re.lastIndex = i;
    const rec: Record<string, string> = { _type: m[1].toLowerCase(), _key: m[2] };
    const fre = /(\w+)\s*=\s*/g;
    let fm: RegExpExecArray | null;
    while ((fm = fre.exec(body))) {
      let j = fre.lastIndex;
      let val = '';
      if (body[j] === '{') {
        let d = 1;
        j++;
        const s = j;
        while (j < body.length && d > 0) {
          if (body[j] === '{') d++;
          else if (body[j] === '}') d--;
          j++;
        }
        val = body.slice(s, j - 1);
      } else if (body[j] === '"') {
        j++;
        const s = j;
        while (j < body.length && !(body[j] === '"' && body[j - 1] !== '\\')) j++;
        val = body.slice(s, j);
        j++;
      } else {
        const s = j;
        while (j < body.length && body[j] !== ',') j++;
        val = body.slice(s, j).trim();
      }
      rec[fm[1].toLowerCase()] = val.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      fre.lastIndex = j;
    }
    out.push(rec);
  }
  return out;
}

export function bibToDraft(b: Record<string, string>): PaperDraft {
  const d: PaperDraft = {
    title: b.title,
    authors: b.author ? b.author.split(/\s+and\s+/i).map((a) => {
      const [last, first] = a.split(',').map((x) => x.trim());
      return first ? `${first} ${last}` : last;
    }).join(', ') : undefined,
    venue: b.booktitle || b.journal || (b.archiveprefix?.toLowerCase() === 'arxiv' ? 'arXiv' : undefined),
    published_date: b.year ? (b.month ? `${b.year}-${monthNum(b.month)}` : b.year) : undefined,
    url: b.url,
    doi: b.doi,
    arxiv_id: b.eprint && (!b.archiveprefix || /arxiv/i.test(b.archiveprefix)) ? b.eprint : undefined,
    abstract: b.abstract,
  };
  return finishDraft(d);
}

function monthNum(m: string): string {
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const i = names.indexOf(m.toLowerCase().slice(0, 3));
  if (i >= 0) return String(i + 1).padStart(2, '0');
  return String(m).padStart(2, '0');
}

/** 从一段对话文字里找 JSON（整段、```json 代码块、或第一个 [ … ] / { … }） */
export function extractJson(text: string): any {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(text.trim());
  if (whole !== undefined) return whole;
  const blocks = [...text.matchAll(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g)].map((m) => tryParse(m[1]));
  const good = blocks.filter((b) => b !== undefined);
  if (good.length === 1) return good[0];
  if (good.length > 1) return good.flatMap((b) => (Array.isArray(b) ? b : listOf(b)));
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const a = text.indexOf(open);
    const b = text.lastIndexOf(close);
    if (a >= 0 && b > a) {
      const p = tryParse(text.slice(a, b + 1));
      if (p !== undefined) return p;
    }
  }
  return undefined;
}

function listOf(j: any): any[] {
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') {
    for (const k of ['papers', 'items', 'data', 'records', 'list', '论文', 'results']) {
      if (Array.isArray(j[k])) return j[k];
    }
    if (j.title || j['论文名称'] || j['标题']) return [j];
  }
  return [];
}

/** Markdown 表格 → 记录 */
export function parseMarkdownTables(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const out: Array<Record<string, string>> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const h = lines[i].trim();
    const sep = lines[i + 1].trim();
    if (!h.startsWith('|') || !/^\|?\s*:?-{2,}/.test(sep)) continue;
    const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const header = cells(h).map(stripMd);
    if (!header.some((x) => ALIASES[keyNorm(x)] === 'title')) continue;
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const row = cells(lines[j]);
      const rec: Record<string, string> = {};
      header.forEach((k, idx) => {
        if (row[idx]) rec[k] = row[idx];
      });
      // 表格单元格里的 [标题](链接)
      for (const [k, v] of Object.entries(rec)) {
        const lm = v.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
        if (lm) {
          rec[k] = stripMd(lm[1]);
          if (!rec._url) rec._url = lm[2];
        } else rec[k] = stripMd(v);
      }
      out.push(rec);
    }
    i = j - 1;
  }
  return out;
}

function stripMd(s: string): string {
  return s.replace(/\*\*|__|`/g, '').replace(/<br\s*\/?>/gi, '\n').trim();
}

export const PLACEHOLDER_TITLE = /^arXiv:\S+（待补全标题）$/;
export const placeholderTitle = (id: string) => `arXiv:${id}（待补全标题）`;

/** 纯文本：找出每行里的链接 / arXiv 号；一行只有一个链接时顺便猜标题 */
export function parseLines(text: string): PaperDraft[] {
  const out: PaperDraft[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const found: PaperDraft[] = [];
    for (const m of l.matchAll(/https?:\/\/[^\s)\]>"'，。；]+/g)) {
      const url = cleanUrl(m[0]);
      if (url) found.push({ url, arxiv_id: arxivFromText(url) });
    }
    for (const m of l.matchAll(/arxiv[:\s]*(\d{4}\.\d{4,5})/gi)) {
      if (!found.some((f) => f.arxiv_id === m[1])) found.push({ arxiv_id: m[1] });
    }
    if (!found.length) {
      const bare = l.match(ARXIV_NEW);
      if (bare && l.replace(bare[0], '').replace(/[\s\-*•\d.、)）]/g, '').length < 4) found.push({ arxiv_id: bare[1] });
    }
    for (const d of found) {
      const key = d.arxiv_id || d.url!;
      if (seen.has(key)) continue;
      seen.add(key);
      if (found.length === 1) {
        const t = guessTitle(l);
        if (t) d.title = t;
      }
      out.push(finishDraft(d));
    }
  }
  return out;
}

function guessTitle(l: string): string | undefined {
  const pats = [/\*\*([^*]{6,})\*\*/, /《([^》]{4,})》/, /"([^"]{8,})"/, /“([^”]{8,})”/, /\[([^\]]{8,})\]\(/];
  for (const p of pats) {
    const m = l.match(p);
    if (m) return m[1].trim();
  }
  const noUrl = l.replace(/https?:\/\/\S+/g, '').replace(/arxiv[:\s]*\d{4}\.\d{4,5}(v\d+)?/gi, '')
    .replace(/^[\s\-*•\d.、)）]+/, '').replace(/[\s:：\-–—|（(]+$/, '').trim();
  return noUrl.length >= 8 ? noUrl : undefined;
}

export interface Parsed { format: string; items: Array<{ draft: PaperDraft; raw: any }>; note?: string }

/** 自动识别格式并解析 */
export function parseAny(text: string, format = 'auto'): Parsed {
  const t = text.replace(/^﻿/, '');
  const fmt = format === 'auto' ? detectFormat(t) : format;
  if (fmt === 'json') {
    const j = extractJson(t);
    const list = listOf(j);
    return {
      format: 'json',
      items: list.filter((r) => r && typeof r === 'object').map((r) => {
        const { draft } = normalizeRecord(r);
        return { draft, raw: r };
      }),
    };
  }
  if (fmt === 'bibtex') {
    return { format: 'bibtex', items: parseBibtex(t).map((b) => ({ draft: bibToDraft(b), raw: b })) };
  }
  if (fmt === 'csv') {
    const rows = parseCsv(t);
    if (rows.length < 2) return { format: 'csv', items: [] };
    const header = rows[0].map((h) => h.trim());
    if (isFeishuHeader(header)) {
      return {
        format: 'feishu',
        items: rows.slice(1).map((r) => feishuRow(header, r)).filter((x) => x.draft.title).map(({ draft, raw }) => ({ draft, raw })),
      };
    }
    return {
      format: 'csv',
      items: rows.slice(1).map((r) => {
        const rec: Record<string, string> = {};
        header.forEach((h, i) => {
          if (r[i]) rec[h] = r[i];
        });
        return { draft: normalizeRecord(rec).draft, raw: rec };
      }),
    };
  }
  if (fmt === 'markdown') {
    return {
      format: 'markdown',
      items: parseMarkdownTables(t).map((rec) => {
        const { _url, ...rest } = rec;
        const { draft } = normalizeRecord(rest);
        if (_url && !draft.url) Object.assign(draft, finishDraft({ ...draft, url: _url }));
        return { draft, raw: rec };
      }),
    };
  }
  return { format: 'lines', items: parseLines(t).map((d) => ({ draft: d, raw: d })) };
}

export function detectFormat(t: string): string {
  const s = t.trim();
  if (/^[\[{]/.test(s) || /```json/i.test(s)) {
    if (extractJson(s) !== undefined) return 'json';
  }
  if (/@\w+\s*\{[^,]*,/.test(s) && /title\s*=/.test(s)) return 'bibtex';
  const first = s.split(/\r?\n/, 1)[0];
  const cols = first.split(first.includes('\t') ? '\t' : ',').map((x) => x.replace(/"/g, '').trim());
  if (cols.length >= 2 && cols.some((c) => ALIASES[keyNorm(c)] === 'title')) return 'csv';
  if (/^\s*\|.*\|\s*$/m.test(s) && parseMarkdownTables(s).length) return 'markdown';
  if (extractJson(s) !== undefined && listOf(extractJson(s)).length) return 'json';
  return 'lines';
}

// ───────── 查重 ─────────

export function normTitle(t: unknown): string {
  return String(t || '')
    .toLowerCase()
    .replace(/【[^】]*】/g, '')
    .replace(/[《》<>]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * inter) / total;
}

export interface Existing {
  id: number; title: string; arxiv_id?: string | null; doi?: string | null; url?: string | null; stage?: string | null;
}
/** certain = 有可靠标识符（arXiv / DOI / 链接）或标题完全相同；否则只是「疑似重复」，不自动合并 */
export interface Match { id: number; title: string; certain: boolean; why: string; stage?: string | null }

function normUrl(u: unknown): string {
  return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/v\d+$/, '');
}

export function findDuplicate(d: PaperDraft, pool: Existing[]): Match | undefined {
  const nt = normTitle(d.title);
  let best: Match | undefined;
  let bestSim = 0;
  for (const p of pool) {
    const base = { id: p.id, title: p.title, stage: p.stage };
    if (d.arxiv_id && p.arxiv_id && d.arxiv_id === p.arxiv_id) return { ...base, certain: true, why: `arXiv ${d.arxiv_id} 相同` };
    if (d.doi && p.doi && String(d.doi).toLowerCase() === p.doi.toLowerCase()) return { ...base, certain: true, why: `DOI ${d.doi} 相同` };
    if (d.url && p.url && normUrl(d.url) === normUrl(p.url)) return { ...base, certain: true, why: '链接相同' };
    const pt = normTitle(p.title);
    if (!nt || !pt) continue;
    // 双方都有 arXiv 号但不同：最多算疑似
    const idsDiffer = !!(d.arxiv_id && p.arxiv_id && d.arxiv_id !== p.arxiv_id);
    if (nt === pt && !idsDiffer) return { ...base, certain: true, why: '标题完全相同' };
    let sim = similarity(nt, pt);
    const [short, long] = nt.length < pt.length ? [nt, pt] : [pt, nt];
    if (short.length >= 12 && long.includes(short)) sim = Math.max(sim, 0.9);
    if (sim > bestSim) {
      bestSim = sim;
      best = { ...base, certain: false, why: `标题相似 ${Math.round(sim * 100)}%` };
    }
  }
  return bestSim >= 0.8 ? best : undefined;
}

function sameValue(field: string, a: unknown, b: unknown): boolean {
  const x = String(a ?? '').trim().toLowerCase();
  const y = String(b ?? '').trim().toLowerCase();
  if (x === y) return true;
  if (field === 'published_date') return x.startsWith(y) || y.startsWith(x);
  return normTitle(x) === normTitle(y);
}

export interface MergePlan {
  fill: Record<string, any>;                               // 已有为空 → 补上
  conflicts: Array<{ field: string; old: any; new: any }>; // 发表信息不一致 → 等待确认
  links: Array<{ label: string; url: string }>;            // 不同链接 → 作为其他版本保留
}

/** 合并规则：只补空字段；个人字段不碰；发表信息冲突列出来；不同链接作为版本保留；标签取并集 */
export function planMerge(existing: Record<string, any>, incoming: PaperDraft): MergePlan {
  const fill: Record<string, any> = {};
  const conflicts: MergePlan['conflicts'] = [];
  const links: MergePlan['links'] = [];
  const known = new Set<string>([existing.url, existing.pdf_url, existing.code_url, ...safeJson<any[]>(existing.links, []).map((l) => l.url)].filter(Boolean).map(normUrl));
  for (const f of PAPER_FIELDS) {
    if (f === 'title' || (PERSONAL_FIELDS as readonly string[]).includes(f)) continue;
    const v = (incoming as any)[f];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const cur = existing[f];
    if (f === 'tags') {
      const curTags: string[] = Array.isArray(cur) ? cur : safeJson(cur, []);
      const merged = [...new Set([...curTags, ...(v as string[])])];
      if (merged.length !== curTags.length) fill.tags = merged;
      continue;
    }
    if (cur == null || cur === '') {
      fill[f] = v;
      continue;
    }
    if (sameValue(f, cur, v)) continue;
    if ((CONFLICT_FIELDS as readonly string[]).includes(f)) conflicts.push({ field: f, old: cur, new: v });
    else if ((f === 'url' || f === 'pdf_url' || f === 'code_url') && !known.has(normUrl(v))) {
      links.push({ label: f === 'url' ? '其他版本' : f === 'pdf_url' ? 'PDF' : '代码', url: String(v) });
      known.add(normUrl(v));
    }
  }
  return { fill, conflicts, links };
}

export function safeJson<T>(s: unknown, dflt: T): T {
  if (typeof s !== 'string') return (s as T) ?? dflt;
  try {
    return JSON.parse(s) as T;
  } catch {
    return dflt;
  }
}
