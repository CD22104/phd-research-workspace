import type { Env } from '../../db';
import { extractWithClaude } from './anthropic';
import { extractWithDeepseek } from './deepseek';

export function llmAvailable(env: Env, provider: string): boolean {
  if (provider === 'anthropic') return !!env.ANTHROPIC_API_KEY;
  if (provider === 'deepseek') return !!env.DEEPSEEK_API_KEY;
  return false;
}

/** 抽取论文；返回的记录用通用别名解析（year → published_date 等） */
export async function extractPapers(env: Env, provider: string, text: string): Promise<any[]> {
  if (text.length > 60000) throw new Error('内容超过 6 万字，请分段粘贴');
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) return extractWithClaude(env.ANTHROPIC_API_KEY, text);
  if (provider === 'deepseek' && env.DEEPSEEK_API_KEY) return extractWithDeepseek(env.DEEPSEEK_API_KEY, text);
  throw new Error('服务器没有配置大模型，请用结构化格式（JSON / 表格 / BibTeX / 链接列表）');
}
