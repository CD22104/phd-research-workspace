#!/usr/bin/env node
/**
 * 线上 MCP 最小验收（Node >= 18，无依赖）。默认只显示说明；加 --run 才执行。
 *
 * 已在环境中设置 HONEY_URL、CF_ACCESS_CLIENT_ID、CF_ACCESS_CLIENT_SECRET 后：
 *   node tests/smoke_mcp.mjs --run
 *
 * 前提：库中已有 ReAct 论文；使用 MCP 服务令牌，不是 Cloudflare 管理 Token。
 * 执行会创建一条带 UUID / example.org 链接的测试候选，重复提交后先预览再撤销。
 * 不创建随手记、Idea 或阅读计划；不输出服务端正文、令牌或错误响应内容。
 * 正常验收最多 150 秒；失败后最多用 40 秒清理本次批次，再终止子进程。
 * 撤销保留来源和变更审计记录。网络故障、强制终止、未完成的远程写入或用户
 * 同时编辑测试论文可能妨碍清理；失败时保留输出的 UUID / source_id 供人工核验。
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HELP = `Usage: node tests/smoke_mcp.mjs --run
Required environment: HONEY_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
Requires an existing ReAct paper. Creates one uniquely marked test candidate,
checks idempotency, then previews and confirms undo. Source/audit rows remain.
Default: help only. No credentials are read from files. No note or Idea is created.
Limits: 20s/request, 150s/test, 40s/best-effort cleanup. Hard kills or network
failures can leave the test batch; use the printed run UUID/source_id to inspect it.`;

class SmokeError extends Error {}
const requireThat = (ok, message) => { if (!ok) throw new SmokeError(message); };
const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
  console.log(HELP);
} else if (args.length !== 1 || args[0] !== '--run') {
  console.error(HELP);
  process.exitCode = 2;
} else {
  await run().catch((e) => {
    console.error(`FAIL: ${e instanceof SmokeError ? e.message : 'unexpected local failure; response details suppressed'}`);
    process.exitCode = 1;
  });
}

async function run() {
  for (const name of ['HONEY_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET']) {
    requireThat(process.env[name]?.trim(), `Missing environment variable: ${name}`);
  }
  let base;
  try { base = new URL(process.env.HONEY_URL); } catch { throw new SmokeError('HONEY_URL is not a valid URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  requireThat(base.protocol === 'https:' || (loopback && base.protocol === 'http:'), 'HONEY_URL must use HTTPS (HTTP is allowed only on loopback)');
  requireThat(!base.username && !base.password && !base.search && !base.hash && /^\/*$/.test(base.pathname), 'HONEY_URL must be an origin without credentials, path, query or fragment');
  const origin = base.origin;
  const headers = {
    'Content-Type': 'application/json', 'X-Requested-With': 'honey-mcp-smoke', 'X-Actor': 'mcp',
    'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
  };
  const uuid = randomUUID();
  const title = `MCP smoke test candidate ${uuid}`;
  const url = `https://example.org/honey-mcp-smoke/${uuid}`;
  const sourceName = `MCP smoke test ${uuid}`;
  const papers = [{ title, url, summary: 'Temporary smoke-test fixture; not a research paper.', rec_reason: 'Automated MCP smoke test; remove by undoing this import.' }];
  const addArgs = { papers, source_name: sourceName, stage: 'candidate' };
  // Match honey-mcp.mjs exactly, so even a lost commit response can be recovered safely.
  const importKey = 'mcp-' + createHash('sha256').update(JSON.stringify({ p: papers, s: sourceName, st: 'candidate' })).digest('hex').slice(0, 32);
  let sourceId, paperId, writeAttempted = false, cleaned = false, checks = 0;
  let phase = new AbortController();
  const onSignal = () => phase.abort();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  let deadline = setTimeout(() => phase.abort(), 150_000);
  const proc = spawn(process.execPath, [fileURLToPath(new URL('../mcp/honey-mcp.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, HONEY_URL: origin, CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const rl = createInterface({ input: proc.stdout });
  const pending = new Map();
  let nextId = 1, stopped = false;
  const rejectPending = () => { for (const entry of [...pending.values()]) entry.reject(new SmokeError('MCP process stopped or returned invalid JSON')); };
  proc.on('error', rejectPending);
  proc.on('exit', rejectPending);
  proc.stdin.on('error', rejectPending);
  rl.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { rejectPending(); return; }
    pending.get(message.id)?.resolve(message);
  });
  const check = (ok, message) => { requireThat(ok, message); checks++; console.log(`  PASS: ${message}`); };
  console.log(`MCP smoke run UUID: ${uuid}`);

  async function rpc(method, params) {
    requireThat(!phase.signal.aborted && !stopped && proc.exitCode === null && !proc.killed, 'MCP request cancelled or process unavailable');
    const result = await new Promise((resolve, reject) => {
      const id = nextId++;
      const signal = phase.signal;
      const finish = (fn, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); pending.delete(id); fn(value); };
      const abort = () => finish(reject, new SmokeError('MCP request cancelled or test deadline exceeded'));
      const timer = setTimeout(() => finish(reject, new SmokeError('MCP request timed out')), 20_000);
      pending.set(id, { resolve: (v) => finish(resolve, v), reject: (e) => finish(reject, e) });
      signal.addEventListener('abort', abort, { once: true });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    requireThat(!result.error && result.result, 'MCP returned a protocol error');
    return result.result;
  }

  async function call(name, args) {
    const result = await rpc('tools/call', { name, arguments: args });
    requireThat(!result.isError, `MCP tool failed: ${name} (response suppressed)`);
    const text = result.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    requireThat(typeof text === 'string' && text.length, `MCP tool returned no text: ${name}`);
    return text;
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch { throw new SmokeError('MCP returned malformed data (response suppressed)'); }
  }

  async function web(path, { method = 'GET', body, status = 200 } = {}) {
    requireThat(!phase.signal.aborted, 'API request cancelled or phase deadline exceeded');
    const controller = new AbortController();
    const signal = phase.signal;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 20_000);
    try {
      const response = await fetch(origin + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: controller.signal });
      requireThat(response.status === status, `API returned unexpected HTTP ${response.status} (response suppressed)`);
      return await response.json();
    } catch (e) {
      if (e instanceof SmokeError) throw e;
      throw new SmokeError('API request failed, timed out or returned non-JSON (details suppressed)');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async function ownSource() {
    requireThat(Number.isSafeInteger(sourceId) && sourceId > 0, 'No valid source_id for this test');
    const result = await web(`/sources/${sourceId}`);
    const s = result.source;
    requireThat(s?.id === sourceId && s.name === sourceName && s.kind === 'claude' && s.raw === JSON.stringify(papers)
      && [importKey, `${importKey}#undone-${sourceId}`].includes(s.import_key), 'Refusing undo: source does not match this run');
    requireThat(Array.isArray(result.summary?.merged) && result.summary.merged.length === 0, 'Refusing undo: test source unexpectedly merged an existing paper');
    for (const rec of result.recommendations || []) {
      const detail = await web(`/papers/${rec.paper_id}`);
      requireThat(detail.paper?.title === title && detail.paper.url === url && detail.paper.source_id === sourceId, 'Refusing undo: source contains a paper not owned by this run');
    }
    return result;
  }

  async function verifyGone() {
    const source = await ownSource();
    requireThat(source.source.undone_at && source.recommendations.length === 0, 'Undo did not clear test recommendations / mark the source undone');
    const results = await web('/search?q=' + encodeURIComponent(uuid));
    requireThat(Array.isArray(results.papers) && results.papers.length === 0, 'Test candidate is still searchable');
    if (paperId) await web(`/papers/${paperId}`, { status: 404 });
    cleaned = true;
  }

  async function stopMcp() {
    if (stopped) return;
    stopped = true;
    rejectPending();
    rl.close();
    proc.stdin.destroy();
    proc.stdout.destroy();
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => { proc.off('exit', done); resolve(); }, 1_000);
        const done = () => { clearTimeout(timer); resolve(); };
        proc.once('exit', done);
      });
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }
  }

  async function cleanup() {
    if (!sourceId) {
      // Covers a successful commit whose stdio/API response was lost. Never use title prefixes.
      const sources = (await web('/sources')).sources;
      requireThat(Array.isArray(sources), 'Cannot discover the test source for cleanup');
      const matches = sources.filter((s) => s.name === sourceName && s.kind === 'claude');
      requireThat(matches.length <= 1, 'Refusing cleanup: more than one matching test source');
      if (!matches.length) throw new SmokeError('No test source found after an attempted write; inspect the run UUID if the remote request was still pending');
      sourceId = matches[0].id;
      console.log(`Cleanup source_id: ${sourceId}`);
    }
    const source = await ownSource();
    if (!source.source.undone_at) {
      const preview = await web(`/sources/${sourceId}/undo`, { method: 'POST', body: { confirm: false }, status: 409 });
      requireThat(preview.data?.needs_confirm && preview.data.preview?.undo_source?.id === sourceId
        && preview.data.preview.undo_source.name === sourceName, 'Refusing cleanup: unexpected undo preview');
      const result = await web(`/sources/${sourceId}/undo`, { method: 'POST', body: { confirm: true } });
      requireThat(result.kept?.length === 0 && result.reverted?.length === 0, 'Cleanup kept modified test data; inspect this run manually');
    }
    await verifyGone();
    console.log('  CLEANUP: this run was undone; candidate and recommendations removed');
  }

  let failure;
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'honey-live-smoke', version: '1' } });
    check(init.serverInfo?.name === 'research-workspace' && init.protocolVersion === '2025-06-18', 'MCP initialization');
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = (await rpc('tools/list', {})).tools;
    check(['search', 'add_papers', 'undo_import'].every((name) => tools?.some((t) => t.name === name)), 'Required MCP tools available');
    // Current MCP has no enrich option; its preview enriches only explicit arXiv IDs.
    // This fixture has none. Pass false if a future version exposes the option.
    if (tools.find((t) => t.name === 'add_papers').inputSchema?.properties?.enrich) addArgs.enrich = false;
    const found = parseJson(await call('search', { q: 'ReAct' }));
    check(found.papers?.some((p) => /react/i.test(`${p.title || ''} ${p.short_name || ''}`)), 'Existing ReAct paper found');
    const before = parseJson(await call('search', { q: uuid }));
    check(Array.isArray(before.papers) && before.papers.length === 0, 'Unique test fixture absent before write');
    writeAttempted = true;
    const added = await call('add_papers', addArgs);
    const match = added.match(/来源记录 #(\d+)/);
    requireThat(match, 'MCP add did not return a source_id');
    sourceId = Number(match[1]);
    console.log(`Test source_id: ${sourceId}`);
    check(added.includes('已放进候选区') && !added.includes('之前已导入过'), 'One test candidate created');
    await ownSource();
    const inbox = await web('/inbox');
    const candidates = inbox.candidates?.filter((p) => p.title === title && p.url === url);
    check(candidates?.length === 1, 'Web inbox contains exactly this test candidate');
    paperId = candidates[0].id;
    const repeated = await call('add_papers', addArgs);
    check(repeated.includes('之前已导入过') && Number(repeated.match(/来源记录 #(\d+)/)?.[1]) === sourceId, 'Identical MCP submission reuses the source');
    const count = (await web('/papers?stage=candidate')).papers?.filter((p) => p.title === title && p.url === url).length;
    const source = await ownSource();
    check(count === 1 && source.recommendations.length === 1, 'No duplicate candidate or recommendation');
    const previewText = await call('undo_import', { source_id: sourceId });
    const previewMatch = previewText.match(/变更预览：\n([\s\S]*?)\n请把预览/);
    requireThat(previewMatch, 'MCP undo did not return a confirmation preview');
    const preview = parseJson(previewMatch[1]);
    check(preview.undo_source?.id === sourceId && preview.undo_source.name === sourceName, 'Undo preview matches this run');
    check((await web(`/papers/${paperId}`)).paper?.id === paperId && !(await ownSource()).source.undone_at, 'Preview leaves the candidate intact');
    const undone = await call('undo_import', { source_id: sourceId, confirm: true });
    check(undone.includes('删除 1 篇') && undone.includes('改回 0 个字段') && !undone.includes('保留'), 'Confirmed undo removes only the test candidate');
    await verifyGone();
    check(cleaned, 'Candidate and recommendations removed; audit source marked undone');
  } catch (e) {
    failure = e;
  } finally {
    clearTimeout(deadline);
    await stopMcp();
    if (writeAttempted && !cleaned) {
      phase = new AbortController();
      deadline = setTimeout(() => phase.abort(), 40_000);
      try { await cleanup(); } catch (e) {
        console.error(`CLEANUP INCOMPLETE for run ${uuid}${sourceId ? `, source_id ${sourceId}` : ''}: ${e instanceof SmokeError ? e.message : 'unexpected failure; details suppressed'}`);
        failure ||= new SmokeError('Test cleanup did not finish');
      } finally { clearTimeout(deadline); }
    }
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  if (failure) throw failure;
  console.log(`MCP smoke passed: ${checks} checks. Test candidate removed; source/audit history retained.`);
}
