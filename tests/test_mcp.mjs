// MCP 最小流程验收：搜索 → 新增测试记录 → 网页能查到 → 重复提交不重复 → 撤销（先预览再确认）
// 用法：HONEY_URL=http://127.0.0.1:8790 node tests/test_mcp.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const proc = spawn(process.execPath, [new URL('../mcp/honey-mcp.mjs', import.meta.url).pathname], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: proc.stdout });
const waiting = new Map();
rl.on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
let nid = 1;
const rpc = (method, params) => new Promise((res) => { const id = nid++; waiting.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return r.result.content[0].text; };
const web = async (p) => (await fetch(process.env.HONEY_URL + '/api' + p, { headers: { 'X-Requested-With': 't' } })).json();
let ok = 0;
const check = (c, m) => { if (!c) { console.error('✗', m); process.exit(1); } ok++; console.log('  ✓', m); };

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
check(init.result.serverInfo.name === 'research-workspace', `初始化，协议 ${init.result.protocolVersion}`);
const tools = (await rpc('tools/list', {})).result.tools;
check(tools.length >= 20, `工具 ${tools.length} 个`);

const found = await call('search', { q: 'ReAct' });
check(found.includes('ReAct'), '搜索到已有论文');

const papers = [{ title: 'MCP Test Paper: Honey Bears Read Papers', url: 'https://example.org/honey-test', summary: '测试用', rec_reason: '测试 MCP 流程' }];
const r1 = await call('add_papers', { papers, source_name: 'MCP 验收测试' });
check(r1.includes('已放进候选区'), '新增测试记录进候选区');
const sid = Number(r1.match(/来源记录 #(\d+)/)[1]);
const inbox = await web('/inbox');
check(inbox.candidates.some((p) => p.title.startsWith('MCP Test Paper')), '网页收件箱能查到');

const r2 = await call('add_papers', { papers, source_name: 'MCP 验收测试' });
check(r2.includes('之前已导入过'), '重复提交：没有重复写入');
const count = (await web('/papers?stage=candidate')).papers.filter((p) => p.title.startsWith('MCP Test Paper')).length;
check(count === 1, '候选区只有一条');

const u1 = await call('undo_import', { source_id: sid });
check(u1.includes('需要确认'), '撤销：先返回预览');
const u2 = await call('undo_import', { source_id: sid, confirm: true });
check(u2.includes('已撤销') && u2.includes('删除 1 篇'), '确认后撤销成功');
const gone = (await web('/papers?stage=candidate')).papers.every((p) => !p.title.startsWith('MCP Test Paper'));
check(gone, '网页上已看不到测试记录');

const t = await call('get_today', {});
check(t.includes('tasks'), '读取今日');
const created = await call('create_idea', { title: 'MCP 测试 Idea', one_liner: '默认不发送给外部模型', content: '这段正文不应该返回给模型' });
const ideaId = Number(created.match(/#(\d+)/)[1]);
const idea = JSON.parse(await call('get_idea', { id: ideaId }));
check(idea.content.includes('不发送给外部模型'), '标记为不发送给外部模型的 Idea 不返回正文');
const cap = await call('capture', { content: 'MCP 测试随手记' });
check(cap.includes('收件箱'), '随手记');

// 删除论文：先预览、确认后才删；笔记、计划一起删除，任务保留但解除关联
const stamp = Date.now().toString(36);
const del = await call('add_papers', { papers: [{ title: `MCP Delete Test ${stamp}`, url: `https://example.org/delete-${stamp}`, purpose: '测试删除' }], stage: 'library', source_name: `删除测试 ${stamp}` });
check(del.includes('已加入清单'), '新增一篇待删除的测试论文');
const target = (await web('/papers')).papers.find((p) => p.title === `MCP Delete Test ${stamp}`);
await call('add_note', { title: '测试笔记', content: '会被一起删除', paper_id: target.id });
const task = await call('add_task', { title: `读删除测试论文 ${stamp}`, paper_id: target.id });
const taskId = Number(task.match(/#(\d+)/)[1]);
const preview = await call('delete_papers', { ids: [target.id] });
check(preview.includes('将删除 1 篇') && preview.includes('笔记 1') && preview.includes('confirm'), '删除：先返回预览（含笔记数量）');
check((await web(`/papers/${target.id}`)).paper?.id === target.id, '只预览时论文仍在');
const removed = await call('delete_papers', { ids: [target.id], confirm: true });
check(removed.includes('已删除 1 篇'), '确认后删除成功');
check((await web(`/papers/${target.id}`)).error, '网页上已查不到这篇论文');
const day = await web('/day/today');
const t2 = day.tasks.find((x) => x.id === taskId);
check(t2 && !t2.paper_id && !(t2.paper_ids || []).includes(target.id), '关联的任务保留，只解除论文关联');
const again = await call('delete_papers', { ids: [target.id], confirm: true });
check(again.includes('不存在'), '重复删除：提示已不存在，不报错');
console.log(`\nMCP 验收通过：${ok} 项`);
proc.kill();
