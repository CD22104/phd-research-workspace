"""Conference preferences, project navigation metadata and daily/weekly task linkage. Fresh localhost D1 only."""
import concurrent.futures, json, runpy, sys, unittest, uuid
from datetime import date,timedelta
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:18976'
if not BASE.startswith(('http://127.0.0.1:','http://localhost:')):raise SystemExit('Local isolated database only')
sys.argv=sys.argv[:1]
ns=runpy.run_path('tests/test_planning_workflow.py');ns['call'].__globals__['BASE']=BASE;call=ns['call']
class ConferenceLinkage(unittest.TestCase):
 def setUp(self):
  self.today=call('GET','/bootstrap')['today'];self.stamp=uuid.uuid4().hex
  cur=call('GET','/timer')['running']
  if cur:call('POST','/timer/stop',{'session_id':cur['id']})
 def conf(self,key='cvpr-2027'):return next(x for x in call('GET','/conferences')['conferences'] if x['key']==key)
 def update(self,patch,key='cvpr-2027',**kwargs):return call('PATCH','/conferences/'+key,{'base_version':self.conf(key)['version'],**patch},**kwargs)
 def goal(self):return call('POST','/goals',{'title':'Goal '+self.stamp,'week_id':self.today},201)
 def children(self,g):return [t for t in call('GET','/week/'+self.today)['goal_tasks'] if t['goal_id']==g['id']]
 def test_catalog_preferences_and_conflicts(self):
  rows=call('GET','/conferences')['conferences'];self.assertEqual(len(rows),22)
  cvpr=self.conf();self.assertEqual(cvpr['milestones'][0]['at'],'2026-11-11T11:59:59.000Z')
  self.assertEqual(next(m for m in cvpr['milestones'] if m['id']=='submission')['at'],'2026-11-17T11:59:59.000Z')
  self.assertEqual(self.conf('acl-2027')['milestones'],[])
  self.update({'followed':True,'pinned':True})
  base=self.conf()['version']
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   results=list(pool.map(lambda _:call('PATCH','/conferences/cvpr-2027',{'base_version':base,'milestone_id':'registration','done':True},expected=None),range(2)))
  self.assertEqual(sorted(s for s,_ in results),[200,409])
  self.assertIn('registration',self.conf()['completed'])
  call('PATCH','/conferences/cvpr-2027',{'base_version':self.conf()['version'],'followed':False},409,actor='script')
  self.update({'followed':False,'confirm':True},actor='script')
  self.update({'milestone_id':'decision','done':True},expected=400)
  self.update({'project_id':999999},expected=400)
  self.update({'milestone_id':'registration','done':False,'followed':True})
  self.assertNotIn('registration',self.conf()['completed'])
  self.assertEqual(call('GET','/bootstrap')['conferences'],call('GET','/conferences')['conferences'])
 def test_submission_plan_is_separate_from_pin_follow_and_progress(self):
  key='iccv-2027'
  self.update({'pinned':True,'followed':True},key=key)
  self.assertFalse(self.conf(key)['planned'])
  self.update({'planned':'yes'},key=key,expected=400)
  active=self.update({'planned':True},key=key);self.assertTrue(active['planned'])
  self.assertTrue(next(x for x in call('GET','/bootstrap')['conferences'] if x['key']==key)['planned'])
  self.update({'planned':False},key=key)
  self.assertTrue(self.conf(key)['pinned']);self.assertFalse(self.conf(key)['planned'])
  self.update({'planned':True,'milestone_id':'registration','done':True})
  self.update({'planned':False})
  self.assertIn('registration',self.conf()['completed'])
  self.update({'milestone_id':'registration','done':False})
 def test_mark_submitted_ticks_round_in_one_version(self):
  key='www-2027'
  self.update({'planned':True},key=key)
  v=self.conf(key)['version']
  out=self.update({'milestone_ids':['registration','submission'],'done':True},key=key)
  self.assertEqual(set(out['completed']),{'registration','submission'});self.assertEqual(out['version'],v+1)
  stamp=out['completed']['submission']
  again=self.update({'milestone_ids':['submission'],'done':True},key=key);self.assertEqual(again['completed']['submission'],stamp,'re-marking keeps the first time')
  for bad in ([],['reviews'],['nope'],'submission',['submission']*11):
   self.update({'milestone_ids':bad,'done':True},key=key,expected=400)
  self.update({'milestone_ids':['submission'],'done':'yes'},key=key,expected=400)
  call('PATCH','/conferences/'+key,{'base_version':self.conf(key)['version'],'milestone_ids':['submission'],'done':False},409,actor='script')
  undone=self.update({'milestone_ids':['registration','submission'],'done':False},key=key)
  self.assertEqual(undone['completed'],{})
  self.assertTrue(undone['planned'])
  self.update({'planned':False},key=key)
 def test_project_pinning_direct_resource_metadata_and_unlink(self):
  a=call('POST','/projects',{'name':'Project A '+self.stamp},201)
  b=call('POST','/projects',{'name':'Project B '+self.stamp},201)
  note=call('POST','/notes',{'title':'Discussion','content':'Private long discussion body','project_id':b['id']},201)
  idea=call('POST','/ideas',{'title':'Pilot experiment','one_liner':'Private idea content','project_id':b['id']},201)
  call('PATCH',f"/projects/{b['id']}",{'pinned':True})
  rows=call('GET','/projects')['projects'];self.assertLess(next(i for i,p in enumerate(rows) if p['id']==b['id']),next(i for i,p in enumerate(rows) if p['id']==a['id']))
  row=next(p for p in rows if p['id']==b['id']);self.assertEqual(row['note_count'],1)
  self.assertEqual(row['notes'][0]['id'],note['id']);self.assertNotIn('content',row['notes'][0])
  self.assertEqual(row['ideas'][0]['id'],idea['id']);self.assertNotIn('one_liner',row['ideas'][0])
  self.update({'project_id':b['id']});self.assertEqual(self.conf()['project_name'],b['name'])
  exp=call('GET','/export');self.assertGreaterEqual(exp['schema_version'],14);self.assertIn('conference_targets',exp['tables'])
  call('DELETE',f"/projects/{b['id']}");self.assertIsNone(self.conf()['project_id'])
  self.assertEqual(call('GET',f"/notes/{note['id']}")['content'],'Private long discussion body')
 def test_daily_creation_is_atomic_reusable_and_completion_linked(self):
  goal=self.goal();paper=call('POST','/papers',{'title':'Source '+self.stamp,'url':'https://example.org/'+self.stamp,'enrich':False},201)
  paper_id=(paper.get('created',[])+paper.get('candidates',[]))[0]
  daily=call('POST','/tasks',{'title':'Auto-linked daily','date':self.today,'goal_id':goal['id'],'paper_ids':[paper_id],'note':'Preserve note','points':3},201)
  master=self.children(goal)[0];self.assertEqual(master['id'],daily['goal_task_id']);self.assertEqual(master['paper_ids'],[paper_id]);self.assertEqual(master['note'],'Preserve note')
  self.assertEqual(call('GET',f"/tasks/{daily['id']}")['title'],'Auto-linked daily')
  again=call('POST',f"/goal-tasks/{master['id']}/schedule",{'date':self.today},201);self.assertEqual(again['id'],daily['id'])
  tomorrow=str(date.fromisoformat(self.today)+timedelta(days=1))
  future=call('POST',f"/goal-tasks/{master['id']}/schedule",{'date':tomorrow},201);self.assertEqual(len(self.children(goal)),1)
  call('PATCH',f"/tasks/{daily['id']}",{'status':'done'})
  self.assertEqual(self.children(goal)[0]['status'],'done');self.assertEqual(call('GET',f"/tasks/{future['id']}")['status'],'dropped')
  call('PATCH',f"/tasks/{daily['id']}",{'status':'todo'});self.assertEqual(self.children(goal)[0]['status'],'todo')
  call('DELETE',f"/goal-tasks/{master['id']}")
  self.assertEqual(len(self.children(goal)),0);self.assertIsNone(call('GET',f"/tasks/{daily['id']}")['goal_task_id'])
 def test_assign_existing_daily_preserves_timer_and_prevents_duplicates(self):
  goal=self.goal();daily=call('POST','/tasks',{'title':'Existing daily '+self.stamp,'date':self.today,'note':'keep'},201)
  timer=call('POST','/timer/start',{'task_id':daily['id']})['running']
  patched=call('PATCH',f"/tasks/{daily['id']}",{'goal_id':goal['id']})
  self.assertEqual(patched['id'],daily['id']);self.assertIsNotNone(patched['goal_task_id']);self.assertEqual(call('GET','/timer')['running']['id'],timer['id'])
  call('PATCH',f"/tasks/{daily['id']}",{'goal_id':goal['id']});self.assertEqual(len(self.children(goal)),1)
  self.assertEqual(call('GET',f"/tasks/{daily['id']}")['note'],'keep')
  call('POST','/timer/stop',{'session_id':timer['id']})
  history=call('GET','/day/'+self.today)['sessions'];self.assertTrue(any(s['task_id']==daily['id'] for s in history))
 def test_existing_completed_daily_and_explicit_existing_master(self):
  g=self.goal();d=call('POST','/tasks',{'title':'Finished','date':self.today},201)
  call('PATCH',f"/tasks/{d['id']}",{'goal_id':g['id'],'status':'done'})
  self.assertEqual(self.children(g)[0]['status'],'done')
  plain=call('POST','/tasks',{'title':'Same task','date':self.today},201)
  master=call('POST','/goal-tasks',{'goal_id':g['id'],'title':'Same task'},201)
  linked=call('POST',f"/goal-tasks/{master['id']}/schedule",{'date':self.today,'existing_task_id':plain['id']},201)
  self.assertEqual(linked['goal_task_id'],master['id']);self.assertEqual(len(self.children(g)),2)
if __name__=='__main__':unittest.main(verbosity=2)
