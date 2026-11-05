"""Daily reading and background history: disposable localhost D1 only."""
import sys,unittest,uuid,sqlite3
from pathlib import Path
from datetime import datetime,timedelta,timezone
import test_feed_bridge as bridge
DB=Path(sys.argv[1]);sys.argv=sys.argv[:1]
H={'X-Requested-With':'test','X-Actor':'web'}
def call(method,path,data=None,expected=200,headers=None):
 status,body,_=bridge.request('/api'+path,data,method=method,headers=headers or H)
 assert status==expected,(status,body)
 return body
class DailyFeeds(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  _,t=bridge.connect();cls.token=t['access_token'];cls.today=call('GET','/bootstrap')['today']
 def payload(self,**changes):
  return dict(task_key='daily_news',report_date=self.today,title='Daily test '+uuid.uuid4().hex,markdown='# Full report\n\nBody preserved. END',content_status='complete',run_key=uuid.uuid4().hex,**changes)
 def save(self,p):return bridge.rpc(self.token,'save_feed_result',p)['structuredContent']
 def day(self,date=None):return call('GET','/feeds/day?date='+(date or self.today))
 def task(self,key,date=None):return next(t for t in self.day(date)['tasks'] if t['task_key']==key)
 def test_01_manual_completion_and_revision(self):
  p=self.payload();a=self.save(p);rid=a['report_id']
  self.assertIsNone(call('GET',f'/feeds/items/{rid}')['item']['reviewed_at'])
  call('PATCH',f'/feeds/items/{rid}',{'read_state':'read'})
  self.assertIsNone(call('GET',f'/feeds/items/{rid}')['item']['reviewed_at'])
  call('PATCH',f'/feeds/items/{rid}',{'review_completed':True})
  stamp=call('GET',f'/feeds/items/{rid}')['item']['reviewed_at'];self.assertTrue(stamp)
  self.assertEqual(next(r for r in self.task('daily_news')['reports'] if r['id']==rid)['reviewed_at'],stamp)
  call('PATCH',f'/feeds/items/{rid}',{'review_completed':True});self.assertEqual(call('GET',f'/feeds/items/{rid}')['item']['reviewed_at'],stamp)
  call('PATCH',f'/feeds/items/{rid}',{'review_completed':False});self.assertIsNone(call('GET',f'/feeds/items/{rid}')['item']['reviewed_at'])
  call('PATCH',f'/feeds/items/{rid}',{'review_completed':True})
  p['markdown']+='\nNew revision';b=self.save(p);self.assertEqual(b['version'],2)
  reports=self.task('daily_news')['reports'];self.assertNotIn(rid,[r['id'] for r in reports]);self.assertIsNone(next(r for r in reports if r['id']==b['report_id'])['reviewed_at'])
  self.assertTrue(call('GET',f'/feeds/items/{rid}')['item']['reviewed_at'])
  call('PATCH',f'/feeds/items/{rid}',{'review_completed':True},400,{'X-Requested-With':'test','X-Actor':'script'})
 def test_02_failure_and_idempotent_recovery(self):
  p=self.payload();a=self.save(p)
  invalid={**p,'markdown':' '};self.assertTrue(bridge.rpc(self.token,'save_feed_result',invalid)['isError'])
  t=self.task('daily_news');self.assertEqual(t['delivery']['state'],'failed');self.assertNotIn('markdown',t['last_run']['message'])
  b=self.save(p);self.assertTrue(b['duplicate']);self.assertEqual(a['report_id'],b['report_id']);self.assertEqual(self.task('daily_news')['delivery']['state'],'received')
  # Old-date failures stay on their report date, not on today's dashboard.
  invalid['report_date']='2020-01-01';bridge.rpc(self.token,'save_feed_result',invalid)
  self.assertEqual(self.task('daily_news','2020-01-01')['delivery']['state'],'failed')
  self.assertEqual(self.task('daily_news')['delivery']['state'],'received')
 def test_03_expectations_and_validation(self):
  tomorrow=(datetime.fromisoformat(self.today)+timedelta(days=1)).date().isoformat()
  self.assertEqual(self.task('daily_news',tomorrow)['delivery']['state'],'waiting')
  self.assertEqual(self.task('daily_news','2020-01-02')['delivery']['state'],'late')
  self.assertEqual(self.task('field_frontier',tomorrow)['delivery']['state'],'not_started')
  task=call('POST','/feeds/tasks',{'name':'No schedule '+uuid.uuid4().hex,'runner':'chatgpt'},201)
  tid=task['id'];self.assertEqual(next(t for t in self.day(tomorrow)['tasks'] if t['id']==tid)['delivery']['state'],'missing')
  call('PATCH',f'/feeds/tasks/{tid}',{'expected_time':'25:00'},400)
  call('PATCH',f'/feeds/tasks/{tid}',{'expected_days':[]},400)
  call('PATCH',f'/feeds/tasks/{tid}',{'expected_enabled':'false'},400)
  call('GET','/feeds/day?date=2026-02-30',expected=400)
 def test_04_background_records_and_focus_totals(self):
  current=call('GET','/timer')
  if current['running']:call('POST','/timer/stop',{'session_id':current['running']['id']})
  task=call('POST','/tasks',{'date':self.today,'title':'Parallel daily task','planned':True},201)
  before=call('GET','/day/'+self.today)['summary']['minutes']
  f=call('POST','/timer/start',{'task_id':task['id']})['running']
  b=call('POST','/background-timer/start',{'task_id':task['id']},201)['started']
  self.assertEqual(b['label'],task['title']);self.assertEqual(b['task_id'],task['id'])
  self.assertEqual(call('POST','/background-timer/start',{'task_id':task['id']},201)['started']['id'],b['id'])
  call('POST','/timer/stop',{'session_id':f['id']});call('POST','/background-timer/stop',{'session_id':b['id']})
  midnight=datetime.fromisoformat(self.today+'T00:00:00+08:00');previous=(midnight-timedelta(days=1)).date().isoformat()
  iso=lambda t:t.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
  db=next(p for p in DB.rglob('*.sqlite') if 'D1DatabaseObject' in str(p) and p.name!='metadata.sqlite')
  with sqlite3.connect(db) as con:
   con.execute('UPDATE sessions SET start_at=?,end_at=? WHERE id=?',(iso(midnight-timedelta(minutes=10)),iso(midnight+timedelta(minutes=10)),f['id']))
   con.execute('UPDATE background_sessions SET start_at=?,end_at=? WHERE id=?',(iso(midnight-timedelta(minutes=60)),iso(midnight+timedelta(minutes=60)),b['id']))
  self.assertEqual(call('GET','/day/'+self.today)['summary']['minutes']-before,10)
  bg=call('GET',f'/background-sessions?from={previous}&to={self.today}')
  segments=[r for r in bg['segments'] if r['id']==b['id']];self.assertEqual(len(segments),2);self.assertTrue(all(r['minutes']==60 for r in segments))
  fg=call('GET',f'/sessions?from={previous}&to={self.today}')
  self.assertTrue(all(r['minutes']==10 for r in fg['segments'] if r['id']==f['id']))
  self.assertEqual(call('GET',f'/background-sessions?date={self.today}')['total_minutes'],sum(r['day_elapsed_ms'] for r in call('GET',f'/background-sessions?date={self.today}')['sessions'])//60000)
  call('GET','/background-sessions?from=2026-09-30&to=2026-09-29',expected=400)
if __name__=='__main__':unittest.main(verbosity=2)
