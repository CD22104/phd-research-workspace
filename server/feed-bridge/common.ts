import { HttpError, all, type Env } from '../db';
export const SCOPE = 'feeds:save feeds:read';
// 允许归档的任务来自数据库：在网站「信息流」里给定时任务填写 ChatGPT 归档编号即可开启
export async function boundTasks(env: Env): Promise<Array<{ task_key: string; task_name: string; aliases: string[] }>> {
  const rows = await all(env.DB, 'SELECT b.task_key, b.task_name, b.aliases FROM feed_task_bindings b JOIN feed_tasks t ON t.id = b.task_id ORDER BY b.task_key');
  return rows.map((r: any) => ({ task_key: r.task_key, task_name: r.task_name, aliases: JSON.parse(r.aliases || '[]') }));
}
export const sec = () => Math.floor(Date.now() / 1000);
export const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export function b64(data: Uint8Array): string { return btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
export async function hash(s: string) { return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
export function origin(env: Env) {
  const value = env.FEED_MCP_ORIGIN;
  if (!value || !env.FEED_OAUTH_SECRET || env.FEED_OAUTH_SECRET.length < 32) throw new HttpError(503, 'integration_not_configured');
  const u = new URL(value);
  if (u.origin !== value || (u.protocol !== 'https:' && !(env.DEV_NO_AUTH === '1' && u.hostname === '127.0.0.1'))) throw new HttpError(503, 'integration_not_configured');
  return value;
}
export const resource = (env: Env) => origin(env) + '/feed-bridge/mcp';
export function reply(body: unknown, status = 200, headers: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: {'Content-Type':'application/json','Cache-Control':'no-store', ...headers} });
}
export async function readText(req: Request, limit = 1_700_000) {
  if (Number(req.headers.get('Content-Length')) > limit) throw new HttpError(413, 'request_too_large');
  const reader = req.body?.getReader(); if (!reader) return '';
  const parts: Uint8Array[] = []; let length = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; length += value.length;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, 'request_too_large'); } parts.push(value); }
  const bytes = new Uint8Array(length); let at = 0; for (const p of parts) { bytes.set(p,at); at += p.length; }
  return new TextDecoder('utf-8', {fatal:true}).decode(bytes);
}
export async function readJson(req: Request, limit?: number) {
  if (!req.headers.get('Content-Type')?.includes('application/json')) throw new HttpError(415, 'expected_application_json');
  try { return JSON.parse(await readText(req,limit)); } catch(e) { if (e instanceof HttpError) throw e; throw new HttpError(400,'invalid_json'); }
}
export function object(value: any): asserts value is Record<string,any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,'expected_object');
}
export function textField(v: any, name: string, max: number) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, 'invalid_' + name);
  return v;
}
async function key(env: Env) { return crypto.subtle.importKey('raw',new TextEncoder().encode(env.FEED_OAUTH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']); }
export async function sign(env: Env, payload: any) {
  const data = b64(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(env),new TextEncoder().encode(data))));
  return data + '.' + sig;
}
export async function unsign(env: Env, token: string): Promise<any> {
  try {
    if (token.length > 8000) return null;
    const [data,sig,extra] = token.split('.'); if (extra || !sig) return null;
    const decode = (v: string) => Uint8Array.from(atob(v.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC',await key(env),decode(sig),new TextEncoder().encode(data))) return null;
    return JSON.parse(new TextDecoder().decode(decode(data)));
  } catch { return null; }
}
export function challenge(env: Env, status = 401) {
  return reply({error:'invalid_token'},status,{'WWW-Authenticate':`Bearer resource_metadata="${origin(env)}/.well-known/oauth-protected-resource/feed-bridge/mcp", scope="${SCOPE}"`});
}
export function checkOrigin(req: Request, env: Env) {
  const o = req.headers.get('Origin');
  if (o && ![origin(env),'https://chatgpt.com'].includes(o)) throw new HttpError(403,'origin_not_allowed');
}
