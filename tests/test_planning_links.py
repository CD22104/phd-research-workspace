"""Multi-paper task selections survive merge/delete without stale links. Local API only."""
import json
import sys
import unittest
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

BASE = sys.argv.pop(1) if len(sys.argv) > 1 and sys.argv[1].startswith('http') else 'http://127.0.0.1:18931'
if urlparse(BASE).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('This test only accepts a local server.')

def call(method, path, payload=None):
    req = urllib.request.Request(BASE + '/api' + path, method=method,
        headers={'Content-Type': 'application/json', 'X-Requested-With': 'link-test', 'X-Actor': 'web'},
        data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError((method, path, error.code, error.read().decode()))

class PlanningLinks(unittest.TestCase):
    def setUp(self):
        self.key = uuid.uuid4().hex
        self.today = call('GET', '/bootstrap')['today']
        self.ids = [call('POST', '/papers', {'title': f'{uuid.uuid4().hex} link paper {n}', 'enrich': False})['created'][0] for n in range(3)]
        self.goal = call('POST', '/goals', {'title': f'Goal {self.key}', 'week_id': self.today})
        self.sub = call('POST', '/goal-tasks', {'title': 'Compare two papers', 'goal_id': self.goal['id'], 'paper_ids': self.ids[:2]})
        self.task = call('POST', f"/goal-tasks/{self.sub['id']}/schedule", {'date': self.today})
        self.task = self.task.get('task', self.task)

    def rows(self):
        tables = call('GET', '/export')['tables']
        sub = next(x for x in tables['goal_tasks'] if x['id'] == self.sub['id'])
        task = next(x for x in tables['tasks'] if x['id'] == self.task['id'])
        return sub, task

    def test_merge_into_selected_paper_collapses_duplicates(self):
        call('POST', f'/papers/{self.ids[0]}/merge-into/{self.ids[1]}', {})
        for row in self.rows():
            self.assertEqual(json.loads(row['paper_ids']), [self.ids[1]])
            self.assertEqual(row['paper_id'], self.ids[1])
        task = call('GET', f"/tasks/{self.task['id']}")
        self.assertEqual([p['id'] for p in task['papers']], [self.ids[1]])

    def test_merge_into_new_target_keeps_both_selections(self):
        call('POST', f'/papers/{self.ids[0]}/merge-into/{self.ids[2]}', {})
        for row in self.rows():
            self.assertEqual(set(json.loads(row['paper_ids'])), {self.ids[1], self.ids[2]})
            self.assertIsNone(row['paper_id'])

    def test_delete_selected_paper_clears_its_plan_from_multi_paper_task(self):
        plan = call('POST', '/plans', {'paper_id': self.ids[0], 'purpose': 'Plan attached to a multi-paper task'})
        call('PATCH', f"/tasks/{self.task['id']}", {'plan_id': plan['id']})
        call('PATCH', f"/goal-tasks/{self.sub['id']}", {'plan_id': plan['id']})
        call('DELETE', f'/papers/{self.ids[0]}')
        for row in self.rows():
            self.assertIsNone(row['plan_id'])
            self.assertEqual(json.loads(row['paper_ids']), [self.ids[1]])
        call('PATCH', f"/tasks/{self.task['id']}", {'paper_ids': [self.ids[1]]})

    def test_delete_selected_papers_cleans_arrays_and_primary(self):
        call('DELETE', f'/papers/{self.ids[0]}')
        for row in self.rows():
            self.assertEqual(json.loads(row['paper_ids']), [self.ids[1]])
            self.assertEqual(row['paper_id'], self.ids[1])
        call('DELETE', f'/papers/{self.ids[1]}')
        for row in self.rows():
            self.assertEqual(json.loads(row['paper_ids']), [])
            self.assertIsNone(row['paper_id'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
