// Cloudflare Access 之后的第二道校验：验证 Access 签发的 JWT，并只放行设定的邮箱 / 服务令牌。
// 没有配置 ACCESS_AUD 时默认拒绝（本地开发用 DEV_NO_AUTH=1 显式放开）。
import type { Env } from './db';

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let certCache: { at: number; keys: Jwk[]; domain: string } | null = null;

async function getKeys(domain: string): Promise<Jwk[]> {
  if (certCache && certCache.domain === domain && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const r = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`无法获取 Access 公钥：${r.status}`);
  const j: any = await r.json();
  certCache = { at: Date.now(), keys: j.keys || [], domain };
  return certCache.keys;
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function cookie(req: Request, name: string): string | undefined {
  const c = req.headers.get('Cookie') || '';
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

export interface Identity { email?: string; service?: string }

export async function authenticate(req: Request, env: Env): Promise<Identity | null> {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    return env.DEV_NO_AUTH === '1' ? { email: 'dev@local' } : null;
  }
  const token = req.headers.get('Cf-Access-Jwt-Assertion') || cookie(req, 'CF_Authorization');
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  let header: any;
  let payload: any;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  const keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;

  const owners = (env.OWNER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const services = (env.SERVICE_TOKEN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (payload.email && owners.includes(String(payload.email).toLowerCase())) return { email: payload.email };
  if (payload.common_name && services.includes(payload.common_name)) return { service: payload.common_name };
  return null;
}
