// 附件：挂在 Idea / 论文 / 笔记下的文件。内容按 base64 分块存在 D1，下载同样经过 Access 与后端登录校验。
import type { App } from '../app';
import { json } from '../http';
import { all, bad, conflict, first, idParam, int, notFound, run, stmt, type Ctx } from '../db';
import { body } from './planning';
import { nowIso } from '../lib/time';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 200 * 1024 * 1024;
const CHUNK_CHARS = 900_000; // base64 字符数，远小于 D1 单行 2MB 上限
const OWNERS: Record<string, { table: string; label: string }> = {
  idea: { table: 'ideas', label: 'Idea' },
  paper: { table: 'papers', label: '论文' },
  note: { table: 'notes', label: '笔记' },
};
// 下载时可以保留原类型的文件；其余（HTML、SVG、脚本等）一律按普通二进制下载，避免在本站页面里被执行
const SAFE_TYPES = new Set([
  'application/pdf', 'application/zip', 'application/json', 'text/plain', 'text/csv', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
]);
const BY_EXT: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ppt: 'application/vnd.ms-powerpoint',
  pdf: 'application/pdf', zip: 'application/zip', json: 'application/json', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

const META = 'id, owner_type, owner_id, filename, content_type, size, sha256, note, actor, created_at';

export function fileSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function cleanName(raw: unknown) {
  const name = String(raw ?? '').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!name || name === '.' || name === '..') throw bad('缺少文件名');
  return name;
}

function decodeB64(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw bad('文件内容不是有效的 base64');
  const bin = atob(clean);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ownerExists(ctx: Ctx, type: string, id: number) {
  const o = OWNERS[type];
  if (!o) throw bad('附件只能挂在 Idea、论文或笔记下');
  const row = await first(ctx.db, `SELECT id FROM ${o.table} WHERE id = ?`, id);
  if (!row) throw notFound(o.label);
}

function audit(ctx: Ctx, id: number, op: 'create' | 'delete', meta: Record<string, unknown>) {
  return stmt(ctx.db, 'INSERT INTO changes(entity, entity_id, op, field, old, new, actor, origin, source_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    'attachment', id, op, null, op === 'delete' ? JSON.stringify(meta) : null, op === 'create' ? JSON.stringify(meta) : null, ctx.actor, null, null, nowIso());
}

/** 主记录被删除时一起删掉它的附件（放进主记录删除的同一批语句里） */
export function attachmentCleanup(ctx: Ctx, type: 'idea' | 'paper' | 'note', id: number) {
  return [
    stmt(ctx.db, 'DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE owner_type = ? AND owner_id = ?)', type, id),
    stmt(ctx.db, 'DELETE FROM attachments WHERE owner_type = ? AND owner_id = ?', type, id),
  ];
}

/** 笔记属于论文 / Idea：删除论文时要连带清掉这些笔记的附件 */
export function noteAttachmentCleanup(ctx: Ctx, column: 'paper_id' | 'idea_id', id: number) {
  return [
    stmt(ctx.db, `DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT a.id FROM attachments a JOIN notes n ON n.id = a.owner_id WHERE a.owner_type = 'note' AND n.${column} = ?)`, id),
    stmt(ctx.db, `DELETE FROM attachments WHERE owner_type = 'note' AND owner_id IN (SELECT id FROM notes WHERE ${column} = ?)`, id),
  ];
}

export async function listAttachments(ctx: Ctx, type: string, id: number) {
  return all(ctx.db, `SELECT ${META} FROM attachments WHERE owner_type = ? AND owner_id = ? AND complete = 1 ORDER BY id`, type, id);
}

export async function countAttachments(ctx: Ctx, type: string, id: number) {
  return (await first(ctx.db, 'SELECT COUNT(*) AS n FROM attachments WHERE owner_type = ? AND owner_id = ? AND complete = 1', type, id))?.n || 0;
}

export function registerAttachments(app: App) {
  app.get('/attachments', async (c) => {
    const ctx = c.get('ctx');
    const type = c.req.query('owner_type') || '';
    const id = int(c.req.query('owner_id'));
    if (!OWNERS[type] || !id) throw bad('需要 owner_type（idea / paper / note）和 owner_id');
    return json(c, { attachments: await listAttachments(ctx, type, id), max_bytes: MAX_ATTACHMENT_BYTES });
  });

  app.get('/attachments/:id', async (c) => {
    const ctx = c.get('ctx');
    const a = await first(ctx.db, `SELECT ${META} FROM attachments WHERE id = ? AND complete = 1`, idParam(c.req.param('id')));
    if (!a) throw notFound('附件');
    return json(c, a);
  });

  // 上传：JSON { owner_type, owner_id, filename, content_type?, data_base64, note? }。
  // 同一位置、同名、内容相同的文件重复上传只保存一次（返回 duplicate: true）。
  app.post('/attachments', async (c) => {
    const ctx = c.get('ctx');
    const b = await body(c);
    const type = String(b.owner_type || '');
    const ownerId = int(b.owner_id);
    if (!ownerId) throw bad('缺少 owner_id');
    await ownerExists(ctx, type, ownerId);
    const filename = cleanName(b.filename);
    if (typeof b.data_base64 !== 'string' || !b.data_base64) throw bad('缺少文件内容 data_base64');
    const bytes = decodeB64(b.data_base64);
    if (!bytes.length) throw bad('文件是空的');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw bad(`文件 ${fileSize(bytes.length)}，超过单个附件上限 ${fileSize(MAX_ATTACHMENT_BYTES)}`);
    const hash = await sha256(bytes);
    const dup = await first(ctx.db, `SELECT ${META} FROM attachments WHERE owner_type = ? AND owner_id = ? AND filename = ? AND sha256 = ? AND complete = 1`, type, ownerId, filename, hash);
    if (dup) return json(c, { ...dup, duplicate: true });
    // 清掉之前中断留下的半截上传，再检查总容量
    await run(ctx.db, 'DELETE FROM attachment_chunks WHERE attachment_id IN (SELECT id FROM attachments WHERE complete = 0 AND created_at < ?)', new Date(Date.now() - 10 * 60_000).toISOString());
    await run(ctx.db, 'DELETE FROM attachments WHERE complete = 0 AND created_at < ?', new Date(Date.now() - 10 * 60_000).toISOString());
    const total = (await first(ctx.db, 'SELECT COALESCE(SUM(size), 0) AS n FROM attachments'))?.n || 0;
    if (total + bytes.length > MAX_TOTAL_ATTACHMENT_BYTES) throw bad(`附件总容量将超过 ${fileSize(MAX_TOTAL_ATTACHMENT_BYTES)}，请先删除不需要的附件`);
    const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    const given = String(b.content_type || '').toLowerCase().split(';')[0].trim();
    const contentType = (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(given) && given !== 'application/octet-stream' ? given : '') || BY_EXT[ext] || 'application/octet-stream';
    const data = encodeB64(bytes);
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += CHUNK_CHARS) chunks.push(data.slice(i, i + CHUNK_CHARS));
    const ts = nowIso();
    const r = await run(ctx.db, `INSERT INTO attachments(owner_type, owner_id, filename, content_type, size, sha256, chunk_count, note, complete, actor, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`, type, ownerId, filename, contentType, bytes.length, hash, chunks.length, b.note ? String(b.note).slice(0, 500) : null, ctx.actor, ts, ts);
    const id = Number(r.meta.last_row_id);
    try {
      // 每块单独写入，单条请求不会过大；全部写完才标记为完成，之前不会出现在列表里
      for (let i = 0; i < chunks.length; i++) await run(ctx.db, 'INSERT INTO attachment_chunks(attachment_id, seq, data) VALUES (?,?,?)', id, i, chunks[i]);
      await ctx.db.batch([
        stmt(ctx.db, 'UPDATE attachments SET complete = 1 WHERE id = ?', id),
        audit(ctx, id, 'create', { owner_type: type, owner_id: ownerId, filename, size: bytes.length, sha256: hash }),
      ]);
    } catch (e) {
      await ctx.db.batch([stmt(ctx.db, 'DELETE FROM attachment_chunks WHERE attachment_id = ?', id), stmt(ctx.db, 'DELETE FROM attachments WHERE id = ?', id)]);
      throw e;
    }
    return json(c, await first(ctx.db, `SELECT ${META} FROM attachments WHERE id = ?`, id), 201);
  });

  app.get('/attachments/:id/download', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const a = await first(ctx.db, 'SELECT * FROM attachments WHERE id = ? AND complete = 1', id);
    if (!a) throw notFound('附件');
    const parts = await all(ctx.db, 'SELECT seq, data FROM attachment_chunks WHERE attachment_id = ? ORDER BY seq', id);
    if (parts.length !== a.chunk_count) throw new Error('附件内容不完整');
    const bytes = decodeB64(parts.map((p: any) => p.data).join(''));
    if (bytes.length !== a.size) throw new Error('附件大小与记录不一致');
    const ascii = a.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return new Response(bytes, {
      headers: {
        'Content-Type': SAFE_TYPES.has(a.content_type) ? a.content_type : 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  });

  // 删除：网页直接删除（页面上已确认）；MCP / 服务令牌先返回预览，带 confirm=1 才删除
  app.delete('/attachments/:id', async (c) => {
    const ctx = c.get('ctx');
    const id = idParam(c.req.param('id'));
    const a = await first(ctx.db, `SELECT ${META} FROM attachments WHERE id = ?`, id);
    if (!a) throw notFound('附件');
    const owner = OWNERS[a.owner_type];
    const ownerRow = owner ? await first(ctx.db, `SELECT title FROM ${owner.table} WHERE id = ?`, a.owner_id) : null;
    const preview = { delete_attachment: id, filename: a.filename, size: fileSize(a.size), owner: `${owner?.label || a.owner_type} #${a.owner_id}${ownerRow?.title ? ` ${ownerRow.title}` : ''}` };
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除附件需要确认：请查看预览后带 confirm=1 再提交', { needs_confirm: true, preview });
    await ctx.db.batch([
      stmt(ctx.db, 'DELETE FROM attachment_chunks WHERE attachment_id = ?', id),
      stmt(ctx.db, 'DELETE FROM attachments WHERE id = ?', id),
      audit(ctx, id, 'delete', a),
    ]);
    return json(c, { ok: true, deleted: preview });
  });
}
