"""日任务时段（早 / 中 / 晚）与换天 / 换时段。只对新建的本机临时库运行。

用法：scripts/dev-test-server.sh <临时目录> 18995 & ; python3 tests/test_task_periods.py http://127.0.0.1:18995
"""
import json, sys, unittest, urllib.error, urllib.parse, urllib.request, uuid
BASE = sys.argv.pop(1) if len(sys.argv) > 1 else 'http://127.0.0.1:18995'
assert urllib.parse.urlparse(BASE).hostname in ('localhost', '127.0.0.1'), 'Local isolated database only'


def call(method, path, data=None, status=200, actor='web'):
    headers = {'Content-Type': 'application/json', 'X-Actor': actor, 'X-Requested-With': 'period-test'}
    req = urllib.request.Request(BASE + '/api' + path, method=method, headers=headers, data=json.dumps(data).encode() if data is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: code, out = r.status, json.load(r)
    except urllib.error.HTTPError as e: code, out = e.code, json.load(e)
    if status is None: return code, out
    assert code == status, (method, path, code, out)
    return out


class TaskPeriods(unittest.TestCase):
    def setUp(self):
        self.stamp = uuid.uuid4().hex[:8]
        self.d1, self.d2, self.d3 = '2026-11-16', '2026-11-17', '2026-11-18'
        cur = call('GET', '/timer')['running']
        if cur: call('POST', '/timer/stop', {'session_id': cur['id']})

    def task(self, **kw):
        return call('POST', '/tasks', {'title': 'Period ' + self.stamp, 'date': self.d1, **kw}, 201)

    def get(self, tid):
        return call('GET', f'/tasks/{tid}')

    def test_create_patch_and_validate(self):
        self.assertIsNone(self.task()['period'])
        self.assertEqual(self.task(period='afternoon')['period'], 'afternoon')
        self.assertEqual(self.task(period='晚')['period'], 'evening', 'Chinese alias')
        call('POST', '/tasks', {'title': 'bad', 'date': self.d1, 'period': 'noon'}, 400)
        t = self.task(period='morning')
        self.assertEqual(call('PATCH', f"/tasks/{t['id']}", {'period': 'evening'})['period'], 'evening')
        self.assertIsNone(call('PATCH', f"/tasks/{t['id']}", {'period': None})['period'])
        call('PATCH', f"/tasks/{t['id']}", {'period': 'lunch'}, 400)
        day = call('GET', '/day/' + self.d1)
        self.assertIn('period', next(x for x in day['tasks'] if x['id'] == t['id']))
        exp = call('GET', '/export')
        self.assertGreaterEqual(exp['schema_version'], 16)
        self.assertIn('period', next(x for x in exp['tables']['tasks'] if x['id'] == t['id']))

    def test_move_same_day_changes_only_period(self):
        t = self.task(period='morning')
        moved = call('POST', f"/tasks/{t['id']}/move", {'period': 'afternoon'})
        self.assertEqual((moved['id'], moved['date'], moved['period']), (t['id'], self.d1, 'afternoon'))
        self.assertIsNone(call('POST', f"/tasks/{t['id']}/move", {'date': self.d1, 'period': None})['period'])

    def test_move_plain_task_to_other_day_in_place(self):
        t = self.task(period='morning')
        call('POST', '/time-blocks', {'task_id': t['id'], 'date': self.d1, 'start_minute': 540, 'end_minute': 600, 'client_key': uuid.uuid4().hex}, 201)
        moved = call('POST', f"/tasks/{t['id']}/move", {'date': self.d2, 'period': 'evening'})
        self.assertEqual((moved['id'], moved['date'], moved['period'], moved['status']), (t['id'], self.d2, 'evening', 'todo'))
        self.assertFalse(any(b['task_id'] == t['id'] for b in call('GET', f'/day/{self.d2}/time-blocks')['blocks']), 'hour slot belonged to the old day')
        self.assertFalse(any(x['id'] == t['id'] for x in call('GET', '/day/' + self.d1)['tasks']))

    def test_move_timed_task_keeps_history(self):
        t = self.task(period='morning')
        s = call('POST', '/timer/start', {'task_id': t['id']})['running']
        call('POST', f"/tasks/{t['id']}/move", {'date': self.d2}, 409)  # running timer
        call('POST', '/timer/stop', {'session_id': s['id']})
        moved = call('POST', f"/tasks/{t['id']}/move", {'date': self.d2, 'period': 'afternoon'})
        self.assertNotEqual(moved['id'], t['id'])
        self.assertEqual((moved['date'], moved['period'], moved['carried_from']), (self.d2, 'afternoon', t['id']))
        self.assertEqual(self.get(t['id'])['status'], 'moved')
        call('POST', f"/tasks/{t['id']}/move", {'date': self.d3}, 409)  # 已顺延的记录不能再搬

    def test_goal_task_schedule_move_and_carry(self):
        g = call('POST', '/goals', {'title': 'Goal ' + self.stamp, 'week_id': self.d1}, 201)
        gt = call('POST', '/goal-tasks', {'goal_id': g['id'], 'title': 'Sub ' + self.stamp}, 201)
        a = call('POST', f"/goal-tasks/{gt['id']}/schedule", {'date': self.d1, 'period': 'morning', 'planned': True}, 201)
        self.assertEqual(a['period'], 'morning')
        again = call('POST', f"/goal-tasks/{gt['id']}/schedule", {'date': self.d1, 'period': 'evening'}, 201)
        self.assertEqual((again['id'], again['period']), (a['id'], 'evening'), 'dragging into another period of the same day moves it')
        week = call('GET', '/week/' + self.d1)
        row = next(x for x in week['goal_tasks'] if x['id'] == gt['id'])
        self.assertEqual(row['scheduled'], [{'date': self.d1, 'period': 'evening'}])
        # 换到另一天：没有计时就原地搬过去
        b = call('PATCH', f"/tasks/{a['id']}", {'date': self.d2}, 400)  # PATCH 仍然不允许改周子任务日期
        moved = call('POST', f"/tasks/{a['id']}/move", {'date': self.d2, 'period': 'afternoon'})
        self.assertEqual((moved['id'], moved['date'], moved['period']), (a['id'], self.d2, 'afternoon'))
        # 目标日期已有同一子任务的安排 → 冲突
        other = call('POST', f"/goal-tasks/{gt['id']}/schedule", {'date': self.d3, 'period': 'morning'}, 201)
        call('POST', f"/tasks/{other['id']}/move", {'date': self.d2}, 409)
        # 目标日期有已取消的旧记录 → 恢复那条，原安排删除
        call('PATCH', f"/tasks/{moved['id']}", {'status': 'dropped'})
        back = call('POST', f"/tasks/{other['id']}/move", {'date': self.d2, 'period': 'evening'})
        self.assertEqual((back['id'], back['status'], back['period']), (moved['id'], 'todo', 'evening'))
        self.assertEqual(call('GET', f"/tasks/{other['id']}", status=None)[0], 404)
        # 顺延保留时段
        carried = call('POST', '/tasks/carry', {'ids': [back['id']], 'to': self.d3})['created'][0]
        self.assertEqual(self.get(carried)['period'], 'evening')
        plain = self.task(period='afternoon')
        carried_plain = call('POST', '/tasks/carry', {'ids': [plain['id']], 'to': self.d2})['created'][0]
        self.assertEqual(self.get(carried_plain)['period'], 'afternoon')

    def test_done_task_cannot_change_day_but_can_change_period(self):
        t = self.task(period='morning')
        call('PATCH', f"/tasks/{t['id']}", {'status': 'done'})
        call('POST', f"/tasks/{t['id']}/move", {'date': self.d2}, 409)
        self.assertEqual(call('POST', f"/tasks/{t['id']}/move", {'period': 'evening'})['period'], 'evening')

    def test_hour_slot_sets_period(self):
        t = self.task(period='morning')
        blk = call('POST', '/time-blocks', {'task_id': t['id'], 'date': self.d1, 'start_minute': 20 * 60, 'end_minute': 21 * 60, 'client_key': uuid.uuid4().hex}, 201)
        self.assertEqual(self.get(t['id'])['period'], 'evening')
        call('PATCH', f"/time-blocks/{blk['id']}", {'date': self.d1, 'start_minute': 13 * 60, 'end_minute': 14 * 60, 'base_version': blk['version']})
        self.assertEqual(self.get(t['id'])['period'], 'afternoon')

    def test_script_actor_confirms_only_when_hour_slots_are_lost(self):
        t = self.task(period='morning')
        self.assertEqual(call('POST', f"/tasks/{t['id']}/move", {'period': 'afternoon'}, actor='mcp')['period'], 'afternoon')
        self.assertEqual(call('POST', f"/tasks/{t['id']}/move", {'date': self.d2}, actor='mcp')['date'], self.d2, 'no hour slots: no confirmation needed')
        call('POST', '/time-blocks', {'task_id': t['id'], 'date': self.d2, 'start_minute': 600, 'end_minute': 660, 'client_key': uuid.uuid4().hex}, 201)
        code, out = call('POST', f"/tasks/{t['id']}/move", {'date': self.d3}, status=None, actor='mcp')
        self.assertEqual((code, out['data']['needs_confirm'], out['data']['preview']['hour_slots']), (409, True, 1))
        self.assertEqual(self.get(t['id'])['date'], self.d2, 'preview does not move')
        self.assertEqual(call('POST', f"/tasks/{t['id']}/move", {'date': self.d3, 'confirm': True}, actor='mcp')['date'], self.d3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
