// Browser regression for long notes. Point only at a fresh local database.
// PLAYWRIGHT_MODULE and CHROMIUM_PATH can select an existing browser installation.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://127.0.0.1:18974';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Use an isolated local database.');
const out = process.env.NOTE_TEST_OUTPUT || '/tmp/note-page-browser';mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = [];
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const request = async (method, path, data) => {
  const r = await context.request.fetch(origin + '/api' + path, { method, data, headers: { 'X-Requested-With': 'notes-ui-test', 'X-Actor': 'web' } });
  assert(r.ok(), method + ' ' + path + ': ' + r.status());return r.json();
 };
 const project = await request('POST', '/projects', { name: '独立笔记页验收 ' + Date.now() });
 const markdown = '# 讨论后的实验设计\n\n' + Array.from({ length: 120 }, (_, n) => `## ${n + 1}. 研究问题\n\n长文阅读和编辑验证：保留每一段 Markdown，保存按钮始终可见。\n\n公式 $E=mc^2$。\n\n| 指标 | 结果 |\n| --- | --- |\n| 准确率 | 0.95 |\n\n\`\`\`python\nprint("section ${n + 1}")\n\`\`\`\n`).join('\n');
 const note = await request('POST', '/notes', { project_id: project.id, title: '长篇讨论记录', content: markdown });
 const p = await context.newPage(), errors = [];
 p.on('pageerror', e => errors.push(e.message));
 await p.goto(origin + '/projects/' + project.id);
 await p.getByRole('link', { name: '长篇讨论记录', exact: true }).click();
 await p.getByTestId('note-reader').waitFor();
 assert.equal(await p.locator('textarea').count(), 0);
 assert.equal(await p.locator('.note-reader table').count(), 120);
 assert.equal(await p.locator('.note-reader .katex').count(), 120);
 const visibleSave = async page => {
  const r = await page.getByTestId('note-save').boundingBox();const width = page.viewportSize().width;
  assert(r && r.y >= 0 && r.y + r.height < 160 && r.x >= 0 && r.x + r.width <= width, 'Save must remain in the top viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'No horizontal overflow');
 };
 await p.screenshot({ path: out + '/desktop-read.png' });
 await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));await visibleSave(p);
 await p.getByRole('button', { name: '编辑笔记', exact: true }).click();
 const text = p.getByRole('textbox', { name: 'Markdown 正文', exact: true });await text.waitFor();
 const sizes = await text.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight }));
 assert(sizes.client < 1000 && sizes.scroll > sizes.client * 5, 'Long editor should scroll internally');
 await text.fill(markdown + '\n键盘保存测试');
 await p.keyboard.press('Control+s');
 await p.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 assert.equal((await request('GET', '/notes/' + note.id)).content, markdown + '\n键盘保存测试');
 await visibleSave(p);await p.screenshot({ path: out + '/desktop-edit.png' });
 report.push('project entry, full reading, formulas/tables, bounded editor, sticky save, Ctrl+S');

 // Unsaved navigation can be cancelled without dropping the draft.
 await text.fill('未保存的内容');
 await p.getByRole('button', { name: '‹ 返回项目', exact: true }).click();
 await p.getByText('离开这篇笔记？', { exact: true }).waitFor();
 await p.getByRole('button', { name: '取消', exact: true }).click();
 assert.equal(await text.inputValue(), '未保存的内容');assert(new URL(p.url()).pathname.startsWith('/notes/'));
 await p.getByRole('button', { name: '‹ 返回项目', exact: true }).click();
 await p.getByRole('button', { name: '放弃修改并离开', exact: true }).click();
 await p.getByRole('link', { name: '编辑', exact: true }).click();await text.waitFor();
 report.push('unsaved leave guard, cancel preserves draft, explicit discard, direct edit entry');

 // A request in flight must not erase text entered after clicking save.
 let entered, release;
 const arrived = new Promise(r => entered = r), gate = new Promise(r => release = r);
 const url = '**/api/notes/' + note.id;
 await p.route(url, async route => {
  if (route.request().method() !== 'PATCH') return route.continue();
  const response = await route.fetch();entered();await gate;await route.fulfill({ response });
 });
 await text.fill('保存时提交的内容');await p.getByTestId('note-save').click();await arrived;
 await text.fill('保存期间继续输入的内容');release();
 await p.waitForFunction(() => !document.querySelector('[data-testid=note-save]').disabled);
 assert.equal(await text.inputValue(), '保存期间继续输入的内容');
 assert.equal((await request('GET', '/notes/' + note.id)).content, '保存时提交的内容');
 await p.unroute(url);await p.getByTestId('note-save').click();
 await p.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 report.push('typing during save stays dirty and survives response');

 // Failed saves keep the draft, then a retry persists it.
 await p.route(url, route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'test outage' }) }) : route.continue());
 await text.fill('断网时保留的草稿');await p.getByTestId('note-save').click();
 await p.getByText('test outage', { exact: true }).waitFor();assert.equal(await text.inputValue(), '断网时保留的草稿');
 await p.unroute(url);await p.getByTestId('note-save').click();await p.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 assert.equal((await request('GET', '/notes/' + note.id)).content, '断网时保留的草稿');
 report.push('failed save retains draft; retry works');

 // A stale version never overwrites silently; both cancel and explicit overwrite work.
 const current = await request('GET', '/notes/' + note.id);
 await request('PATCH', '/notes/' + note.id, { content: '另一设备的版本', base_version: current.version });
 await text.fill('我的冲突草稿');await p.getByTestId('note-save').click();
 await p.getByText('笔记在其他地方更新过', { exact: true }).waitFor();
 await p.getByRole('button', { name: '取消', exact: true }).click();
 assert.equal(await text.inputValue(), '我的冲突草稿');assert.equal((await request('GET', '/notes/' + note.id)).content, '另一设备的版本');
 await p.getByTestId('note-save').click();await p.getByRole('button', { name: '覆盖保存', exact: true }).click();
 await p.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 assert.equal((await request('GET', '/notes/' + note.id)).content, '我的冲突草稿');
 await p.getByRole('button', { name: '更多笔记操作', exact: true }).click();
 await p.getByText('保存并存为版本', { exact: true }).click();
 await p.getByText('已保存并存为正式版本', { exact: true }).waitFor();
 const versions = await request('GET', '/versions?entity=note&entity_id=' + note.id);
 assert.equal(versions.versions.length, 1);
 assert.equal((await request('GET', '/versions/' + versions.versions[0].id)).content, '我的冲突草稿');
 report.push('conflict cancel/overwrite and formal version retain content');

 // New notes are created once and receive a URL that can be reloaded.
 await p.getByRole('button', { name: '‹ 返回项目', exact: true }).click();
 await p.getByRole('button', { name: '＋ 新建', exact: true }).click();await text.waitFor();
 await p.getByRole('textbox', { name: '笔记标题', exact: true }).fill('新页面的新笔记');
 await text.fill('首次保存');await p.keyboard.press('Meta+s');
 await p.waitForURL(/\/notes\/\d+/);
 await p.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 const newId = Number(new URL(p.url()).pathname.split('/').at(-1));assert.notEqual(newId, note.id);
 await text.fill('第二次保存');await p.getByTestId('note-save').click();
 await p.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 assert.equal((await request('GET', '/projects/' + project.id)).notes.length, 2);
 await p.reload();await text.waitFor();assert.equal(await text.inputValue(), '第二次保存');
 report.push('new note, Cmd+S, no duplicate records, direct URL reload');

 // Paper notes use the same full page and can return to the paper drawer.
 const paperTitle = '论文笔记入口验收 ' + Date.now();
 const paper = (await request('POST', '/papers', { title: paperTitle, enrich: false })).created[0];
 const paperNote = await request('POST', '/notes', { paper_id: paper, title: '论文专属笔记', content: '# 论文正文' });
 await p.goto(origin + '/papers');await p.getByText(paperTitle, { exact: true }).first().click();
 await p.locator('.n-drawer').getByText('笔记（1）', { exact: true }).click();
 await p.getByRole('button', { name: '展开阅读', exact: true }).click();
 await p.getByTestId('note-reader').waitFor();assert.equal(new URL(p.url()).pathname, '/notes/' + paperNote.id);
 await p.getByRole('button', { name: '‹ 返回论文', exact: true }).click();await p.locator('.n-drawer').waitFor();
 report.push('paper note full-page entry and return');
 assert.deepEqual(errors, []);await p.close();

 const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
 const m = await mobile.newPage();m.on('pageerror', e => errors.push(e.message));
 await request('PATCH', '/notes/' + note.id, { content: markdown });
 await m.goto(origin + '/notes/' + note.id);await m.getByTestId('note-reader').waitFor();
 await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));await visibleSave(m);
 await m.screenshot({ path: out + '/mobile-read-bottom.png' });
 await m.getByRole('button', { name: '编辑笔记', exact: true }).click();
 const mt = m.getByRole('textbox', { name: 'Markdown 正文', exact: true });await mt.waitFor();
 await mt.fill(markdown + '\n手机末尾');await mt.evaluate(el => el.scrollTop = el.scrollHeight);await visibleSave(m);
 await m.getByTestId('note-save').click();await m.waitForFunction(() => document.querySelector('.save-status').textContent.startsWith('已保存'));
 assert.equal((await request('GET', '/notes/' + note.id)).content, markdown + '\n手机末尾');
 await m.screenshot({ path: out + '/mobile-edit.png' });
 await m.goto(origin + '/notes/999999999');await m.getByText('无法打开笔记', { exact: true }).waitFor();
 assert.deepEqual(errors, []);report.push('390px: long reading/editing, top save, persistence, missing-note state');
 await mobile.close();await context.close();
} finally { await browser.close();writeFileSync(out + '/report.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.length, checks: report }));
