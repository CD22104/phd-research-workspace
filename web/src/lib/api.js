// 调用后端接口：统一带上防伪请求头、来源标记和错误处理
export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, path, body, opts = {}) {
  const headers = { 'X-Requested-With': 'research-workspace', 'X-Actor': 'web' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(0, '网络连接失败，请检查网络后重试');
  }
  if (res.status === 401 || res.redirected) throw new ApiError(401, '登录已过期，请刷新页面重新登录');
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(res.status, `服务器返回了无法识别的内容（${res.status}）`);
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `请求失败（${res.status}）`, data.data);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}, o) => request('POST', p, b, o),
  put: (p, b = {}) => request('PUT', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export function uuid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
