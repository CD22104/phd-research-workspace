// 周计划排期板（每天一行 × 上午 / 下午 / 晚上）与今日页按时段分组。只对新建的本机临时库运行。
// 用法：scripts/dev-test-server.sh <临时目录> 18996 & ; PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node tests/test_plan_periods.mjs http://127.0.0.1:18996
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.argv[2] || 'http://127.0.0.1:18996';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Use an isolated local database.');
const out = process.env.PERIOD_TEST_OUTPUT || '/tmp/plan-periods-browser'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = [], errors = [];
try {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const api = async (method, path, data) => {
    const r = await c.request.fetch(origin + '/api' + path, { method, data, headers: { 'X-Requested-With': 'period-ui-test', 'X-Actor': 'web' } });
    assert(r.ok(), method + ' ' + path + ': ' + r.status() + ' ' + await r.text()); return r.json();
  };
  const mon = '2026-10-05', tue = '2026-10-06', wed = '2026-10-07', thu = '2026-10-08';
  await api('POST', '/calendar/events', { title: '机器学习课程', kind: 'course', date: mon, start_time: '09:00', end_time: '11:30' });
  await api('POST', '/calendar/events', { title: '周组会', kind: 'meeting', date: mon, start_time: '13:00', end_time: '14:30' });
  await api('POST', '/calendar/events', { title: '全天学术活动', kind: 'other', date: tue, all_day: true });
  const goal = await api('POST', '/goals', { title: '第三章实验', week_id: mon });
  const gA = await api('POST', '/goal-tasks', { goal_id: goal.id, title: '跑基线' });
  const gB = await api('POST', '/goal-tasks', { goal_id: goal.id, title: '消融实验' });
  const gC = await api('POST', '/goal-tasks', { goal_id: goal.id, title: '整理图表' });
  const tasks = async () => (await api('GET', '/week/' + mon)).tasks;
  const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  const cell = (date, period) => p.getByTestId(`board-cell-${date}-${period || 'none'}`);
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  // 1. 排期板：日程按开始时间进对应时段，全天安排在日期格
  await p.goto(origin + '/week?date=' + mon); await p.getByTestId('plan-board').waitFor();
  await cell(mon, 'morning').getByText('机器学习课程').waitFor();
  await cell(mon, 'afternoon').getByText('周组会').waitFor();
  await cell(tue, null).getByText('全天学术活动').waitFor();
  assert.equal(await cell(mon, 'evening').locator('.board-event').count(), 0);
  assert.equal(await p.locator('[data-testid^=board-day-]').count(), 7);
  report.push('board: 7 day rows; events placed by start time, all-day in the date cell');

  // 2. 任务池拖进某天的「晚」
  await p.getByTestId('goal-task-' + gA.id).dragTo(cell(tue, 'evening'));
  await cell(tue, 'evening').getByText('跑基线').waitFor();
  let a = (await tasks()).find((t) => t.goal_task_id === gA.id);
  assert.deepEqual([a.date, a.period, a.planned], [tue, 'evening', 1]);
  await p.getByTestId('goal-task-' + gA.id).getByText('周二·晚上').waitFor();
  // 3. 格子之间拖：换天又换时段，还是同一条
  await p.getByTestId('plan-chip-' + a.id).dragTo(cell(thu, 'morning'));
  await cell(thu, 'morning').getByText('跑基线').waitFor();
  let moved = (await tasks()).find((t) => t.goal_task_id === gA.id);
  assert.deepEqual([moved.id, moved.date, moved.period], [a.id, thu, 'morning']);
  assert.equal(await cell(tue, 'evening').getByText('跑基线').count(), 0);
  // 4. 拖到日期格 = 未定时段
  await p.getByTestId('plan-chip-' + a.id).dragTo(cell(thu, null));
  await p.getByTestId('board-loose-' + thu).getByText('跑基线').waitFor();
  assert.equal((await tasks()).find((t) => t.id === a.id).period, null);
  // 5. 菜单换时段（手机上用）
  await p.getByTestId('plan-chip-' + a.id).getByRole('button', { name: '操作：跑基线' }).click();
  await p.locator('.n-dropdown-option').filter({ hasText: '移到下午' }).click();
  await cell(thu, 'afternoon').getByText('跑基线').waitFor();
  assert.equal((await tasks()).find((t) => t.id === a.id).period, 'afternoon');
  report.push('drag pool → cell; chip → another day/period (same record); → date cell = unassigned; menu period change');

  // 6. 「安排」弹窗：选日期和时段
  await p.getByTestId('goal-task-' + gB.id).getByRole('button', { name: '安排', exact: true }).click();
  const pop = p.getByTestId('goal-task-schedule'); await pop.waitFor();
  await pop.locator('input[type=date]').fill(wed);
  await p.getByTestId('schedule-period-evening').click();
  await p.locator('.n-modal').getByRole('button', { name: '加入日计划', exact: true }).click();
  await cell(wed, 'evening').getByText('消融实验').waitFor();
  assert.equal((await tasks()).find((t) => t.goal_task_id === gB.id).period, 'evening');
  // 完成后进「已完成」折叠
  await p.getByTestId('plan-chip-' + (await tasks()).find((t) => t.goal_task_id === gB.id).id).locator('.n-checkbox').click();
  await p.getByTestId('pool-goal-' + goal.id).getByText('已完成 1 项').waitFor();
  report.push('schedule dialog sets date + period; done subtasks fold into 已完成');
  await p.screenshot({ path: out + '/board-1440.png' });

  // 7. 任务池固定：页面往下滚，任务池仍在视口里
  await p.setViewportSize({ width: 1440, height: 560 });
  await p.evaluate(() => window.scrollTo(0, 400)); await p.waitForTimeout(200);
  const poolTop = await p.getByTestId('task-pool').evaluate((e) => e.getBoundingClientRect().top);
  assert.ok(poolTop >= 0 && poolTop <= 20, 'pool stays on screen while the board scrolls: top=' + poolTop);
  for (const w of [1280, 1024, 390]) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(150); assert.ok(await overflow() <= 1, 'week overflow at ' + w); }
  await p.screenshot({ path: out + '/board-390.png', fullPage: true });
  report.push('pool is sticky; no horizontal overflow at 1280 / 1024 / 390');

  // 8. 今日页：三段 + 未定；默认收起小时轴；添加时选时段
  await p.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/tasks', { title: '没有时段的旧任务', date: mon });
  await p.goto(origin + '/?date=' + mon); await p.getByTestId('period-morning').waitFor();
  for (const k of ['none', 'morning', 'afternoon', 'evening']) assert.equal(await p.getByTestId('period-' + k).count(), 1, k);
  assert.equal(await p.locator('.period-block.now').count(), 0, 'not today: no current period');
  await p.getByTestId('period-morning').getByText('机器学习课程').waitFor();
  await p.getByTestId('period-afternoon').getByText('周组会').waitFor();
  assert.equal(await p.getByTestId('timeline-fold').evaluate((e) => e.open), false, 'hour axis folded by default');
  assert.equal(await p.locator('.timeline-scroll').count(), 0);
  await p.getByTestId('new-day-task-title').locator('input').fill('写实验记录');
  await p.getByTestId('new-task-period-evening').click();
  await p.getByTestId('add-day-task').click();
  await p.getByTestId('period-evening').getByText('写实验记录').waitFor();
  // 9. 在三段之间拖（拖把手）
  const rec = (await api('GET', '/day/' + mon)).tasks.find((t) => t.title === '写实验记录');
  await p.getByTestId('day-task-' + rec.id).locator('.task-time-handle').dragTo(p.getByTestId('period-morning'));
  await p.getByTestId('period-morning').getByText('写实验记录').waitFor();
  assert.equal((await api('GET', '/day/' + mon)).tasks.find((t) => t.id === rec.id).period, 'morning');
  // 10. 本周计划的子任务拖进「中」
  await p.getByTestId('week-glance-task-' + gC.id).dragTo(p.getByTestId('period-afternoon'));
  await p.getByTestId('period-afternoon').getByText('整理图表').waitFor();
  assert.equal((await api('GET', '/day/' + mon)).tasks.find((t) => t.goal_task_id === gC.id).period, 'afternoon');
  // 11. 「安排到具体几点」自动展开小时轴，排好后时段跟着变
  await p.getByTestId('day-task-' + rec.id).getByRole('button', { name: '任务操作' }).click();
  await p.locator('.n-dropdown-option').filter({ hasText: '安排到具体几点' }).click();
  await p.locator('.timeline-scroll').waitFor();
  assert.equal(await p.getByTestId('timeline-fold').evaluate((e) => e.open), true);
  report.push('Today: 未定/早/中/晚 sections with events; add with period; drag between sections; drag weekly subtask into 中; hour axis folded, opens for 安排到具体几点');
  await p.keyboard.press('Escape');
  await p.screenshot({ path: out + '/today-1440.png' });
  // 展开状态记住
  await p.reload(); await p.getByTestId('period-morning').waitFor();
  assert.equal(await p.getByTestId('timeline-fold').evaluate((e) => e.open), true, 'fold state remembered');
  await p.getByTestId('timeline-fold').locator('summary').click();

  // 12. 手机：菜单换时段；无横向溢出
  await p.setViewportSize({ width: 390, height: 844 }); await p.reload(); await p.getByTestId('period-morning').waitFor();
  await p.getByTestId('day-task-' + rec.id).getByRole('button', { name: '任务操作' }).click();
  await p.locator('.n-dropdown-option').filter({ hasText: '移到晚上' }).click();
  await p.getByTestId('period-evening').getByText('写实验记录').waitFor();
  assert.ok(await overflow() <= 1, 'today overflow at 390');
  await p.screenshot({ path: out + '/today-390.png', fullPage: true });
  // 13. 真正的今天：只有一个「现在」时段
  await p.setViewportSize({ width: 1440, height: 900 }); await p.goto(origin + '/'); await p.getByTestId('period-morning').waitFor();
  assert.equal(await p.locator('.period-block.now').count(), 1);
  report.push('phone menu moves between periods; no overflow; today highlights exactly one current period');
  assert.deepEqual(errors, []);
  await c.close();
} finally { await browser.close(); writeFileSync(out + '/report.json', JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ passed: report.length, checks: report }));
