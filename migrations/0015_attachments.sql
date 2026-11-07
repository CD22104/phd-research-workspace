-- 附件：挂在 Idea / 论文 / 笔记下的文件（Excel、PDF 等）。
-- 文件内容按 base64 分块存在 D1 里（单行远小于 D1 的 2MB 上限），和其他数据一起受 Access 保护、一起备份。
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('idea', 'paper', 'note')),
  owner_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  note TEXT,
  complete INTEGER NOT NULL DEFAULT 0,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_attachments_owner ON attachments(owner_type, owner_id);

CREATE TABLE attachment_chunks (
  attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (attachment_id, seq)
);
