-- 主题标签只描述研究主题；资料类型与元数据核验单独保存。
ALTER TABLE papers ADD COLUMN material_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK(material_type IN ('paper','survey','technical_report','official_article','research_post','unknown'));
ALTER TABLE papers ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK(verification_status IN ('verified','partial','unverified'));
ALTER TABLE papers ADD COLUMN verification_note TEXT;
ALTER TABLE papers ADD COLUMN verified_at TEXT;
