import type { App } from '../app';
import { all, bad, conflict, first, idParam, insert, notFound, remove, stmt } from '../db';
import { body } from './planning';
import { json } from '../http';
import { nowIso } from '../lib/time';

function nameOf(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw bad('论文组名称需要 1–200 个字符');
  return value.trim();
}
export function registerPaperGroups(app: App) {
  app.get('/paper-groups', async c => json(c, { groups: await all(c.get('ctx').db, `SELECT pg.*,
    (SELECT COUNT(*) FROM papers p WHERE p.collection = pg.name) AS paper_count,
    (SELECT COUNT(*) FROM project_links pl WHERE pl.item_type = 'paper_group' AND pl.item_id = pg.id) AS project_count
    FROM paper_groups pg ORDER BY name`) }));
  app.post('/paper-groups', async c => {
    const ctx = c.get('ctx'), name = nameOf((await body(c)).name);
    if (await first(ctx.db, 'SELECT id FROM paper_groups WHERE name = ?', name)) throw conflict('已有同名论文组');
    const id = await insert(ctx, 'paper_groups', { name });
    return json(c, await first(ctx.db, 'SELECT * FROM paper_groups WHERE id = ?', id), 201);
  });
  app.patch('/paper-groups/:id', async c => {
    const ctx = c.get('ctx'), id = idParam(c.req.param('id')), name = nameOf((await body(c)).name);
    const old = await first(ctx.db, 'SELECT * FROM paper_groups WHERE id = ?', id);
    if (!old) throw notFound('论文组');
    if (old.name === name) return json(c, old);
    if (await first(ctx.db, 'SELECT id FROM paper_groups WHERE name = ?', name)) throw conflict('已有同名论文组');
    const ts = nowIso();
    // One atomic batch: group identity, paper membership, audit and pinned labels.
    await ctx.db.batch([
      stmt(ctx.db, 'UPDATE paper_groups SET name = ?, updated_at = ? WHERE id = ?', name, ts, id),
      stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,created_at) SELECT 'paper',id,'update','collection',collection,?,?,? FROM papers WHERE collection = ?`, name, ctx.actor, ts, old.name),
      stmt(ctx.db, 'UPDATE papers SET collection = ?, updated_at = ? WHERE collection = ?', name, ts, old.name),
      stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,created_at) VALUES('paper_group',?,'update','name',?,?,?,?)`, id, old.name, name, ctx.actor, ts),
      stmt(ctx.db, `UPDATE settings SET value = (SELECT json_group_array(iif(value = ?, ?, value)) FROM json_each(settings.value)) WHERE key = 'pinned_collections'`, old.name, name),
    ]);
    return json(c, await first(ctx.db, 'SELECT * FROM paper_groups WHERE id = ?', id));
  });
  app.delete('/paper-groups/:id', async c => {
    const ctx = c.get('ctx'), id = idParam(c.req.param('id'));
    if (ctx.actor !== 'web' && c.req.query('confirm') !== '1') throw conflict('删除论文组需要确认；论文保留并移至未分组', { needs_confirm: true });
    const group = await first(ctx.db, 'SELECT * FROM paper_groups WHERE id = ?', id);
    if (!group) throw notFound('论文组');
    const ts = nowIso();
    await remove(ctx, 'paper_groups', id, [
      stmt(ctx.db, `INSERT INTO changes(entity,entity_id,op,field,old,new,actor,created_at) SELECT 'paper',id,'update','collection',collection,NULL,?,? FROM papers WHERE collection = ?`, ctx.actor, ts, group.name),
      stmt(ctx.db, 'UPDATE papers SET collection = NULL, updated_at = ? WHERE collection = ?', ts, group.name),
      stmt(ctx.db, `DELETE FROM project_links WHERE item_type = 'paper_group' AND item_id = ?`, id),
      stmt(ctx.db, `UPDATE settings SET value = (SELECT json_group_array(value) FROM json_each(settings.value) WHERE value != ?) WHERE key = 'pinned_collections'`, group.name),
    ]);
    return json(c, { ok: true });
  });
}
