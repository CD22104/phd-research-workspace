export const MATERIAL = { paper: '论文', survey: '综述', technical_report: '技术报告', official_article: '官方文章', research_post: '研究文章', unknown: '类型待确认' };
export const VERIFIED = { verified: '已核验', partial: '部分核验', unverified: '待核验' };
export const bibliographic = (p) => [p.authors ? p.authors.split(/,|，/).slice(0, 2).join(', ') + (p.authors.split(/,|，/).length > 2 ? ' 等' : '') : '', p.published_date?.slice(0, 4), p.venue].filter(Boolean).join(' · ');
