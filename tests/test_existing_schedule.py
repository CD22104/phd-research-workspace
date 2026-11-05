"""Link an existing local day task without losing its records or duplicating it."""
import json,sys,unittest,uuid
from test_paper_metadata import call
class ExistingSchedule(unittest.TestCase):
 def setUp(self):
  self.date=call('GET','/bootstrap')['today'];self.goal=call('POST','/goals',{'title':'existing-link-'+uuid.uuid4().hex,'week_id':self.date},201)
  self.sub=call('POST','/goal-tasks',{'goal_id':self.goal['id'],'title':'Weekly task'},201)
  self.task=call('POST','/tasks',{'date':self.date,'title':'Original daily wording','note':'Personal note','criteria':'Keep criteria','planned':False},201)
 def schedule(self,task=None,date=None,expected=201):
  return call('POST',f"/goal-tasks/{self.sub['id']}/schedule",{'date':date or self.date,'existing_task_id':(task or self.task)['id']},expected)
 def test_preserves_task_and_timer_and_replays(self):
  timer=call('POST','/timer/start',{'task_id':self.task['id']})
  linked=self.schedule();self.assertEqual(linked['id'],self.task['id'])
  for k in ['title','note','criteria','planned','created_at']:self.assertEqual(linked[k],self.task[k])
  self.assertEqual(linked['goal_task_id'],self.sub['id']);self.assertTrue(self.schedule()['already'])
  self.assertEqual(call('GET','/bootstrap')['running']['task_id'],self.task['id'])
  call('POST','/timer/stop',{})
  call('PATCH',f"/tasks/{self.task['id']}",{'status':'done'})
  data=call('GET','/export')['tables'];self.assertEqual(next(x for x in data['goal_tasks'] if x['id']==self.sub['id'])['status'],'done')
 def test_rejects_completed_and_wrong_date(self):
  self.schedule(date='2001-01-01',expected=400)
  call('PATCH',f"/tasks/{self.task['id']}",{'status':'done'})
  self.schedule(expected=409)
 def test_rejects_occupied_day_and_other_goal(self):
  other=call('POST','/goals',{'title':'other','week_id':self.date},201)
  call('PATCH',f"/tasks/{self.task['id']}",{'goal_id':other['id']})
  self.schedule(expected=400)
  call('PATCH',f"/tasks/{self.task['id']}",{'goal_id':None})
  call('POST',f"/goal-tasks/{self.sub['id']}/schedule",{'date':self.date},201)
  self.schedule(expected=409)
if __name__=='__main__':unittest.main(verbosity=2)
