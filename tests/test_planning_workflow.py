"""周目标子任务/每日安排验收。只允许连接临时本地服务，不触碰线上。

scripts/dev-test-server.sh /tmp/honey-planning-test 18921
python3 tests/test_planning_workflow.py http://127.0.0.1:18921 /tmp/honey-planning-test
"""
import concurrent.futures
import json
from pathlib import Path
import sqlite3
import sys
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, timedelta

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:18921'
DB_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else None
if urllib.parse.urlparse(BASE).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('验收只允许连接本机临时服务')


def call(method, path, body=None, expected=200, actor='web', csrf=True):
    headers = {'Content-Type': 'application/json', 'X-Actor': actor}
    if csrf:
        headers['X-Requested-With'] = 'planning-test'
    req = urllib.request.Request(BASE + '/api' + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status, out = res.status, json.load(res)
    except urllib.error.HTTPError as err:
        status, out = err.code, json.load(err)
    if expected is not None:
        assert status == expected, (method, path, status, out)
    return out if expected is not None else (status, out)


class PlanningWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.today = date.fromisoformat(call('GET', '/bootstrap')['today'])
        cls.yesterday = str(cls.today - timedelta(days=1))
        cls.tomorrow = str(cls.today + timedelta(days=1))
        cls.monday = cls.today - timedelta(days=cls.today.weekday())
        cls.paper_ids = []
        for prefix in ('Counting jellyfish', 'Studying granite'):
            out = call('POST', '/papers', {'title': prefix + ' ' + uuid.uuid4().hex,
                'url': 'https://example.org/' + uuid.uuid4().hex, 'enrich': False}, 201)
            cls.paper_ids.append((out.get('created', []) + out.get('candidates', []))[0])

    def goal(self, week=None):
        return call('POST', '/goals', {'title': 'Workflow ' + uuid.uuid4().hex, 'week_id': str(week or self.today)}, 201)

    def child(self, goal, **extra):
        return call('POST', '/goal-tasks', {'goal_id': goal['id'], 'title': 'Read and compare', **extra}, 201)

    def schedule(self, child, when):
        return call('POST', f"/goal-tasks/{child['id']}/schedule", {'date': str(when)}, 201)

    def test_01_repeat_schedule_completion_and_history(self):
        g = self.goal()
        a = self.child(g, paper_ids=self.paper_ids, points=2)
        self.child(g, title='Write conclusions')
        yesterday = self.schedule(a, self.yesterday)
        today = self.schedule(a, self.today)
        future = self.schedule(a, self.tomorrow)
        before = call('GET', f'/day/{self.yesterday}')['summary']
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            rows = list(pool.map(lambda _: self.schedule(a, self.today), range(6)))
        self.assertEqual({r['id'] for r in rows}, {today['id']})
        timer = call('POST', '/timer/start', {'task_id': today['id']})
        self.assertIsNone(timer['running']['paper_id'])
        self.assertIsNone(timer['running']['plan_id'])
        call('PATCH', f"/tasks/{today['id']}", {'status': 'done'})
        self.assertIsNone(call('GET', '/timer')['running'])
        old = call('GET', f"/tasks/{yesterday['id']}")
        self.assertEqual((old['status'], old['goal_task_status']), ('todo', 'done'))
        self.assertEqual(before, call('GET', f'/day/{self.yesterday}')['summary'])
        cancelled = call('GET', f"/tasks/{future['id']}")
        self.assertEqual((cancelled['status'], cancelled['completion_cancelled']), ('dropped', 1))
        week = call('GET', f'/week/{self.today}')
        goal = next(x for x in week['goals'] if x['id'] == g['id'])
        self.assertEqual((goal['progress'], goal['task_done'], goal['task_total']), (50, 1, 2))
        self.assertEqual(next(x for x in week['goal_tasks'] if x['id'] == a['id'])['completed_task_id'], today['id'])
        call('POST', '/timer/start', {'task_id': yesterday['id']}, 409)
        call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': str(self.today + timedelta(days=2))}, 409)
        call('PATCH', f"/tasks/{yesterday['id']}", {'status': 'done'}, 409)
        call('PATCH', f"/tasks/{today['id']}", {'status': 'todo'})
        self.assertEqual(call('GET', f"/tasks/{future['id']}")['status'], 'todo')
        self.assertEqual(call('GET', f"/tasks/{today['id']}")['goal_task_status'], 'todo')
        call('PATCH', f"/goal-tasks/{a['id']}", {'status': 'done'})
        self.assertEqual(call('GET', f"/tasks/{today['id']}")['status'], 'done')
        call('PATCH', f"/goal-tasks/{a['id']}", {'status': 'todo'})
        self.assertEqual(call('GET', f"/tasks/{today['id']}")['status'], 'todo')

    def test_02_multi_papers_and_snapshot(self):
        g = self.goal()
        a = self.child(g, paper_ids=[self.paper_ids[0], self.paper_ids[1], self.paper_ids[0]])
        self.assertEqual(a['paper_ids'], self.paper_ids)
        self.assertIsNone(a['paper_id'])
        self.assertEqual({x['id'] for x in a['papers']}, set(self.paper_ids))
        task = self.schedule(a, self.today)
        call('PATCH', f"/tasks/{task['id']}", {'paper_ids': [self.paper_ids[0]]})
        saved = call('GET', f"/tasks/{task['id']}")
        self.assertEqual(saved['paper_id'], self.paper_ids[0])
        self.assertEqual(saved['paper_ids'], [self.paper_ids[0]])
        future = self.schedule(a, self.tomorrow)
        self.assertEqual(future['paper_ids'], self.paper_ids)
        call('PATCH', f"/tasks/{task['id']}", {'paper_ids': [999999999]}, 400)
        call('PATCH', f"/tasks/{task['id']}", {'date': self.tomorrow}, 400)
        legacy = call('POST', '/tasks', {'title': 'Legacy single paper', 'date': str(self.today), 'paper_id': self.paper_ids[0]}, 201)
        self.assertEqual(legacy['paper_ids'], [self.paper_ids[0]])
        timer = call('POST', '/timer/start', {'task_id': legacy['id']})
        self.assertEqual(timer['running']['paper_id'], self.paper_ids[0])
        call('POST', '/timer/stop', {})
        plan = call('POST', '/plans', {'paper_id': self.paper_ids[0], 'purpose': 'Compare two papers'}, 201)
        planned_child = self.child(g, paper_ids=self.paper_ids, plan_id=plan['id'])
        self.assertEqual(planned_child['plan_paper_id'], self.paper_ids[0])
        planned_task = self.schedule(planned_child, self.today)
        self.assertEqual(planned_task['plan_paper_id'], self.paper_ids[0])
        call('PATCH', f"/tasks/{planned_task['id']}", {'paper_ids': [self.paper_ids[1]], 'plan_id': None})
        self.assertIsNone(call('GET', f"/tasks/{planned_task['id']}")['plan_paper_id'])

    def test_03_unique_completion_under_race(self):
        a = self.child(self.goal())
        tasks = [self.schedule(a, self.yesterday), self.schedule(a, self.today)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            out = list(pool.map(lambda t: call('PATCH', f"/tasks/{t['id']}", {'status': 'done'}, expected=None), tasks))
        self.assertEqual(sorted(x[0] for x in out), [200, 409])
        states = [call('GET', f"/tasks/{t['id']}")['status'] for t in tasks]
        self.assertEqual(states.count('done'), 1)

    def test_04_carry_is_idempotent_and_keeps_last_week(self):
        previous = self.monday - timedelta(days=7)
        g = self.goal(previous)
        done = self.child(g, title='Already finished')
        pending = self.child(g, paper_ids=self.paper_ids)
        call('PATCH', f"/goal-tasks/{done['id']}", {'status': 'done'})
        for _ in range(2):
            call('POST', '/goals/carry', {'from_week': str(previous), 'to_week': str(self.monday)})
        week = call('GET', f'/week/{self.today}')
        copies = [x for x in week['goals'] if x['carried_from'] == g['id']]
        self.assertEqual(len(copies), 1)
        children = [x for x in week['goal_tasks'] if x['goal_id'] == copies[0]['id']]
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0]['carried_from'], pending['id'])
        self.assertEqual(children[0]['paper_ids'], self.paper_ids)
        call('PATCH', f"/goal-tasks/{children[0]['id']}", {'status': 'done'})
        oldweek = call('GET', f'/week/{previous}')
        self.assertEqual(next(x for x in oldweek['goals'] if x['id'] == g['id'])['progress'], 50)
        self.assertEqual(next(x for x in oldweek['goal_tasks'] if x['id'] == pending['id'])['status'], 'todo')

    def test_05_delete_keeps_daily_history_and_auth(self):
        g = self.goal()
        a = self.child(g)
        task = self.schedule(a, self.today)
        call('PATCH', f"/tasks/{task['id']}", {'status': 'done'})
        call('DELETE', f"/goal-tasks/{a['id']}", expected=409, actor='mcp')
        call('DELETE', f"/goal-tasks/{a['id']}?confirm=1", actor='mcp')
        saved = call('GET', f"/tasks/{task['id']}")
        self.assertEqual(saved['status'], 'done')
        self.assertIsNone(saved['goal_task_id'])
        call('POST', '/goal-tasks', {'goal_id': g['id'], 'title': 'No CSRF'}, 403, csrf=False)
        legacy = self.goal()
        patched = call('PATCH', f"/goals/{legacy['id']}", {'progress': 42})
        self.assertEqual(patched['progress'], 42)
        child = self.child(legacy)
        patched = call('PATCH', f"/goals/{legacy['id']}", {'progress': 100, 'status': 'done'})
        self.assertEqual((patched['progress'], patched['status']), (0, 'open'))
        call('PATCH', f"/goal-tasks/{child['id']}", {'status': 'done'})

    def test_06_workday_effective_dates(self):
        self.assertEqual(call('GET', '/day/2026-09-19')['summary']['kind'], 'rest')
        self.assertEqual(call('GET', '/day/2026-09-26')['summary']['kind'], 'work')
        before = call('GET', f'/day/{self.yesterday}')['summary']
        try:
            settings = call('PUT', '/settings', {'workdays': []})
            self.assertEqual(settings['workday_versions'][-1]['effective_from'], str(self.today))
            self.assertEqual(call('GET', f'/day/{self.today}')['summary']['kind'], 'rest')
            self.assertEqual(before, call('GET', f'/day/{self.yesterday}')['summary'])
        finally:
            call('PUT', '/settings', {'workdays': [1, 2, 3, 4, 5, 6, 7]})

    def test_07_explicit_planned_and_paper_cleanup(self):
        g = self.goal()
        a = self.child(g, paper_ids=self.paper_ids)
        call('POST', f'/day/{self.today}/checkin', {'plan_note': 'test'})
        task = self.schedule(a, self.today)
        self.assertEqual(task['planned'], 0)
        planned = call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': str(self.today), 'planned': True}, 201)
        self.assertEqual((planned['id'], planned['planned']), (task['id'], 1))
        # Separate disposable references: deleting one of two preserves the other as primary.
        out = call('POST', '/papers', {'title': 'Disposable saffron ' + uuid.uuid4().hex, 'url': 'https://example.org/' + uuid.uuid4().hex, 'enrich': False}, 201)
        disposable = (out.get('created', []) + out.get('candidates', []))[0]
        child = self.child(g, paper_ids=[disposable, self.paper_ids[0]])
        scheduled = self.schedule(child, self.today)
        call('DELETE', f'/papers/{disposable}')
        task = call('GET', f"/tasks/{scheduled['id']}")
        self.assertEqual((task['paper_ids'], task['paper_id']), ([self.paper_ids[0]], self.paper_ids[0]))
        week = call('GET', f'/week/{self.today}')
        row = next(x for x in week['goal_tasks'] if x['id'] == child['id'])
        self.assertEqual((row['paper_ids'], row['paper_id']), ([self.paper_ids[0]], self.paper_ids[0]))

    def test_08_more_than_100_papers_in_week(self):
        key = uuid.uuid4().hex
        imported = call('POST', '/import/commit', {
            'import_key': key,
            'source': {'kind': 'manual', 'name': 'Temporary local wide-week test'},
            'items': [{'action': 'create', 'draft': {'title': f'Wide week fixture {key} {i}', 'url': f'https://example.org/{key}/{i}'}} for i in range(105)],
        })
        ids = imported['created']
        self.assertEqual(len(ids), 105)
        task_ids = []
        for offset in range(0, 105, 40):
            task = call('POST', '/tasks', {'title': f'Compare group {offset}', 'date': str(self.today), 'paper_ids': ids[offset:offset + 40]}, 201)
            task_ids.append(task['id'])
        week = call('GET', f'/week/{self.today}')
        linked = {p['id'] for t in week['tasks'] if t['id'] in task_ids for p in t['papers']}
        self.assertEqual(linked, set(ids))

    def test_09_reschedule_keeps_history_and_restores_cancelled(self):
        g = self.goal()
        a = self.child(g)
        yesterday = call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': self.yesterday, 'planned': False}, 201)
        today = self.schedule(a, self.today)
        call('PATCH', f"/tasks/{today['id']}", {'status': 'dropped'})
        restored = call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': str(self.today), 'planned': True}, 201)
        self.assertEqual((restored['id'], restored['status'], restored['completion_cancelled']), (today['id'], 'todo', 0))
        self.assertEqual(restored['planned'], 1)
        call('PATCH', f"/tasks/{today['id']}", {'status': 'moved'})
        restored = self.schedule(a, self.today)
        self.assertEqual((restored['id'], restored['status']), (today['id'], 'todo'))
        # Even before completion, repeat scheduling must not change an old day's planned flag.
        prior = call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': self.yesterday, 'planned': True}, 201)
        self.assertEqual(prior['planned'], 0)
        call('PATCH', f"/tasks/{today['id']}", {'status': 'done'})
        before_task = call('GET', f"/tasks/{yesterday['id']}")
        before_score = call('GET', f'/day/{self.yesterday}')['summary']
        repeated = call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': self.yesterday, 'planned': True}, 201)
        self.assertEqual(repeated['id'], yesterday['id'])
        self.assertEqual(call('GET', f"/tasks/{yesterday['id']}"), before_task)
        self.assertEqual(call('GET', f'/day/{self.yesterday}')['summary'], before_score)
        call('POST', f"/goal-tasks/{a['id']}/schedule", {'date': self.tomorrow}, 409)
        # Schedule recovery racing completion cannot reopen a completed main item.
        call('PATCH', f"/goal-tasks/{a['id']}", {'status': 'todo'})
        call('PATCH', f"/tasks/{today['id']}", {'status': 'dropped'})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            restore = pool.submit(self.schedule, a, self.today)
            done = pool.submit(call, 'PATCH', f"/goal-tasks/{a['id']}", {'status': 'done'})
            restore.result()
            done.result()
        after = call('GET', f"/tasks/{today['id']}")
        self.assertEqual(after['goal_task_status'], 'done')
        self.assertIn(after['status'], ('done', 'dropped'))

    def test_10_export_and_restore(self):
        exported = call('GET', '/export')
        self.assertIn('goal_tasks', exported['tables'])
        self.assertIn('schedule_events', exported['tables'])
        self.assertTrue(any(x.get('goal_task_id') for x in exported['tables']['tasks']))
        if DB_DIR is None:
            self.skipTest('未提供临时数据库目录，跳过 SQL 恢复部分')
        paths = [p for p in DB_DIR.rglob('*.sqlite') if 'D1DatabaseObject' in str(p) and p.name != 'metadata.sqlite']
        self.assertEqual(len(paths), 1)
        restored = sqlite3.connect(':memory:')
        restored.execute('PRAGMA foreign_keys=ON')
        # D1 keeps foreign keys enabled: table creation and data insertion order must both work.
        with tempfile.TemporaryDirectory(prefix='honey-workflow-restore-') as temp_dir:
            dump = Path(temp_dir) / 'snapshot.sql'
            subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/sqlite_dump.py'), str(DB_DIR), str(dump)],
                           check=True, capture_output=True, text=True)
            restored.executescript(dump.read_text())
        self.assertEqual(list(restored.execute('PRAGMA foreign_key_check')), [])
        restored.row_factory = sqlite3.Row
        for table, rows in exported['tables'].items():
            got = [dict(x) for x in restored.execute('SELECT * FROM ' + table)]
            sort = lambda rs: sorted(json.dumps(x, sort_keys=True) for x in rs)
            self.assertEqual(sort(got), sort(rows), table)
        restored.execute('PRAGMA foreign_keys=ON')
        task = next(x for x in exported['tables']['tasks'] if x['goal_task_id'])
        with self.assertRaises(sqlite3.IntegrityError):
            restored.execute('INSERT INTO tasks(date,title,goal_id,goal_task_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                (task['date'], 'duplicate', task['goal_id'], task['goal_task_id'], task['created_at'], task['updated_at']))
        restored.close()


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]], verbosity=2)
