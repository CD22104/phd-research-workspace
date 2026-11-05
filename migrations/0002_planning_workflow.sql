-- 触发器采用单行 BEGIN/END，条件用 iif / WHERE，兼容 D1 远程 /query 的 SQL 分句器。
-- 周目标的可重复安排子任务，与每日执行记录分开；旧任务和计时保留原编号。
ALTER TABLE goals ADD COLUMN carried_from INTEGER REFERENCES goals(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX goals_carry_once ON goals(carried_from, week_id) WHERE carried_from IS NOT NULL;

CREATE TABLE goal_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','done')),
  points INTEGER NOT NULL DEFAULT 1 CHECK(points BETWEEN 1 AND 8),
  paper_id INTEGER REFERENCES papers(id) ON DELETE SET NULL,
  paper_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(paper_ids) AND json_type(paper_ids) = 'array'),
  plan_id INTEGER REFERENCES reading_plans(id) ON DELETE SET NULL,
  idea_id INTEGER REFERENCES ideas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  criteria TEXT,
  note TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  carried_from INTEGER REFERENCES goal_tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX goal_tasks_goal ON goal_tasks(goal_id, sort, id);
CREATE UNIQUE INDEX goal_tasks_carry_once ON goal_tasks(carried_from, goal_id) WHERE carried_from IS NOT NULL;
ALTER TABLE tasks ADD COLUMN goal_task_id INTEGER REFERENCES goal_tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN paper_ids TEXT NOT NULL DEFAULT '[]';
UPDATE tasks SET paper_ids = json_array(paper_id) WHERE paper_id IS NOT NULL AND EXISTS(SELECT 1 FROM papers WHERE id = tasks.paper_id);
-- 仅由完成主任务自动取消的未来安排，撤销完成时才自动恢复。
ALTER TABLE tasks ADD COLUMN completion_cancelled INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX tasks_goal_task_day ON tasks(goal_task_id, date) WHERE goal_task_id IS NOT NULL;
CREATE UNIQUE INDEX tasks_goal_task_done_once ON tasks(goal_task_id) WHERE goal_task_id IS NOT NULL AND status = 'done';

-- 进度按唯一主条目计数，不按反复安排次数计数；无子条目的旧目标保持手动进度。
CREATE TRIGGER goal_tasks_insert_progress AFTER INSERT ON goal_tasks BEGIN UPDATE goals SET progress = CAST(ROUND(100.0 * (SELECT COUNT(*) FROM goal_tasks WHERE goal_id = NEW.goal_id AND status = 'done') / (SELECT COUNT(*) FROM goal_tasks WHERE goal_id = NEW.goal_id)) AS INTEGER), status = iif(NOT EXISTS(SELECT 1 FROM goal_tasks WHERE goal_id = NEW.goal_id AND status != 'done'), 'done', 'open'), updated_at = NEW.updated_at WHERE id = NEW.goal_id; END;
CREATE TRIGGER goal_tasks_update_progress AFTER UPDATE OF status ON goal_tasks BEGIN UPDATE goals SET progress = CAST(ROUND(100.0 * (SELECT COUNT(*) FROM goal_tasks WHERE goal_id = NEW.goal_id AND status = 'done') / (SELECT COUNT(*) FROM goal_tasks WHERE goal_id = NEW.goal_id)) AS INTEGER), status = iif(NOT EXISTS(SELECT 1 FROM goal_tasks WHERE goal_id = NEW.goal_id AND status != 'done'), 'done', 'open'), updated_at = NEW.updated_at WHERE id = NEW.goal_id; END;
CREATE TRIGGER goal_tasks_delete_progress AFTER DELETE ON goal_tasks BEGIN UPDATE goals SET progress = COALESCE(CAST(ROUND(100.0 * (SELECT COUNT(*) FROM goal_tasks WHERE goal_id = OLD.goal_id AND status = 'done') / NULLIF((SELECT COUNT(*) FROM goal_tasks WHERE goal_id = OLD.goal_id), 0)) AS INTEGER), 0), status = iif(EXISTS(SELECT 1 FROM goal_tasks WHERE goal_id = OLD.goal_id) AND NOT EXISTS(SELECT 1 FROM goal_tasks WHERE goal_id = OLD.goal_id AND status != 'done'), 'done', 'open'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.goal_id; END;

-- 数据库也拦截完成后重排/重复完成，防止两个客户端同时操作时重复得分。
CREATE TRIGGER tasks_goal_task_insert_guard BEFORE INSERT ON tasks WHEN NEW.goal_task_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'goal_task_completed') WHERE EXISTS(SELECT 1 FROM goal_tasks WHERE id = NEW.goal_task_id AND status = 'done'); SELECT RAISE(ABORT, 'goal_task_goal_mismatch') WHERE NOT EXISTS(SELECT 1 FROM goal_tasks WHERE id = NEW.goal_task_id AND goal_id = NEW.goal_id); END;
CREATE TRIGGER tasks_goal_task_done_guard BEFORE UPDATE OF status ON tasks WHEN NEW.goal_task_id IS NOT NULL AND NEW.status = 'done' AND OLD.status != 'done' BEGIN SELECT RAISE(ABORT, 'goal_task_completed') WHERE EXISTS(SELECT 1 FROM goal_tasks WHERE id = NEW.goal_task_id AND status = 'done'); END;
CREATE TRIGGER tasks_complete_goal_task AFTER UPDATE OF status ON tasks WHEN NEW.goal_task_id IS NOT NULL AND NEW.status = 'done' AND OLD.status != 'done' BEGIN UPDATE goal_tasks SET status = 'done', done_at = NEW.done_at, updated_at = NEW.updated_at WHERE id = NEW.goal_task_id; END;
CREATE TRIGGER tasks_reopen_goal_task AFTER UPDATE OF status ON tasks WHEN NEW.goal_task_id IS NOT NULL AND OLD.status = 'done' AND NEW.status != 'done' BEGIN UPDATE goal_tasks SET status = 'todo', done_at = NULL, updated_at = NEW.updated_at WHERE id = NEW.goal_task_id AND status = 'done'; END;
CREATE TRIGGER tasks_delete_completed_goal_task AFTER DELETE ON tasks WHEN OLD.goal_task_id IS NOT NULL AND OLD.status = 'done' BEGIN UPDATE goal_tasks SET status = 'todo', done_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.goal_task_id AND status = 'done'; END;
CREATE TRIGGER goal_tasks_reopen AFTER UPDATE OF status ON goal_tasks WHEN NEW.status = 'todo' AND OLD.status = 'done' BEGIN UPDATE tasks SET status = 'todo', done_at = NULL, updated_at = NEW.updated_at WHERE goal_task_id = NEW.id AND status = 'done'; UPDATE tasks SET status = 'todo', completion_cancelled = 0, updated_at = NEW.updated_at WHERE goal_task_id = NEW.id AND status = 'dropped' AND completion_cancelled = 1; END;
CREATE TRIGGER goal_tasks_complete_stop_timer AFTER UPDATE OF status ON goal_tasks WHEN NEW.status = 'done' AND OLD.status != 'done' BEGIN UPDATE sessions SET end_at = MAX(start_at, NEW.done_at), updated_at = NEW.updated_at WHERE end_at IS NULL AND task_id IN (SELECT id FROM tasks WHERE goal_task_id = NEW.id); END;
CREATE TRIGGER sessions_goal_task_done_guard BEFORE INSERT ON sessions WHEN NEW.end_at IS NULL AND NEW.task_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'goal_task_completed') WHERE EXISTS(SELECT 1 FROM tasks t JOIN goal_tasks gt ON gt.id = t.goal_task_id WHERE t.id = NEW.task_id AND gt.status = 'done'); END;

-- JSON 多论文列表不具备外键能力，论文删除时一并清理，避免恢复后留下悬空链接。
CREATE TRIGGER papers_delete_task_links BEFORE DELETE ON papers BEGIN UPDATE goal_tasks SET paper_ids = (SELECT json_group_array(value) FROM json_each(goal_tasks.paper_ids) WHERE value != OLD.id), paper_id = iif((SELECT COUNT(*) FROM json_each(goal_tasks.paper_ids) WHERE value != OLD.id) = 1, (SELECT value FROM json_each(goal_tasks.paper_ids) WHERE value != OLD.id LIMIT 1), NULL) WHERE EXISTS(SELECT 1 FROM json_each(goal_tasks.paper_ids) WHERE value = OLD.id) OR paper_id = OLD.id; UPDATE tasks SET paper_ids = (SELECT json_group_array(value) FROM json_each(tasks.paper_ids) WHERE value != OLD.id), paper_id = iif((SELECT COUNT(*) FROM json_each(tasks.paper_ids) WHERE value != OLD.id) = 1, (SELECT value FROM json_each(tasks.paper_ids) WHERE value != OLD.id LIMIT 1), NULL) WHERE EXISTS(SELECT 1 FROM json_each(tasks.paper_ids) WHERE value = OLD.id) OR paper_id = OLD.id; END;
