-- Public conference dates live in a reviewed source catalog; this table stores only personal preferences/progress.
CREATE TABLE conference_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conference_key TEXT NOT NULL UNIQUE,
  followed INTEGER NOT NULL DEFAULT 1 CHECK (followed IN (0,1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  completed TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(completed)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1));
