// p/pr are the paper/project aliases in the caller's query.
export const PROJECT_PAPER = `EXISTS (SELECT 1 FROM project_links pl WHERE pl.project_id = pr.id AND
  ((pl.item_type = 'paper' AND pl.item_id = p.id) OR
   (pl.item_type = 'paper_group' AND pl.item_id IN (SELECT pg.id FROM paper_groups pg WHERE pg.name = p.collection))))`;
