#!/usr/bin/env python3
"""Restricted feed MCP setup. Uses cf_setup's existing deployment credentials.
Run --prepare, then cf_setup.py --deploy-only, then --open-tool-paths.
Does not change the owner Access policy or any ChatGPT Scheduled Task.
"""
import argparse, json, os, secrets, sys
from pathlib import Path
import cf_setup as cf
CONFIG=Path.home()/'.config'/cf.PROJECT_NAME/'feed-bridge.env'
NAME='Research Workspace feed MCP (OAuth endpoints only)'

def paths(domain):
 return [domain+'/feed-bridge/*',domain+'/.well-known/oauth-authorization-server',domain+'/.well-known/oauth-protected-resource/feed-bridge/mcp']

def prepare():
 if not CONFIG.exists():
  CONFIG.parent.mkdir(parents=True,exist_ok=True)
  fd=os.open(CONFIG,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:f.write('FEED_OAUTH_SECRET='+secrets.token_urlsafe(48)+'\n')
 values=dict(l.split('=',1) for l in CONFIG.read_text().splitlines() if '=' in l)
 if len(values.get('FEED_OAUTH_SECRET',''))<32:raise RuntimeError('invalid local signing key')
 domain=cf.configured_domain(cf.read_conf())
 cf.set_secrets(cf.PROJECT_NAME,{'FEED_OAUTH_SECRET':values['FEED_OAUTH_SECRET'],'FEED_MCP_ORIGIN':'https://'+domain})
 print('Dedicated OAuth signing key configured as Pages Worker Secret; existing key reused on rerun.')

def open_paths():
 domain=cf.configured_domain(cf.read_conf())
 uris=paths(domain)
 body={'name':NAME,'type':'self_hosted','domain':uris[0],
  'destinations':[{'type':'public','uri':p} for p in uris],
  'app_launcher_visible':False,'session_duration':'24h',
  'policies':[{'name':'OAuth protects these machine endpoints','decision':'bypass','precedence':1,'include':[{'everyone':{}}]}]}
 apps=cf.cf('GET','/access/apps') or []
 current=next((a for a in apps if a.get('name')==NAME),None)
 result=cf.cf('PUT' if current else 'POST','/access/apps'+('/'+current['id'] if current else ''),body)
 print(json.dumps({'access_app_id':result['id'],'public_machine_paths':uris,'website_access_policy_changed':False}))

def main():
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--prepare',action='store_true');g.add_argument('--open-tool-paths',action='store_true');a=p.parse_args()
 if not cf.TOKEN or not cf.ACCOUNT:raise RuntimeError('Cloudflare credentials required')
 if a.prepare:prepare()
 else:open_paths()
if __name__=='__main__':
 try:main()
 except (Exception,SystemExit) as e:
  if isinstance(e,SystemExit) and e.code==0:raise
  print('Feed bridge setup failed; no credential values are printed.',file=sys.stderr);sys.exit(1)
