-- Planned local-clock slots are separate from measured focus/background sessions.
CREATE TABLE task_time_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  start_minute INTEGER NOT NULL CHECK(start_minute >= 0 AND start_minute < 1440),
  end_minute INTEGER NOT NULL CHECK(end_minute > start_minute AND end_minute <= 1440),
  client_key TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, start_minute, end_minute)
);
CREATE INDEX task_time_blocks_task ON task_time_blocks(task_id, start_minute);
