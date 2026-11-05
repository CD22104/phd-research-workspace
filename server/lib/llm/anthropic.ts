// 用 Claude 抽取论文条目（官方 SDK）
import Anthropic from '@anthropic-ai/sdk';
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM, wrapDocument } from './prompt';

export async function extractWithClaude(apiKey: string, text: string): Promise<any[]> {
  const client = new Anthropic({ apiKey });
  const params: any = {
    model: 'claude-opus-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: wrapDocument(text) }],
  };
  const res = await client.beta.messages.create(params);
  if (res.stop_reason === 'refusal') throw new Error('模型拒绝处理这段内容');
  if (res.stop_reason === 'max_tokens') throw new Error('内容太长，模型输出被截断，请分段粘贴');
  const out = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  return JSON.parse(out).papers || [];
}
