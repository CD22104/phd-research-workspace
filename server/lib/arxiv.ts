// arXiv 元数据（只访问 export.arxiv.org 这一个固定地址，不抓取用户给的任意链接）
import { normTitle, similarity } from './papers';

export interface ArxivMeta {
  arxiv_id: string;
  title: string;
  authors: string;
  abstract: string;
  published_date: string;
  url: string;
  pdf_url: string;
  venue_hint?: string;   // journal_ref / comment 里写的会议信息
  doi?: string;
}

const API = 'https://export.arxiv.org/api/query';

function text(s: string | undefined): string {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : undefined;
}

export function parseAtom(xml: string): ArxivMeta[] {
  const out: ArxivMeta[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const idUrl = text(tag(e, 'id'));
    const idm = idUrl.match(/abs\/(.+?)(v\d+)?$/);
    if (!idm) continue;
    const title = text(tag(e, 'title'));
    if (!title || /^error$/i.test(title)) continue;
    const authors = [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => text(a[1]));
    const journal = text(tag(e, 'arxiv:journal_ref'));
    const comment = text(tag(e, 'arxiv:comment'));
    const venue = journal || (comment.match(/(accepted|published|to appear)[^.;]*(at|in|by)\s+([^.;]+)/i)?.[3] ?? '');
    out.push({
      arxiv_id: idm[1],
      title,
      authors: authors.join(', '),
      abstract: text(tag(e, 'summary')),
      published_date: text(tag(e, 'published')).slice(0, 10),
      url: `https://arxiv.org/abs/${idm[1]}`,
      pdf_url: `https://arxiv.org/pdf/${idm[1]}`,
      venue_hint: venue ? venue.slice(0, 120) : undefined,
      doi: text(tag(e, 'arxiv:doi')) || undefined,
    });
  }
  return out;
}

async function query(params: Record<string, string>): Promise<ArxivMeta[]> {
  const url = `${API}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'research-workspace/0.1 (personal research workspace)' } });
  if (!r.ok) throw new Error(`arXiv 返回 ${r.status}`);
  return parseAtom(await r.text());
}

export async function byIds(ids: string[]): Promise<Map<string, ArxivMeta>> {
  const out = new Map<string, ArxivMeta>();
  const uniq = [...new Set(ids)].slice(0, 50);
  if (!uniq.length) return out;
  for (const m of await query({ id_list: uniq.join(','), max_results: String(uniq.length) })) out.set(m.arxiv_id, m);
  return out;
}

/** 按标题查 arXiv；只有标题足够接近时才返回（相似度 ≥ 0.9） */
export async function byTitle(title: string): Promise<ArxivMeta | undefined> {
  const clean = title.replace(/【[^】]*】|《|》/g, ' ').replace(/[^\p{L}\p{N}\s\-:]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 6) return undefined;
  const words = clean.split(' ').filter((w) => w.length > 2).slice(0, 12);
  const res = await query({ search_query: words.map((w) => `ti:${w.replace(/[:\-]/g, '')}`).join(' AND '), max_results: '5' });
  const nt = normTitle(title);
  let best: ArxivMeta | undefined;
  let bestSim = 0;
  for (const m of res) {
    const sim = similarity(nt, normTitle(m.title));
    if (sim > bestSim) {
      bestSim = sim;
      best = m;
    }
  }
  return bestSim >= 0.9 ? best : undefined;
}
