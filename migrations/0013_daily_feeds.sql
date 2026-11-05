-- Reading completion is a manual decision, independent of opening or triaging a report.
ALTER TABLE feed_items ADD COLUMN reviewed_at TEXT;
ALTER TABLE feed_tasks ADD COLUMN expected_time TEXT;
ALTER TABLE feed_tasks ADD COLUMN expected_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE feed_tasks ADD COLUMN expected_days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]';
ALTER TABLE feed_runs ADD COLUMN report_date TEXT;
CREATE INDEX idx_feed_runs_report_date ON feed_runs(task_id,report_date,id);


