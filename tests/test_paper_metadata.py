"""Metadata batching: preview, atomic validation, replay and undo. Local server only."""
import json,sys,unittest,urllib.request,urllib.error,uuid
from urllib.parse import urlparse
BASE=sys.argv.pop(1) if len(sys.argv)>1 and sys.argv[1].startswith('http') else 'http://127.0.0.1:18931'
if urlparse(BASE).hostname not in ('127.0.0.1','localhost'):raise SystemExit('Local test server required')
def call(method,path,body=None,expected=200):
 req=urllib.request.Request(BASE+'/api'+path,method=method,headers={'Content-Type':'application/json','X-Requested-With':'metadata-test','X-Actor':'mcp'},data=None if body is None else json.dumps(body).encode())
 try:
  with urllib.request.urlopen(req,timeout=60) as r:status,data=r.status,json.load(r)
 except urllib.error.HTTPError as e:status,data=e.code,json.load(e)
 if status!=expected:raise AssertionError((method,path,status,data))
 return data
class Metadata(unittest.TestCase):
 def setUp(self):
  self.ids=call('POST','/import/commit',{'import_key':'fixture-'+uuid.uuid4().hex,'source':{'kind':'manual'},'items':[{'draft':{'title':uuid.uuid4().hex,'my_note':'Personal note','my_question':'Personal question','tags':['Old tag']},'action':'create'} for _ in range(3)]})['created']
  self.original=[call('GET',f'/papers/{pid}')['paper'] for pid in self.ids]
  self.request={'import_key':uuid.uuid4().hex,'name':'Metadata regression','items':[{'id':p['id'],'expected_updated_at':p['updated_at'],'patch':{'summary':'Verified summary','tags':['安全监控'],'material_type':'paper','verification_status':'verified','verified_at':'2026-09-26'}} for p in self.original]}
 def test_preview_commit_replay_and_undo(self):
  preview=call('POST','/papers/metadata-batch',self.request)
  self.assertTrue(preview['needs_confirm']);self.assertEqual(preview['changed_papers'],3)
  self.assertEqual(call('GET',f'/papers/{self.ids[0]}')['paper'],self.original[0])
  result=call('POST','/papers/metadata-batch',{**self.request,'confirm':True})
  self.assertEqual(set(result['changed_papers']),set(self.ids))
  self.assertTrue(call('POST','/papers/metadata-batch',{**self.request,'confirm':True})['replayed'])
  for pid in self.ids:
   p=call('GET',f'/papers/{pid}')['paper'];self.assertEqual(p['my_note'],'Personal note');self.assertEqual(p['verification_status'],'verified');self.assertEqual(p['tags'],['安全监控'])
  call('POST',f"/sources/{result['source_id']}/undo",{'confirm':True})
  for old in self.original:
   now=call('GET',f"/papers/{old['id']}")['paper']
   for field in ('summary','tags','material_type','verification_status','my_note','my_question'):self.assertEqual(now[field],old[field])
 def test_stale_batch_does_not_partially_write(self):
  call('PATCH',f'/papers/{self.ids[-1]}',{'summary':'Edited after preview'})
  call('POST','/papers/metadata-batch',{**self.request,'confirm':True},409)
  self.assertIsNone(call('GET',f'/papers/{self.ids[0]}')['paper']['summary'])
 def test_rejects_personal_fields_invalid_status_and_duplicate_ids(self):
  for patch in ({'my_note':'overwrite'},{'verification_status':'guess'},{'title':''}):
   request={**self.request,'items':[{**self.request['items'][0],'patch':patch}]}
   call('POST','/papers/metadata-batch',{**request,'confirm':True},400)
  call('POST','/papers/metadata-batch',{**self.request,'items':[self.request['items'][0]]*2,'confirm':True},400)
  self.assertEqual(call('GET',f'/papers/{self.ids[0]}')['paper'],self.original[0])
if __name__=='__main__':unittest.main(verbosity=2)
