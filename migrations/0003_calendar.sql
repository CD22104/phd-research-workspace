-- 日程仅表示时间安排；会议、休息活动不会创建工时，也不会改变整天的日期类型。
-- date / HH:mm 按应用时区（Asia/Singapore）保存，避免浏览器时区转换。
CREATE TABLE schedule_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  kind TEXT NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting', 'break', 'other')),
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  note TEXT,
  client_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((all_day = 1 AND start_time IS NULL AND end_time IS NULL) OR
         (all_day = 0 AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX schedule_events_date ON schedule_events(date, all_day DESC, start_time, id);
