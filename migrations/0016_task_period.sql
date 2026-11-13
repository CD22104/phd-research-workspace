-- 日任务的粗略时段：morning 早（12 点前）/ afternoon 中（12–18 点）/ evening 晚（18 点后）；为空 = 未定时段。
-- 只新增一列，已有任务保持为空，不改动任何旧数据。
ALTER TABLE tasks ADD COLUMN period TEXT CHECK (period IS NULL OR period IN ('morning', 'afternoon', 'evening'));
