-- Pauses close a focus segment. Statistics keep counting only sessions, never pause gaps.
ALTER TABLE sessions ADD COLUMN timer_key TEXT;
CREATE INDEX idx_sessions_timer_key ON sessions(timer_key);
CREATE TABLE timer_pauses (id INTEGER PRIMARY KEY CHECK(id = 1), session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TRIGGER clear_task_pause AFTER UPDATE OF status ON tasks WHEN NEW.status != 'todo' BEGIN DELETE FROM timer_pauses WHERE session_id IN (SELECT id FROM sessions WHERE task_id = NEW.id); END;
CREATE TRIGGER clear_goal_task_pause AFTER UPDATE OF status ON goal_tasks WHEN NEW.status = 'done' BEGIN DELETE FROM timer_pauses WHERE session_id IN (SELECT s.id FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE t.goal_task_id = NEW.id); END;
CREATE TABLE background_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, label TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(end_at IS NULL OR end_at >= start_at));
CREATE INDEX idx_background_sessions_time ON background_sessions(start_at, end_at);
CREATE UNIQUE INDEX idx_background_one_per_task ON background_sessions(task_id) WHERE end_at IS NULL AND task_id IS NOT NULL;
