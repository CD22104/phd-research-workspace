"""Paper-group API integration checks. Run ONLY against a fresh local dev-test-server."""
import json, sys, urllib.request, urllib.error
from urllib.parse import urlparse
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:18961'
assert urlparse(BASE).hostname in ('localhost', '127.0.0.1'), 'Use an isolated local database'
def call(method, path, data=None, expected=200, actor='web'):
    request = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type':'application/json','X-Requested-With':'test','X-Actor':actor})
    try:
        with urllib.request.urlopen(request, timeout=30) as r: status, result = r.status, json.load(r)
    except urllib.error.HTTPError as e: status, result = e.code, json.load(e)
    assert status == expected, (method, path, status, result)
    return result

g = call('POST','/paper-groups',{'name':'Reading Group'},201)
gid = g['id']
call('POST','/paper-groups',{'name':' Reading Group '},409)
call('POST','/paper-groups',{'name':'   '},400)
project = call('POST','/projects',{'name':'Group integration test'},201)['id']
call('POST',f'/projects/{project}/links',{'item_type':'paper_group','item_id':gid},201)
call('POST',f'/projects/{project}/links',{'item_type':'paper_group','item_id':999999},404)
assert call('GET',f'/projects/{project}')['papers'] == []
def paper(title, group):
    return call('POST','/papers',{'title':title,'collection':group,'enrich':False},201)['created'][0]
p1 = paper('Group test paper one: A long research title for alignment validation', g['name'])
p2 = paper('Group test paper two: Another title with different author metadata', g['name'])
call('PATCH',f'/papers/{p1}',{'authors':'Author One, Author Two, Author Three','venue':'Research conference 2026','published_date':'2026-09-27','my_note':'Keep this personal note'})
call('PATCH',f'/papers/{p2}',{'authors':'Short Author','venue':'arXiv preprint','published_date':'2025-01-01'})
note = call('POST','/notes',{'paper_id':p1,'title':'Group note','content':'Preserve my notes'},201)
assert {p['id'] for p in call('GET',f'/projects/{project}')['papers']} == {p1,p2}
assert project in next(p for p in call('GET','/papers')['papers'] if p['id']==p1)['project_ids']
assert project in [p['id'] for p in call('GET',f'/papers/{p1}')['projects']]
call('PUT','/settings',{'pinned_collections':[g['name']]})
call('PATCH',f'/paper-groups/{gid}',{'name':'Renamed Reading Group'})
assert call('GET',f'/papers/{p1}')['paper']['collection'] == 'Renamed Reading Group'
assert call('GET','/settings')['pinned_collections'] == ['Renamed Reading Group']
assert call('GET',f'/projects/{project}')['paper_groups'][0]['id'] == gid
call('PATCH',f'/papers/{p2}',{'collection':'Exploration Group'})
assert len(call('GET',f'/projects/{project}')['papers']) == 1
assert 'Exploration Group' in [g['name'] for g in call('GET','/paper-groups')['groups']]
call('DELETE',f'/paper-groups/{gid}',expected=409,actor='api')
call('DELETE',f'/paper-groups/{gid}?confirm=1',actor='api')
assert call('GET',f'/projects/{project}')['paper_groups'] == []
assert call('GET',f'/projects/{project}')['papers'] == []
detail=call('GET',f'/papers/{p1}')
assert detail['paper']['collection'] is None and detail['paper']['my_note']=='Keep this personal note'
assert len(detail['notes']) == 1 and detail['notes'][0]['content']=='Preserve my notes'
assert call('GET','/settings')['pinned_collections'] == []
assert call('GET','/export')['schema_version'] >= 5
# Recreate for browser checks; retain a second group and an empty group.
g = call('POST','/paper-groups',{'name':'Reading Group'},201)
call('PATCH',f'/papers/{p1}',{'collection':g['name']})
call('POST',f'/projects/{project}/links',{'item_type':'paper_group','item_id':g['id']},201)
call('POST','/paper-groups',{'name':'Empty Group'},201)
assert next(p for p in call('GET','/projects')['projects'] if p['id']==project)['paper_count'] == 1
print(json.dumps({'result':'PASS: create, duplicate, empty group, dynamic membership, paper queries, rename/pin, delete/confirm, preserved notes, export', 'project':project,'papers':[p1,p2]}))
