"""日程接口验收：只允许显式指定本机隔离测试服务器，不可在生产库运行。

  python3 tests/test_calendar.py http://127.0.0.1:18923
"""
import json
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = sys.argv.pop(1).rstrip('/') if len(sys.argv) > 1 else ''
parsed = urllib.parse.urlparse(BASE)
if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or not parsed.port:
    raise SystemExit('必须显式指定 http://127.0.0.1:端口 的隔离本地测试服务器')


def call(method, path, body=None, actor='web'):
    req = urllib.request.Request(BASE + '/api' + path,
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Content-Type': 'application/json', 'X-Requested-With': 'calendar-test', 'X-Actor': actor})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read() or b'{}')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'{}')


def event(**patch):
    out = dict(date='2098-06-03', title='日程验收会议', kind='meeting', all_day=False,
               start_time='10:15', end_time='11:00', client_key='test-' + uuid.uuid4().hex)
    out.update(patch)
    return out


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.ids = set()

    def tearDown(self):
        for event_id in self.ids:
            call('DELETE', f'/calendar/events/{event_id}')

    def create(self, **patch):
        payload = event(**patch)
        status, out = call('POST', '/calendar/events', payload)
        self.assertEqual(status, 201, out)
        self.ids.add(out['id'])
        return payload, out

    def test_crud_range_order_and_local_time(self):
        _, first = self.create(location='线上', note='保留本地时间')
        _, whole = self.create(title='全天安排', all_day=True, start_time=None, end_time=None)
        _, outside = self.create(date='2098-06-10')
        status, listing = call('GET', '/calendar?from=2098-06-03&to=2098-06-09')
        self.assertEqual(status, 200)
        self.assertEqual(listing['timezone'], 'Asia/Singapore')
        self.assertEqual(len(listing['days']), 7)
        own = [row for row in listing['events'] if row['id'] in self.ids]
        self.assertEqual([row['id'] for row in own], [whole['id'], first['id']])
        self.assertEqual(first['start_time'], '10:15')
        status, moved = call('PATCH', f"/calendar/events/{first['id']}", {'date': '2098-06-04', 'end_time': '11:30'})
        self.assertEqual(status, 200, moved)
        self.assertEqual((moved['date'], moved['start_time'], moved['end_time']), ('2098-06-04', '10:15', '11:30'))
        self.assertEqual(call('DELETE', f"/calendar/events/{outside['id']}")[0], 200)
        self.ids.remove(outside['id'])
        self.assertEqual(call('PATCH', f"/calendar/events/{outside['id']}", {'title': '已删除'})[0], 404)

    def test_bad_dates_times_ranges_and_types(self):
        for patch in [dict(date='2098-02-30'), dict(date='2098-2-03'), dict(start_time='9:00'),
                      dict(start_time='24:00'), dict(end_time='10:15'), dict(end_time='09:00'),
                      dict(title='  '), dict(title=['错误']), dict(kind='work'), dict(all_day='false'),
                      dict(client_key='bad key')]:
            with self.subTest(patch=patch):
                self.assertEqual(call('POST', '/calendar/events', event(**patch))[0], 400)
        for query in ['from=2098-06-04&to=2098-06-03', 'from=2098-01-01&to=2099-01-01', 'from=2098-02-30']:
            self.assertEqual(call('GET', '/calendar?' + query)[0], 400)

    def test_all_day_switch_requires_explicit_time_when_unset(self):
        _, row = self.create()
        status, whole = call('PATCH', f"/calendar/events/{row['id']}", {'all_day': True})
        self.assertEqual(status, 200, whole)
        self.assertIsNone(whole['start_time'])
        self.assertIsNone(whole['end_time'])
        self.assertEqual(call('PATCH', f"/calendar/events/{row['id']}", {'all_day': False})[0], 400)
        status, timed = call('PATCH', f"/calendar/events/{row['id']}", {'all_day': False, 'start_time': '08:00', 'end_time': '08:30'})
        self.assertEqual(status, 200, timed)
        self.assertEqual(timed['all_day'], 0)

    def test_retries_and_concurrent_create_do_not_duplicate(self):
        payload = event(title='重试和并发')
        barrier = threading.Barrier(2)
        def send():
            barrier.wait()
            return call('POST', '/calendar/events', payload)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: send(), range(2)))
        self.assertTrue(all(status in (200, 201) for status, _ in results), results)
        ids = {row['id'] for _, row in results}
        self.ids.update(ids)
        self.assertEqual(len(ids), 1)
        status, again = call('POST', '/calendar/events', payload)
        self.assertEqual(status, 200)
        self.assertTrue(again['replayed'])
        self.assertEqual(call('POST', '/calendar/events', {**payload, 'title': '冲突内容'})[0], 409)

    def test_external_changes_and_deletes_require_confirmation(self):
        _, row = self.create()
        path = f"/calendar/events/{row['id']}"
        status, preview = call('PATCH', path, {'title': '外部修改'}, actor='script')
        self.assertEqual(status, 409)
        self.assertTrue(preview['data']['needs_confirm'])
        self.assertEqual(call('PATCH', path, {'title': '外部修改', 'confirm': True}, actor='script')[0], 200)
        status, preview = call('DELETE', path, actor='api')
        self.assertEqual(status, 409)
        self.assertTrue(preview['data']['needs_confirm'])
        self.assertEqual(call('DELETE', path + '?confirm=1', actor='api')[0], 200)
        self.ids.remove(row['id'])

    def test_meeting_and_break_preserve_day_kind_and_recorded_time(self):
        date = '2098-06-03'
        self.assertEqual(call('PUT', '/day/' + date, {'kind': 'work'})[0], 200)
        before = call('GET', '/day/' + date)[1]
        self.create(kind='break', all_day=True, title='全天休息活动')
        self.create(kind='meeting')
        after = call('GET', '/day/' + date)[1]
        self.assertEqual(after['summary']['kind'], 'work')
        self.assertEqual(after['summary']['minutes'], before['summary']['minutes'])
        self.assertEqual(after['sessions'], before['sessions'])
        call('PUT', '/day/' + date, {'kind': 'rest'})
        result = call('GET', f'/calendar?from={date}&to={date}')[1]
        self.assertEqual(result['days'][0]['kind'], 'rest')
        self.assertEqual(result['days'][0]['explicit_kind'], 'rest')
        call('PUT', '/day/' + date, {'kind': None})

    def test_default_days_respect_history(self):
        old = call('GET', '/calendar?from=2026-09-19&to=2026-09-20')[1]
        current = call('GET', '/calendar?from=2026-09-26&to=2026-09-27')[1]
        self.assertEqual([day['kind'] for day in old['days']], ['rest', 'rest'])
        self.assertEqual([day['kind'] for day in current['days']], ['work', 'work'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
