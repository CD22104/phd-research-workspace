"""Real D1 focus pause/resume and independent background clocks. Isolated localhost only."""
import concurrent.futures,json,runpy,sys,unittest,uuid,time,sqlite3
from pathlib import Path
from datetime import datetime,timedelta,timezone
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:18972'
DB=Path(sys.argv[2]) if len(sys.argv)>2 else None
sys.argv=sys.argv[:1]
ns=runpy.run_path('tests/test_task_reading.py');ns['call'].__globals__['BASE']=BASE;call=ns['call']
if not BASE.startswith(('http://127.0.0.1:','http://localhost:')):raise SystemExit('Local only')
class FocusBackground(unittest.TestCase):
 def setUp(self):
  cur=call('GET','/timer')
  if cur['running']:call('POST','/timer/stop',{'session_id':cur['running']['id']})
  for b in cur['background']:call('POST','/background-timer/stop',{'session_id':b['id']})
  self.today=call('GET','/bootstrap')['today']
  self.task=call('POST','/tasks',{'date':self.today,'title':'Focus '+uuid.uuid4().hex})
 def start(self):return call('POST','/timer/start',{'task_id':self.task['id']})['running']
 def test_pause_resume_segments_and_idempotence(self):
  a=self.start();time.sleep(.02)
  p=call('POST','/timer/pause',{'session_id':a['id']})['running'];self.assertTrue(p['paused']);self.assertGreater(p['elapsed_before_ms'],0)
  self.assertEqual(call('POST','/timer/pause',{'session_id':a['id']})['running']['elapsed_before_ms'],p['elapsed_before_ms'])
  # The elapsed total stays fixed while paused, including through bootstrap.
  time.sleep(.03);self.assertEqual(call('GET','/bootstrap')['running']['elapsed_before_ms'],p['elapsed_before_ms'])
  with concurrent.futures.ThreadPoolExecutor(3) as ex:
   rows=list(ex.map(lambda _:call('POST','/timer/resume',{'session_id':a['id']}),range(3)))
  ids={r['running']['id'] for r in rows};self.assertEqual(len(ids),1);b=rows[0]['running'];self.assertFalse(b['paused']);self.assertEqual(b['elapsed_before_ms'],p['elapsed_before_ms'])
  self.assertNotEqual(b['id'],a['id'])
  # A delayed stop for the previous segment must not stop the new one.
  call('POST','/timer/stop',{'session_id':a['id']});self.assertEqual(call('GET','/timer')['running']['id'],b['id'])
  call('POST','/timer/stop',{'session_id':b['id']});self.assertIsNone(call('GET','/timer')['running'])
 def test_stop_paused_and_task_completion(self):
  a=self.start();call('POST','/timer/pause',{'session_id':a['id']});call('POST','/timer/stop',{'session_id':a['id']});self.assertIsNone(call('GET','/timer')['running'])
  b=self.start();call('POST','/timer/pause',{'session_id':b['id']});call('PATCH',f"/tasks/{self.task['id']}",{'status':'done'});self.assertIsNone(call('GET','/timer')['running'])
 def test_background_is_independent_and_not_focus_work(self):
  a=self.start();one=call('POST','/background-timer/start',{'label':'Codex build','task_id':self.task['id']})['started'];two=call('POST','/background-timer/start',{'label':'Experiment'})['started']
  replay=call('POST','/background-timer/start',{'task_id':self.task['id']})['started'];self.assertEqual(replay['id'],one['id'])
  self.assertEqual(len(call('GET','/timer')['background']),2)
  call('POST','/timer/pause',{'session_id':a['id']});self.assertEqual(len(call('GET','/timer')['background']),2)
  call('POST','/background-timer/stop',{'session_id':one['id']});self.assertTrue(call('GET','/timer')['running']['paused']);self.assertEqual(len(call('GET','/timer')['background']),1)
  before=call('GET','/day/'+self.today)['summary']['minutes']
  # Deterministic long background time, which must not inflate focus statistics.
  if DB:
   db=next(p for p in DB.rglob('*.sqlite') if 'D1DatabaseObject' in str(p) and p.name!='metadata.sqlite');con=sqlite3.connect(db);past=(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat(timespec='milliseconds').replace('+00:00','Z');con.execute('UPDATE background_sessions SET start_at=? WHERE id=?',(past,two['id']));con.commit();con.close()
  self.assertEqual(call('GET','/day/'+self.today)['summary']['minutes'],before)
  call('POST','/background-timer/stop',{'session_id':two['id']});self.assertGreaterEqual(call('GET','/background-sessions?date='+self.today)['total_minutes'],1)
 def test_switch_paused_focus_and_export(self):
  a=self.start();call('POST','/timer/pause',{'session_id':a['id']})
  b=call('POST','/timer/start',{'label':'Another focus','switch':True})['running'];self.assertFalse(b['paused']);self.assertNotEqual(a['id'],b['id'])
  out=call('GET','/export');self.assertGreaterEqual(out['schema_version'],8);self.assertIn('background_sessions',out['tables']);self.assertEqual(out['tables']['timer_pauses'],[])
 def test_pause_gaps_and_background_split_at_local_midnight(self):
  if not DB:self.skipTest('Needs isolated database path')
  today=datetime.fromisoformat(self.today+'T00:00:00+08:00')
  previous=(today-timedelta(days=1)).date().isoformat()
  before_today=call('GET','/day/'+self.today)['summary']['minutes']
  before_previous=call('GET','/day/'+previous)['summary']['minutes']
  bg_before={d:call('GET','/background-sessions?date='+d)['total_minutes'] for d in [self.today,previous]}
  a=self.start();call('POST','/timer/pause',{'session_id':a['id']})
  b=call('POST','/timer/resume',{'session_id':a['id']})['running'];call('POST','/timer/pause',{'session_id':b['id']})
  bg=call('POST','/background-timer/start',{'label':'Midnight split'})['started']
  iso=lambda t:t.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
  db=next(p for p in DB.rglob('*.sqlite') if 'D1DatabaseObject' in str(p) and p.name!='metadata.sqlite')
  with sqlite3.connect(db) as con:
   con.execute('UPDATE sessions SET start_at=?,end_at=? WHERE id=?',(iso(today-timedelta(minutes=20)),iso(today-timedelta(minutes=10)),a['id']))
   con.execute('UPDATE sessions SET start_at=?,end_at=? WHERE id=?',(iso(today+timedelta(minutes=10)),iso(today+timedelta(minutes=25)),b['id']))
   con.execute('UPDATE background_sessions SET start_at=?,end_at=? WHERE id=?',(iso(today-timedelta(minutes=15)),iso(today+timedelta(minutes=15)),bg['id']))
  self.assertEqual(call('GET','/timer')['running']['elapsed_before_ms'],25*60000)
  self.assertEqual(call('GET','/day/'+self.today)['summary']['minutes']-before_today,15)
  self.assertEqual(call('GET','/day/'+previous)['summary']['minutes']-before_previous,10)
  for d in [self.today,previous]:self.assertEqual(call('GET','/background-sessions?date='+d)['total_minutes']-bg_before[d],15)
  stopped=call('POST','/timer/stop',{'session_id':b['id'],'note':'Paused save'})['stopped']
  self.assertEqual(stopped['note'],'Paused save');self.assertEqual(stopped['elapsed_ms'],25*60000)
 def tearDown(self):
  cur=call('GET','/timer')
  if cur['running']:call('POST','/timer/stop',{'session_id':cur['running']['id']})
  for b in cur['background']:call('POST','/background-timer/stop',{'session_id':b['id']})
unittest.main(verbosity=2)
