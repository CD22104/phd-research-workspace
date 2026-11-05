"""Task time slots against an isolated localhost D1 only."""
import concurrent.futures,json,sys,unittest,urllib.request,urllib.error,urllib.parse,uuid
BASE=sys.argv.pop(1) if len(sys.argv)>1 else 'http://127.0.0.1:18988'
assert urllib.parse.urlparse(BASE).hostname in ('localhost','127.0.0.1')
def call(method,path,data=None,status=200,actor='web',csrf=True):
 headers={'Content-Type':'application/json','X-Actor':actor}
 if csrf:headers['X-Requested-With']='time-block-test'
 req=urllib.request.Request(BASE+'/api'+path,method=method,headers=headers,data=json.dumps(data).encode() if data is not None else None)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:code,out=r.status,json.load(r)
 except urllib.error.HTTPError as e:code,out=e.code,json.load(e)
 if status is None:return code,out
 assert code==status,(path,code,out)
 return out
class TimeBlocks(unittest.TestCase):
 def setUp(self):
  self.date='2026-10-07'
  self.task=call('POST','/tasks',{'title':'Slot test '+uuid.uuid4().hex,'date':self.date},201)
 def payload(self,**extra):return {'task_id':self.task['id'],'date':self.date,'start_minute':540,'end_minute':600,'client_key':uuid.uuid4().hex,**extra}
 def create(self,**extra):return call('POST','/time-blocks',self.payload(**extra),201)
 def rows(self,date=None):return call('GET',f'/day/{date or self.date}/time-blocks')['blocks']
 def test_retry_and_parallel_creation(self):
  b=self.payload()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:rows=list(pool.map(lambda _:call('POST','/time-blocks',b,status=None),range(2)))
  self.assertTrue(all(s in (200,201) for s,_ in rows));self.assertEqual(rows[0][1]['id'],rows[1][1]['id'])
  self.assertEqual(len([r for r in self.rows() if r['task_id']==self.task['id']]),1)
  call('POST','/time-blocks',{**b,'start_minute':555},409)
  self.assertEqual(self.create()['id'],rows[0][1]['id'])
 def test_validation_and_wrong_day(self):
  for extra in [{'start_minute':-1},{'end_minute':1441},{'start_minute':600},{'end_minute':True},{'start_minute':540.1},{'client_key':'bad'},{'date':'2026-02-30'}]:call('POST','/time-blocks',self.payload(**extra),400)
  call('POST','/time-blocks',self.payload(date='2026-10-08'),409)
  call('POST','/time-blocks',self.payload(),403,csrf=False)
  midnight=self.create(start_minute=1380,end_minute=1440);self.assertEqual(midnight['end_minute'],1440)
 def test_versioned_moves_and_removal(self):
  row=self.create()
  def patch(start):return call('PATCH',f"/time-blocks/{row['id']}",{'date':self.date,'base_version':1,'start_minute':start,'end_minute':start+60},status=None)
  with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(patch,[600,660]))
  self.assertEqual(sorted(s for s,_ in results),[200,409]);saved=next(r for s,r in results if s==200)
  path=f"/time-blocks/{row['id']}?date={self.date}&base_version="
  call('DELETE',path+'1',status=409)
  call('DELETE',path+'2',status=409,actor='script')
  call('DELETE',path+'2&confirm=1',actor='script')
  self.assertFalse(any(r['id']==row['id'] for r in self.rows()))
  self.assertEqual(call('GET',f"/tasks/{self.task['id']}")['title'],self.task['title'])
 def test_slots_do_not_add_work_or_sessions_and_export(self):
  before=call('GET','/day/'+self.date);timer=call('GET','/timer')
  self.create();self.create(start_minute=780,end_minute=900)
  after=call('GET','/day/'+self.date)
  self.assertEqual(before['summary']['minutes'],after['summary']['minutes']);self.assertEqual(before['sessions'],after['sessions'])
  self.assertEqual(timer['running'],call('GET','/timer')['running'])
  exported=call('GET','/export');self.assertEqual(exported['schema_version'],14);self.assertTrue(any(r['task_id']==self.task['id'] for r in exported['tables']['task_time_blocks']))
 def test_task_lifecycle_and_script_confirmation(self):
  row=self.create();path=f"/time-blocks/{row['id']}"
  update={'date':self.date,'base_version':1,'start_minute':600,'end_minute':660}
  call('PATCH',path,update,409,actor='script');call('PATCH',path,{**update,'confirm':True},actor='script')
  call('PATCH',f"/tasks/{self.task['id']}",{'title':'Renamed'})
  self.assertEqual(next(r for r in self.rows() if r['id']==row['id'])['title'],'Renamed')
  call('PATCH',f"/tasks/{self.task['id']}",{'status':'done'})
  call('POST','/time-blocks',self.payload(start_minute=700,end_minute=800),409)
  self.assertEqual(next(r for r in self.rows() if r['id']==row['id'])['status'],'done')
  call('PATCH',f"/tasks/{self.task['id']}",{'status':'todo','date':'2026-10-08'})
  self.assertFalse(any(r['id']==row['id'] for r in self.rows()))
  self.assertTrue(any(r['id']==row['id'] for r in self.rows('2026-10-08')))
  call('PATCH',path,{**update,'base_version':2},409)
  call('DELETE',f"/tasks/{self.task['id']}")
  self.assertFalse(any(r['id']==row['id'] for r in self.rows('2026-10-08')))
if __name__=='__main__':unittest.main(verbosity=2)
