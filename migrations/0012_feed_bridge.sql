-- Add-only integration. Tasks are bound to an archive key from the Feeds page (no tasks are preset).
CREATE TABLE feed_task_bindings (
 task_key TEXT PRIMARY KEY, task_id INTEGER NOT NULL UNIQUE REFERENCES feed_tasks(id),
 task_name TEXT NOT NULL, aliases TEXT NOT NULL
);
CREATE TABLE feed_report_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 task_key TEXT NOT NULL REFERENCES feed_task_bindings(task_key), report_date TEXT NOT NULL,
 logical_run_key TEXT NOT NULL, content_hash TEXT NOT NULL, payload_hash TEXT NOT NULL,
 version INTEGER NOT NULL, run_id INTEGER NOT NULL UNIQUE REFERENCES feed_runs(id),
 report_id INTEGER NOT NULL UNIQUE REFERENCES feed_items(id), content_status TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(task_key,report_date,logical_run_key,payload_hash),
 UNIQUE(task_key,report_date,logical_run_key,version)
);
-- Auth state is intentionally excluded from the personal JSON export.
-- Store only hashes of bearer credentials; the signing key is a Worker Secret.
CREATE TABLE feed_oauth_grants (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, owner_hash TEXT NOT NULL,
 scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL,
 revoked_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE feed_oauth_tokens (
 hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES feed_oauth_grants(id),
 kind TEXT NOT NULL CHECK(kind IN ('code','access','refresh')), expires_at INTEGER NOT NULL,
 consumed_at INTEGER, redirect_uri TEXT, challenge TEXT
);
CREATE INDEX feed_oauth_tokens_grant ON feed_oauth_tokens(grant_id);
