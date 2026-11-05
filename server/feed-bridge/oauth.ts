import { authenticate } from '../auth';
import { first, run, stmt, HttpError, type Env } from '../db';
import { SCOPE, sec, random, hash, b64, origin, resource, reply, readJson, readText, sign, unsign, object, boundTasks } from './common';
const TOKEN_TTL = 3600, REFRESH_TTL = 30*86400, GRANT_TTL = 365*86400;
const credentialHash = (env: Env, token: string) => hash(env.FEED_OAUTH_SECRET+':credential:'+token);
const failure = (error: string, status=400) => reply({error},status);
export function metadata(env: Env) {
  const o = origin(env);
  return {issuer:o,authorization_endpoint:o+'/feed-connect/authorize',token_endpoint:o+'/feed-bridge/token',
    registration_endpoint:o+'/feed-bridge/register',revocation_endpoint:o+'/feed-bridge/revoke',
    response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
    token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:SCOPE.split(' '),
    authorization_response_iss_parameter_supported:true};
}
export function resourceMetadata(env: Env) {
  return {resource:resource(env),authorization_servers:[origin(env)],scopes_supported:SCOPE.split(' '),bearer_methods_supported:['header'],resource_name:'Research Workspace 信息流归档'};
}
function redirectAllowed(value: any) {
  // Exact stable ChatGPT callback. Add a new URI only after verifying it in the connector management page.
  return value === 'https://chatgpt.com/connector_platform_oauth_redirect';
}
async function client(env: Env, id: string | null) {
  if (!id) return null;
  const value = await unsign(env,id);
  return value?.kind === 'feed-client' && redirectAllowed(value.redirect_uri) ? value : null;
}
export async function register(req: Request, env: Env) {
  const input = await readJson(req,8192); object(input);
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length !== 1 || !redirectAllowed(input.redirect_uris[0])) return failure('invalid_redirect_uri');
  if (input.token_endpoint_auth_method && input.token_endpoint_auth_method !== 'none') return failure('invalid_client_metadata');
  if (input.grant_types && (!Array.isArray(input.grant_types) || input.grant_types.some((g:any)=>!['authorization_code','refresh_token'].includes(g)))) return failure('invalid_client_metadata');
  if (input.response_types && JSON.stringify(input.response_types) !== '["code"]') return failure('invalid_client_metadata');
  if (input.scope && input.scope.split(' ').some((s:string)=>!SCOPE.split(' ').includes(s))) return failure('invalid_scope');
  const name = typeof input.client_name === 'string' ? input.client_name.slice(0,120) : 'ChatGPT';
  const id = await sign(env,{kind:'feed-client',nonce:random(),redirect_uri:input.redirect_uris[0],name});
  return reply({client_id:id,client_id_issued_at:sec(),client_name:name,redirect_uris:input.redirect_uris,
    token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:SCOPE},201);
}
function html(s: string) { return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
async function owner(req: Request, env: Env) {
  const who = await authenticate(req,env);
  // Existing broad service tokens must never approve this integration on behalf of the owner.
  if (!who?.email || who.service) throw new HttpError(403,'owner_login_required');
  return hash(who.email.toLowerCase());
}
const cookieName = 'honey_feed_consent';
function cookieHeader(env: Env, value: string, age: number) {
  return `${cookieName}=${value}; Path=/feed-connect; HttpOnly; SameSite=Lax; Max-Age=${age}${origin(env).startsWith('https:') ? '; Secure':''}`;
}
export async function authorize(req: Request, env: Env) {
  const ownerHash = await owner(req,env), o = origin(env);
  if (req.method === 'GET') {
    const p = new URL(req.url).searchParams;
    const id = p.get('client_id'), c = await client(env,id);
    if (!c || p.get('redirect_uri') !== c.redirect_uri) return failure('invalid_client_or_redirect');
    const redirectError = (error: string) => {
      const target = new URL(c.redirect_uri);target.searchParams.set('error',error);target.searchParams.set('iss',o);
      if (p.get('state')) target.searchParams.set('state',p.get('state')!);
      return new Response(null,{status:303,headers:{Location:target.href,'Cache-Control':'no-store'}});
    };
    if (p.get('response_type') !== 'code') return redirectError('unsupported_response_type');
    if (p.getAll('resource').length !== 1 || p.get('resource') !== resource(env)) return redirectError('invalid_target');
    if (p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge') || '')) return redirectError('invalid_request');
    const scopes = (p.get('scope') || SCOPE).split(' ');
    if (scopes.some(s=>!SCOPE.split(' ').includes(s)) || !scopes.length) return redirectError('invalid_scope');
    if ((p.get('state')?.length || 0) > 512) return failure('invalid_state');
    const csrf = random();
    const payload = {kind:'feed-consent',client_id:id,owner_hash:ownerHash,csrf,exp:sec()+600,
      redirect_uri:c.redirect_uri,state:p.get('state') || '',challenge:p.get('code_challenge'),scope:scopes.join(' '),resource:resource(env)};
    const bound = await boundTasks(env);
    const taskList = bound.length ? `允许为${bound.map((b) => '「' + html(b.task_name) + '」').join('')}保存报告并查询归档回执。修订保留旧版。`
      : '网站「信息流」里还没有填写 ChatGPT 归档编号的任务；授权后也无法保存报告。';
    const document = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>连接 Research Workspace 信息流</title>
      <body><main><h1>连接 Research Workspace 信息流</h1><p>客户端：${html(c.name)}</p>
      <p>${taskList}</p>
      <p>此授权不能读取研究笔记、管理论文、修改计划或删除报告。最长一年有效，可在此页撤销。</p>
      <form method="post" action="/feed-connect/authorize"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="allow">允许连接</button> <button name="decision" value="deny">取消</button></form>
      <p><a href="/feed-connect/connections">查看与撤销已连接客户端</a></p></main></body></html>`;
    // Preserve same-origin POST Origin without sending query parameters in Referer.
    // Chromium also applies form-action to the redirect target; permit only the validated callback.
    return new Response(document,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Set-Cookie':cookieHeader(env,await sign(env,payload),600),'Content-Security-Policy':`default-src 'none'; form-action 'self' ${c.redirect_uri}; frame-ancestors 'none'; base-uri 'none'`,'Referrer-Policy':'strict-origin'}});
  }
  if (req.method !== 'POST') return failure('method_not_allowed',405);
  if (req.headers.get('Origin') !== o) return failure('invalid_origin',403);
  const token = (req.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const pending = token ? await unsign(env,token) : null;
  const form = new URLSearchParams(await readText(req,8192));
  if (!pending || pending.kind !== 'feed-consent' || pending.exp <= sec() || pending.owner_hash !== ownerHash || form.get('csrf') !== pending.csrf) return failure('invalid_consent',403);
  const c = await client(env,pending.client_id);if (!c || c.redirect_uri !== pending.redirect_uri) return failure('invalid_client');
  const target = new URL(c.redirect_uri);target.searchParams.set('iss',o);target.searchParams.set('state',pending.state);
  if (form.get('decision') !== 'allow') target.searchParams.set('error','access_denied');
  else {
    const code = random(), id = await hash(pending.csrf), now = sec();
    // The deterministic grant ID also prevents replaying a consent form.
    await env.DB.batch([
      stmt(env.DB,'INSERT INTO feed_oauth_grants(id,client_id,owner_hash,scope,resource,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',id,pending.client_id,ownerHash,pending.scope,pending.resource,now+GRANT_TTL,now),
      stmt(env.DB,"INSERT INTO feed_oauth_tokens(hash,grant_id,kind,expires_at,redirect_uri,challenge) VALUES(?,?,'code',?,?,?)",await credentialHash(env,code),id,now+300,pending.redirect_uri,pending.challenge)
    ]);
    target.searchParams.set('code',code);
  }
  return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'no-store','Set-Cookie':cookieHeader(env,'',0),'Referrer-Policy':'no-referrer'}});
}
async function lookup(env: Env, token: string) {
  if (!token || token.length > 1024) return null;
  return first(env.DB,`SELECT t.*,g.client_id,g.owner_hash,g.scope,g.resource,g.revoked_at,g.expires_at AS grant_expiry
    FROM feed_oauth_tokens t JOIN feed_oauth_grants g ON g.id=t.grant_id WHERE t.hash=?`,await credentialHash(env,token));
}
async function validGrant(env: Env, t: any) {
  if (!t || t.revoked_at || t.grant_expiry <= sec() || t.resource !== resource(env)) return false;
  const owners = (env.OWNER_EMAILS || (env.DEV_NO_AUTH === '1' ? 'dev@local':'')).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  return (await Promise.all(owners.map(hash))).includes(t.owner_hash);
}
export async function access(req: Request, env: Env) {
  const h = req.headers.get('Authorization') || ''; if (!h.startsWith('Bearer ')) return null;
  const t = await lookup(env,h.slice(7));
  return t?.kind === 'access' && t.expires_at > sec() && await validGrant(env,t) ? t : null;
}
export async function token(req: Request, env: Env) {
  if (!req.headers.get('Content-Type')?.includes('application/x-www-form-urlencoded')) return failure('invalid_request');
  const p = new URLSearchParams(await readText(req,16384)), id = p.get('client_id');
  if (!await client(env,id)) return failure('invalid_client',401);
  if (p.getAll('resource').length !== 1 || p.get('resource') !== resource(env)) return failure('invalid_target');
  const grantType = p.get('grant_type');
  if (!['authorization_code','refresh_token'].includes(grantType || '')) return failure('unsupported_grant_type');
  const t = await lookup(env,p.get(grantType === 'authorization_code' ? 'code':'refresh_token') || '');
  if (!t || t.client_id !== id || t.kind !== (grantType === 'authorization_code' ? 'code':'refresh') || !await validGrant(env,t) || t.expires_at <= sec()) return failure('invalid_grant');
  if (t.consumed_at) {
    if (t.kind === 'refresh') await run(env.DB,'UPDATE feed_oauth_grants SET revoked_at=? WHERE id=?',sec(),t.grant_id);
    return failure('invalid_grant');
  }
  if (p.get('scope') && p.get('scope') !== t.scope) return failure('invalid_scope');
  if (t.kind === 'code') {
    const verifier = p.get('code_verifier') || '';
    if (p.get('redirect_uri') !== t.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || await hash(verifier) !== t.challenge) return failure('invalid_grant');
  }
  const now=sec(), a=random(), r=random();
  // Atomic single-use exchange. Only the winning INSERTs can mint tokens.
  const results = await env.DB.batch([
    stmt(env.DB,`INSERT INTO feed_oauth_tokens(hash,grant_id,kind,expires_at) SELECT ?,grant_id,'access',? FROM feed_oauth_tokens WHERE hash=? AND consumed_at IS NULL`,await credentialHash(env,a),Math.min(now+TOKEN_TTL,t.grant_expiry),t.hash),
    stmt(env.DB,`INSERT INTO feed_oauth_tokens(hash,grant_id,kind,expires_at) SELECT ?,grant_id,'refresh',? FROM feed_oauth_tokens WHERE hash=? AND consumed_at IS NULL`,await credentialHash(env,r),Math.min(now+REFRESH_TTL,t.grant_expiry),t.hash),
    stmt(env.DB,'UPDATE feed_oauth_tokens SET consumed_at=? WHERE hash=? AND consumed_at IS NULL',now,t.hash)
  ]);
  if (results[0].meta.changes !== 1) return failure('invalid_grant');
  return reply({access_token:a,token_type:'Bearer',expires_in:Math.min(TOKEN_TTL,t.grant_expiry-now),refresh_token:r,scope:t.scope});
}
export async function revoke(req: Request, env: Env) {
  const p = new URLSearchParams(await readText(req,16384));
  if (!await client(env,p.get('client_id'))) return failure('invalid_client',401);
  const t = await lookup(env,p.get('token') || '');
  if (t?.client_id === p.get('client_id')) await run(env.DB,'UPDATE feed_oauth_grants SET revoked_at=? WHERE id=?',sec(),t.grant_id);
  return reply({});
}
export async function connections(req: Request, env: Env) {
  const ownerHash = await owner(req,env);
  if (req.method === 'POST') {
    if (req.headers.get('Origin') !== origin(env) || req.headers.get('X-Requested-With') !== 'honey-feed-connect') return failure('invalid_origin',403);
    const p = await readJson(req,4096);object(p);
    await run(env.DB,'UPDATE feed_oauth_grants SET revoked_at=? WHERE id=? AND owner_hash=?',sec(),p.grant_id,ownerHash);
    return reply({revoked:true});
  }
  const rows = await env.DB.prepare('SELECT id,client_id,created_at,expires_at,revoked_at FROM feed_oauth_grants WHERE owner_hash=? ORDER BY created_at DESC LIMIT 100').bind(ownerHash).all<any>();
  const safe = await Promise.all(rows.results.map(async row=>({grant_id:row.id,client_name:(await client(env,row.client_id))?.name || 'ChatGPT',created_at:row.created_at,expires_at:row.expires_at,revoked_at:row.revoked_at})));
  // Private maintenance endpoint; no bearer credential is returned.
  return reply({connections:safe,revoke_method:'POST JSON {grant_id} with same-origin and X-Requested-With: honey-feed-connect'});
}
