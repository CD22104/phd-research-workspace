#!/usr/bin/env python3
"""Only run against an isolated localhost dev DB, never production."""
import uuid
RUN=uuid.uuid4().hex
import base64, concurrent.futures, hashlib, http.cookiejar, json, re, unittest, urllib.error, urllib.parse, urllib.request
BASE='http://127.0.0.1:8807'
CALLBACK='https://chatgpt.com/connector_platform_oauth_redirect'
RESOURCE=BASE+'/feed-bridge/mcp'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args): return None

def request(path, data=None, token=None, method=None, headers=None, raw=False):
 h={'User-Agent':'honey-feed-tests/1.0',**(headers or {})}
 if token: h['Authorization']='Bearer '+token
 if data is not None and not isinstance(data,bytes):data=json.dumps(data).encode();h['Content-Type']='application/json'
 req=urllib.request.Request(BASE+path,data=data,headers=h,method=method)
 try:r=urllib.request.build_opener(NoRedirect()).open(req,timeout=20)
 except urllib.error.HTTPError as e:r=e
 body=r.read();result=body.decode() if raw else json.loads(body) if body else None
 return r.code,result,r.headers

def form(path,data,**kwargs):return request(path,urllib.parse.urlencode(data).encode(),headers={'Content-Type':'application/x-www-form-urlencoded',**kwargs.pop('headers',{})},**kwargs)
def sha(v):return base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip('=')
def register():
 code,body,_=request('/feed-bridge/register',{'client_name':'Isolated integration test','redirect_uris':[CALLBACK],'token_endpoint_auth_method':'none'})
 assert code==201,(code,body)
 return body['client_id']
def authorize(client,scope='feeds:save feeds:read'):
 verifier='p'*64
 params={'client_id':client,'response_type':'code','redirect_uri':CALLBACK,'resource':RESOURCE,'scope':scope,'state':'test-state','code_challenge_method':'S256','code_challenge':sha(verifier)}
 url='/feed-connect/authorize?'+urllib.parse.urlencode(params)
 code,page,h=request(url,raw=True);assert code==200,(code,page)
 csrf=re.search('name="csrf" value="([^"]+)"',page)[1]
 code,body,done=form(url,{'csrf':csrf,'decision':'allow'},headers={'Origin':BASE,'Cookie':h['Set-Cookie'].split(';')[0]})
 assert code==302,(code,body)
 q=urllib.parse.parse_qs(urllib.parse.urlsplit(done['Location']).query)
 assert q['iss']==[BASE] and q['state']==['test-state']
 return q['code'][0],verifier

def exchange(client,code,verifier,**overrides):
 return form('/feed-bridge/token',{'client_id':client,'grant_type':'authorization_code','code':code,'code_verifier':verifier,'redirect_uri':CALLBACK,'resource':RESOURCE,**overrides})
def connect(scope='feeds:save feeds:read'):
 client=register();code,v=authorize(client,scope);status,body,_=exchange(client,code,v);assert status==200,(status,body)
 return client,body

def rpc(token,name,args):
 status,b,_=request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}},token)
 assert status==200,(status,b)
 return b['result']

class FeedBridge(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.client,cls.tokens=connect();cls.access=cls.tokens['access_token']
 def report(self,key='base'):
  return {'task_key':'daily_news','report_date':'2026-09-29','run_key':RUN+key,'title':'无隐私接口测试','markdown':'# 完整正文\n\n中文、English、公式 $x+y$\n\n末尾 END\n','content_status':'complete'}
 def test_01_discovery_and_protocol(self):
  s,b,h=request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'initialize'});self.assertEqual(s,401);self.assertIn('resource_metadata',h['WWW-Authenticate'])
  for path in ['/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource/feed-bridge/mcp']:
   self.assertEqual(request(path)[0],200)
  s,b,_=request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25'}},self.access);self.assertEqual(b['result']['protocolVersion'],'2025-11-25')
  s,b,_=request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':2,'method':'tools/list'},self.access);self.assertEqual([t['name'] for t in b['result']['tools']],['save_feed_result','get_feed_result'])
  self.assertEqual(request('/feed-bridge/mcp',{'jsonrpc':'2.0','method':'notifications/initialized'},self.access)[0],202)
  self.assertEqual(request('/feed-bridge/mcp',token=self.access)[0],405)
  self.assertEqual(request('/feed-bridge/mcp',{'a':1},self.access,headers={'Origin':'https://evil.example'})[0],403)
  self.assertEqual(request('/feed-bridge/api/export',token=self.access)[0],404)
 def test_02_replay_revision_and_full_body(self):
  data=self.report('versions');a=rpc(self.access,'save_feed_result',data)['structuredContent'];b=rpc(self.access,'save_feed_result',data)['structuredContent']
  self.assertTrue(a['created']);self.assertTrue(b['duplicate']);self.assertEqual(a['report_id'],b['report_id']);self.assertEqual(a['content_hash'],sha(data['markdown']))
  data['markdown']+='\n修订第二版';c=rpc(self.access,'save_feed_result',data)['structuredContent'];self.assertEqual(c['version'],2);self.assertNotEqual(c['report_id'],a['report_id'])
  get=rpc(self.access,'get_feed_result',{'task_key':'daily_news','report_date':data['report_date'],'run_key':RUN+'versions'})['structuredContent'];self.assertEqual(len(get['reports']),2);self.assertNotIn('markdown',get['reports'][0])
  status,items,_=request('/api/feeds/items/'+str(c['report_id']));self.assertEqual(status,200);self.assertEqual(items['item']['content'],data['markdown'])
  status,old,_=request('/api/feeds/items/'+str(a['report_id']));self.assertEqual(old['item']['content'],self.report()['markdown'])
 def test_03_concurrent_dedupe(self):
  data=self.report('parallel')
  with concurrent.futures.ThreadPoolExecutor(8) as pool:rows=list(pool.map(lambda _:rpc(self.access,'save_feed_result',data)['structuredContent'],range(8)))
  self.assertEqual(len({r['report_id'] for r in rows}),1);self.assertEqual(sum(r['created'] for r in rows),1)
 def test_04_mapping_and_validation(self):
  for name in ['领域前沿','研究简报（旧名）','研究简报']:
   data=self.report('aliases');data.pop('task_key');data['task_name']=name
   self.assertFalse(rpc(self.access,'save_feed_result',data)['isError'])
  invalid=[{'task_key':'other'},{'task_name':'领域前沿'},{'report_date':'2026-02-30'},{'content_status':'invented'},{'markdown':'  '},{'markdown':'a'*400001},{'task_id':1},{'source_url':'javascript:alert(1)'},{'source_url':'https://user:secret@example.com/'}]
  for patch in invalid:
   with self.subTest(patch=list(patch)):self.assertTrue(rpc(self.access,'save_feed_result',{**self.report(),**patch})['isError'])
  result=rpc(self.access,'get_feed_result',{'task_key':'field_frontier','report_id':1})['structuredContent'];self.assertFalse(result['found'])
 def test_05_oauth_pkce_csrf_resource_and_single_use(self):
  client=register();code,v=authorize(client)
  self.assertEqual(exchange(client,code,'wrong'*12)[0],400)
  self.assertEqual(exchange(client,code,v,resource='https://evil.example')[0],400)
  self.assertEqual(exchange(client,code,v,redirect_uri='https://evil.example')[0],400)
  self.assertEqual(exchange(register(),code,v)[0],400)
  self.assertEqual(exchange(client,code,v)[0],200)
  self.assertEqual(exchange(client,code,v)[0],400)
  self.assertEqual(form('/feed-connect/authorize',{'csrf':'bad','decision':'allow'},headers={'Origin':BASE})[0],403)
  self.assertEqual(request('/feed-bridge/register',{'redirect_uris':['https://evil.example']})[0],400)
 def test_06_refresh_rotation_and_revoke(self):
  client,t=connect();p={'client_id':client,'grant_type':'refresh_token','refresh_token':t['refresh_token'],'resource':RESOURCE}
  s,new,_=form('/feed-bridge/token',p);self.assertEqual(s,200)
  self.assertEqual(request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'ping'},new['access_token'])[0],200)
  self.assertEqual(form('/feed-bridge/token',p)[0],400)
  self.assertEqual(request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'ping'},new['access_token'])[0],401)
  client,t=connect();self.assertEqual(form('/feed-bridge/revoke',{'client_id':client,'token':t['refresh_token']})[0],200)
  self.assertEqual(request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'ping'},t['access_token'])[0],401)
 def test_07_scope_and_rest_compatibility(self):
  client,t=connect('feeds:read');result=rpc(t['access_token'],'get_feed_result',{'task_key':'daily_news','report_date':'2026-09-29'});self.assertFalse(result['isError'])
  self.assertEqual(request('/feed-bridge/reports',self.report('scope-denied'),t['access_token'])[0],403)
  s,b,_=request('/feed-bridge/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'save_feed_result','arguments':self.report()}},t['access_token']);self.assertIn('error',b)
  s,b,_=request('/feed-bridge/reports',self.report('rest'),self.access);self.assertEqual(s,201)
  self.assertEqual(request('/feed-bridge/reports',self.report('rest'),self.access)[0],200)
  p={'task_id':1,'run_key':RUN+'legacy-compatible','items':[{'title':'旧上传通道','content':'不调用模型','date':'2026-09-29'}]}
  self.assertEqual(request('/api/feeds/runs',p,headers={'X-Requested-With':'test'})[0],201)
  self.assertTrue(request('/api/feeds/runs',p,headers={'X-Requested-With':'test'})[1]['replayed'])
 def test_08_export_excludes_auth(self):
  s,b,_=request('/api/export');self.assertEqual(b['schema_version'],14);self.assertIn('feed_report_versions',b['tables']);self.assertNotIn('feed_oauth_tokens',b['tables']);self.assertNotIn('feed_oauth_grants',b['tables'])

if __name__=='__main__':unittest.main(verbosity=2)
