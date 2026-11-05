-- Add courses and finite recurring series, preserving existing event IDs.
CREATE TABLE schedule_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  kind TEXT NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting', 'course', 'break', 'other')),
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  note TEXT,
  client_key TEXT UNIQUE,
  series_id TEXT,
  recurrence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((all_day = 1 AND start_time IS NULL AND end_time IS NULL) OR
         (all_day = 0 AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
INSERT INTO schedule_events_v2(id,date,title,kind,all_day,start_time,end_time,location,note,client_key,created_at,updated_at)
SELECT id,date,title,kind,all_day,start_time,end_time,location,note,client_key,created_at,updated_at FROM schedule_events;
DROP TABLE schedule_events;
ALTER TABLE schedule_events_v2 RENAME TO schedule_events;
CREATE INDEX schedule_events_date ON schedule_events(date,all_day DESC,start_time,id);
CREATE INDEX schedule_events_series ON schedule_events(series_id,date);
