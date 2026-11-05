"""Reading history stays consistent across the library, daily tasks and weekly tasks. Local only."""
import json
import sys
import unittest
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

BASE = sys.argv.pop(1) if len(sys.argv) > 1 and sys.argv[1].startswith('http') else 'http://127.0.0.1:18972'
if urlparse(BASE).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('Use an isolated local server for these write tests.')


def call(method, path, payload=None):
    req = urllib.request.Request(BASE + '/api' + path, method=method,
        headers={'Content-Type': 'application/json', 'X-Requested-With': 'reading-test', 'X-Actor': 'web'},
        data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError((method, path, error.code, error.read().decode()))


class TaskReading(unittest.TestCase):
    def setUp(self):
        self.today = call('GET', '/bootstrap')['today']
        self.ids = [call('POST', '/papers', {'title': f'{uuid.uuid4().hex} Reading case {n}', 'enrich': False})['created'][0] for n in range(3)]
        self.goal = call('POST', '/goals', {'title': 'Reading visibility ' + uuid.uuid4().hex, 'week_id': self.today})
        self.sub = call('POST', '/goal-tasks', {'title': 'Compare readings', 'goal_id': self.goal['id'], 'paper_ids': self.ids})
        self.task = call('POST', f"/goal-tasks/{self.sub['id']}/schedule", {'date': self.today})

    def plan(self, paper, state='planned'):
        p = call('POST', '/plans', {'paper_id': paper, 'depth': '精读', 'purpose': 'Read state test'})
        if state != 'planned':
            call('PATCH', f"/plans/{p['id']}", {'status': state})
        return p

    def check_all_views(self, expected):
        library = {p['id']: p['reading'] for p in call('GET', '/papers')['papers'] if p['id'] in self.ids}
        for paper_id, state, done in expected:
            self.assertEqual((library[paper_id]['state'], library[paper_id]['done']), (state, done))
        day = call('GET', f'/day/{self.today}')
        week = call('GET', f'/week/{self.today}')
        rows = [call('GET', f"/tasks/{self.task['id']}")]
        for data in [day, week]:
            rows.append(next(t for t in data['tasks'] if t['id'] == self.task['id']))
            rows.append(next(t for t in data['goal_tasks'] if t['id'] == self.sub['id']))
        for row in rows:
            self.assertEqual({p['id']: p['reading'] for p in row['papers']}, library)

    def test_mixed_read_unread_and_notes(self):
        self.plan(self.ids[0], 'done')
        self.plan(self.ids[1], 'planned')
        call('POST', '/logs', {'paper_id': self.ids[2], 'content': 'Partial notes do not complete a plan'})
        self.check_all_views([(self.ids[0], 'done', 1), (self.ids[1], 'planned', 0), (self.ids[2], 'none', 0)])
        # Completing a multi-paper task must not silently mark all its papers read.
        call('PATCH', f"/tasks/{self.task['id']}", {'status': 'done'})
        self.check_all_views([(self.ids[0], 'done', 1), (self.ids[1], 'planned', 0), (self.ids[2], 'none', 0)])

    def test_reread_preserves_previous_completion(self):
        self.plan(self.ids[0], 'done')
        next_round = self.plan(self.ids[0])
        self.check_all_views([(self.ids[0], 'done_more', 1)])
        call('PATCH', f"/plans/{next_round['id']}", {'status': 'reading'})
        self.check_all_views([(self.ids[0], 'reading', 1)])
        call('PATCH', f"/plans/{next_round['id']}", {'status': 'done'})
        self.check_all_views([(self.ids[0], 'done', 2)])

    def test_completion_reversal_and_plan_removal_refresh_all_views(self):
        p = self.plan(self.ids[0], 'done')
        self.check_all_views([(self.ids[0], 'done', 1)])
        call('PATCH', f"/plans/{p['id']}", {'status': 'planned'})
        self.check_all_views([(self.ids[0], 'planned', 0)])
        call('DELETE', f"/plans/{p['id']}")
        self.check_all_views([(self.ids[0], 'none', 0)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
