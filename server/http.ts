// 统一的 JSON 响应（绕开 Hono 的 RPC 类型推断，避免类型检查过深）
export function json(c: { json: (...a: any[]) => Response }, data: unknown, status = 200): Response {
  return c.json(data as any, status as any);
}
