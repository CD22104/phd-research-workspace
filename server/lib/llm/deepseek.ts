// 用 DeepSeek 抽取论文条目（OpenAI 兼容接口）
import { EXTRACT_SYSTEM, PAPER_KEYS, wrapDocument } from './prompt';

export async function extractWithDeepseek(apiKey: string, text: string): Promise<any[]> {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${EXTRACT_SYSTEM}\n每个条目包含这些键：${PAPER_KEYS.join(', ')}（tags 为字符串数组，其余为字符串）。` },
        { role: 'user', content: wrapDocument(text) },
      ],
    }),
  });
  if (!r.ok) throw new Error(`DeepSeek 返回 ${r.status}`);
  const j: any = await r.json();
  if (j.choices?.[0]?.finish_reason === 'length') throw new Error('内容太长，模型输出被截断，请分段粘贴');
  return JSON.parse(j.choices?.[0]?.message?.content || '{}').papers || [];
}
