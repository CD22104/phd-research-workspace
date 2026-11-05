-- Preserve old direct links as compatibility data. New UI binds groups only.
-- Stable groups keep projects attached when a group is renamed.
CREATE TABLE paper_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0 AND length(name) <= 200),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO paper_groups(name, created_at, updated_at)
SELECT DISTINCT collection, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM papers WHERE collection IS NOT NULL AND trim(collection) != '';
CREATE INDEX papers_collection ON papers(collection);
-- Imports and existing paper editors also register new groups.
CREATE TRIGGER papers_register_group_insert AFTER INSERT ON papers WHEN NEW.collection IS NOT NULL AND trim(NEW.collection) != '' BEGIN INSERT OR IGNORE INTO paper_groups(name,created_at,updated_at) VALUES(NEW.collection,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER papers_register_group_update AFTER UPDATE OF collection ON papers WHEN NEW.collection IS NOT NULL AND trim(NEW.collection) != '' BEGIN INSERT OR IGNORE INTO paper_groups(name,created_at,updated_at) VALUES(NEW.collection,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
