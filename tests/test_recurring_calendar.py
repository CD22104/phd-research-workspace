"""Integration checks for an isolated localhost database; no credentials or model calls."""
import json, sys, urllib.request, urllib.error
from urllib.parse import urlparse
BASE = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:18962'
assert urlparse(BASE).hostname in ('localhost','127.0.0.1')
def call(method,path,data=None,status=200,actor='web'):
    req=urllib.request.Request(BASE+'/api'+path,method=method,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','X-Requested-With':'test','X-Actor':actor})
    try:
        with urllib.request.urlopen(req) as r: code,out=r.status,json.load(r)
    except urllib.error.HTTPError as e: code,out=e.code,json.load(e)
    assert code==status,(path,code,out)
    return out
body={'title':'Recurring course','date':'2026-09-28','kind':'course','all_day':False,'start_time':'10:00','end_time':'11:00','client_key':'repeat-course','recurrence':{'frequency':'weekly','interval':2,'weekdays':[1,3],'until':'2026-10-14'}}
a=call('POST','/calendar/events',body,201)
def events(): return call('GET','/calendar?from=2026-09-28&to=2026-10-31')['events']
x=events();assert [e['date'] for e in x]==['2026-09-28','2026-09-30','2026-10-12','2026-10-14']
assert call('POST','/calendar/events',body)['replayed'] and len(events())==4
call('POST','/calendar/events',{**body,'recurrence':{**body['recurrence'],'interval':1}},409)
call('POST','/calendar/events',{**body,'client_key':'invalid-days','recurrence':{**body['recurrence'],'weekdays':[2]}},400)
call('POST','/calendar/events',{**body,'client_key':'invalid-array','recurrence':{**body['recurrence'],'weekdays':42}},400)
call('PATCH',f'/calendar/events/{x[1]["id"]}',{'title':'One-off change'})
assert [e['title'] for e in events()]==['Recurring course','One-off change','Recurring course','Recurring course']
call('PATCH',f'/calendar/events/{x[2]["id"]}',{'scope':'following','start_time':'13:00','end_time':'14:00'},409,actor='script')
call('PATCH',f'/calendar/events/{x[2]["id"]}',{'scope':'following','start_time':'13:00','end_time':'14:00','confirm':True},actor='script')
assert [e['start_time'] for e in events()]==['10:00','10:00','13:00','13:00']
call('PATCH',f'/calendar/events/{x[2]["id"]}',{'scope':'following','date':'2026-10-13'},400)
call('DELETE',f'/calendar/events/{x[2]["id"]}?scope=following',status=409,actor='script')
call('DELETE',f'/calendar/events/{x[2]["id"]}?scope=following&confirm=1',actor='script')
assert len(events())==2
call('DELETE',f'/calendar/events/{x[1]["id"]}')
assert len(events())==1
call('POST','/calendar/events',{'title':'Daily','date':'2026-10-01','kind':'meeting','all_day':True,'recurrence':{'frequency':'daily','until':'2026-10-03'}},201)
assert len(events())==4
call('POST','/calendar/events',{'title':'Daily check-in','date':'2026-11-01','kind':'checkin','all_day':True,'recurrence':{'frequency':'daily','until':'2026-11-03'}},201)
assert len(call('GET','/calendar?from=2026-11-01&to=2026-11-03')['events'])==3
# A failed run cannot leave a success receipt or partial content behind.
t=call('POST','/feeds/tasks',{'name':'Codex upload test','runner':'codex'},201)
assert t['runner']=='codex'
feed={'task_id':t['id'],'run_key':'codex-upload-1','items':[{'title':'A report','content':'# Existing report\nNo model required','date':'2026-09-27'}]}
first=call('POST','/feeds/runs',feed,201)
second=call('POST','/feeds/runs',feed)
assert second['replayed'] and first['run']['id']==second['run']['id'] and first['items']==second['items']
call('POST','/feeds/runs',{**feed,'run_key':'invalid-content','items':feed['items']+[{'title':'bad','content':''}]},400)
assert len(call('GET',f'/feeds/runs?task_id={t["id"]}')['runs'])==1
# Exercise real CLI upload and its local-only dry run with no service secrets.
import importlib.util, types, tempfile, contextlib, io
from pathlib import Path
spec=importlib.util.spec_from_file_location('honey',Path(__file__).parents[1]/'scripts/honey.py');honey=importlib.util.module_from_spec(spec);spec.loader.exec_module(honey)
honey.CFG={'HONEY_URL':BASE}
with tempfile.TemporaryDirectory() as tmp:
    f=Path(tmp)/'report.md';f.write_text('# CLI report\nStored as written',encoding='utf8')
    args=types.SimpleNamespace(file=str(f),task_id=t['id'],date='2026-09-27',title=None,run_key=None,dry_run=True)
    real=honey.call
    honey.call=lambda *a,**k: (_ for _ in ()).throw(AssertionError('dry-run must not use network'))
    with contextlib.redirect_stdout(io.StringIO()): honey.cmd_feed_upload(args)
    honey.call=real;args.dry_run=False
    with contextlib.redirect_stdout(io.StringIO()) as output: honey.cmd_feed_upload(args)
    assert json.loads(output.getvalue())['ok']
    with contextlib.redirect_stdout(io.StringIO()) as output: honey.cmd_feed_upload(args)
    assert json.loads(output.getvalue())['replayed']
print('PASS: course, fortnightly weekdays, daily, finite ranges, replay, per-instance / following edits and deletes, confirmation, atomic feed validation, CLI upload and dry-run')
