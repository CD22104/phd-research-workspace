-- 研究工作台 · 数据结构 v1
-- *_at：UTC ISO 时间；date / *_date：用户时区的本地日期 YYYY-MM-DD（时区见 settings.timezone）
-- 结构要点：
--   项目 → 周目标 → 每日任务；论文 / Idea / 笔记可关联到项目
--   论文资料（papers）、阅读计划（reading_plans）、阅读记录（reading_logs）分开保存
--   每次导入 / 对话 / 动态都是一条来源（sources）；每次推荐一条推荐记录（recommendations）；字段修改写入 changes

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL              -- JSON
);

-- ───────── 来源、变更、幂等 ─────────
CREATE TABLE sources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,         -- feishu / claude / chatgpt / paste / feed / manual / api / mcp
  name       TEXT,                  -- 例如「飞书 My Agent Paper List」「某期 Newsletter」
  channel    TEXT,                  -- 例如「Claude 电脑端」
  url        TEXT,
  raw        TEXT,                  -- 实际传入平台的原文（片段 / 文件），不代表完整对话
  import_key TEXT UNIQUE,           -- 幂等键：同一批导入重复提交只生效一次
  actor      TEXT,                  -- web / mcp / api / script
  undone_at  TEXT,                  -- 整批撤销的时间
  created_at TEXT NOT NULL
);

CREATE TABLE changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,         -- paper / plan / idea / note / task / goal / ...
  entity_id  INTEGER NOT NULL,
  op         TEXT NOT NULL,         -- create / update / delete
  field      TEXT,
  old        TEXT,
  new        TEXT,
  actor      TEXT NOT NULL,         -- web / mcp / api / import / system
  origin     TEXT,                  -- 材料来源：例如「arXiv API」「用户输入」「GPT 对话」
  source_id  INTEGER,               -- 哪一次导入 / 对话带来的修改
  created_at TEXT NOT NULL
);
CREATE INDEX changes_entity ON changes(entity, entity_id);
CREATE INDEX changes_source ON changes(source_id);

CREATE TABLE idempotency (
  key        TEXT PRIMARY KEY,
  response   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ───────── 项目 / 探索主题 ─────────
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'explore',  -- explore 广泛探索 / research 研究项目 / course 课程 / other
  question    TEXT,                             -- 当前核心问题
  status      TEXT NOT NULL DEFAULT 'active',   -- active / paused / done / archived
  next_step   TEXT,                             -- 下一步 / 阶段目标
  description TEXT,
  color       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE project_links (
  project_id INTEGER NOT NULL,
  item_type  TEXT NOT NULL,         -- paper / idea / note / feed_item
  item_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, item_type, item_id)
);
CREATE INDEX project_links_item ON project_links(item_type, item_id);

-- ───────── 计划、打卡、计时 ─────────
CREATE TABLE weeks (
  id             TEXT PRIMARY KEY,  -- 周一日期
  focus          TEXT,              -- 本周主题
  target_minutes INTEGER,           -- 本周计划工时（为空用设置里的默认）
  review         TEXT,              -- 周复盘
  conclusions    TEXT,              -- 得到的结论
  ruled_out      TEXT,              -- 排除的假设 / 路线
  open_questions TEXT,              -- 仍未解决的问题
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id    TEXT NOT NULL,
  project_id INTEGER,
  title      TEXT NOT NULL,
  criteria   TEXT,                  -- 完成标准
  weight     INTEGER NOT NULL DEFAULT 1,
  due_date   TEXT,                  -- 本周内的截止日（用于「截至今天应完成」）
  status     TEXT NOT NULL DEFAULT 'open', -- open / done / dropped
  progress   INTEGER NOT NULL DEFAULT 0,   -- 0-100
  note       TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX goals_week ON goals(week_id);
CREATE INDEX goals_project ON goals(project_id);

CREATE TABLE days (
  date           TEXT PRIMARY KEY,
  kind           TEXT,              -- work / rest / leave；为空按设置里的工作日判断
  plan_note      TEXT,              -- 今日主要目标
  checkin_at     TEXT,
  review         TEXT,              -- 晚间复盘
  mood           INTEGER,           -- 1-5，仅供自我观察，不参与评分
  energy         INTEGER,           -- 1-5，同上
  target_minutes INTEGER,
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  title        TEXT NOT NULL,
  goal_id      INTEGER,
  project_id   INTEGER,
  paper_id     INTEGER,
  plan_id      INTEGER,             -- 阅读计划
  idea_id      INTEGER,
  points       INTEGER NOT NULL DEFAULT 1, -- 工作量点数（1/2/3/5），完成率按点数算
  criteria     TEXT,                -- 完成标准
  planned      INTEGER NOT NULL DEFAULT 1, -- 0 = 打卡后临时加的计划外任务
  status       TEXT NOT NULL DEFAULT 'todo', -- todo / done / dropped / moved
  done_at      TEXT,
  carried_from INTEGER,
  note         TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX tasks_date ON tasks(date);
CREATE INDEX tasks_goal ON tasks(goal_id);

-- 个人工作计时（不含实验机器运行时间）。end_at 为空 = 正在计时，全局最多一条。
CREATE TABLE sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER,
  project_id INTEGER,
  paper_id   INTEGER,
  plan_id    INTEGER,
  idea_id    INTEGER,
  label      TEXT,
  start_at   TEXT NOT NULL,
  end_at     TEXT,
  note       TEXT,
  source     TEXT NOT NULL DEFAULT 'timer', -- timer / manual
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sessions_one_running ON sessions((end_at IS NULL)) WHERE end_at IS NULL;
CREATE INDEX sessions_start ON sessions(start_at);
CREATE INDEX sessions_task ON sessions(task_id);
CREATE INDEX sessions_paper ON sessions(paper_id);

-- ───────── 论文资料 ─────────
CREATE TABLE papers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  short_name      TEXT,
  authors         TEXT,
  team            TEXT,
  venue           TEXT,
  published_date  TEXT,
  url             TEXT,
  pdf_url         TEXT,
  code_url        TEXT,
  arxiv_id        TEXT,
  doi             TEXT,
  links           TEXT NOT NULL DEFAULT '[]', -- 其他版本 / 链接 [{label,url}]
  abstract        TEXT,
  summary         TEXT,             -- 简介
  collection      TEXT,             -- 集合（沿用飞书「分组」）
  side            TEXT,             -- 能力侧 / 安全侧 / 背景侧
  direction       TEXT,             -- 研究问题 / 子方向
  tags            TEXT NOT NULL DEFAULT '[]', -- 主题标签
  stage           TEXT NOT NULL DEFAULT 'library', -- candidate 候选 / library 正式 / rejected 已拒绝
  possible_dup_of INTEGER,          -- 疑似重复（未自动合并）
  my_note         TEXT,             -- 个人字段：导入永不覆盖
  my_question     TEXT,
  added_at        TEXT,
  source_id       INTEGER,          -- 首次入库的来源
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX papers_stage ON papers(stage);
CREATE INDEX papers_arxiv ON papers(arxiv_id);
CREATE INDEX papers_doi ON papers(doi);

-- 每次被推荐 / 导入各一条，保留完整经历
CREATE TABLE recommendations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id    INTEGER NOT NULL,
  source_id   INTEGER,
  kind        TEXT,                 -- 导师 / 合作者 / GPT / Claude / Newsletter / 自己检索 / 引用追踪 / 飞书迁移 / 其他
  recommender TEXT,
  reason      TEXT,                 -- 推荐时给出的理由（原话）
  raw         TEXT,                 -- 这条记录在来源里的原始内容
  action      TEXT NOT NULL,        -- created / merged / duplicate_candidate
  created_at  TEXT NOT NULL
);
CREATE INDEX recommendations_paper ON recommendations(paper_id);
CREATE INDEX recommendations_source ON recommendations(source_id);

-- 阅读计划：为什么读、目标深度、重点章节、完成标准。同一篇论文可以有多轮计划。
CREATE TABLE reading_plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id       INTEGER NOT NULL,
  purpose        TEXT,              -- 阅读原因
  project_id     INTEGER,
  idea_id        INTEGER,
  priority       TEXT,              -- P0-P3
  depth          TEXT,              -- 速览 / 机制理解 / 精读验证 / 复现
  focus_sections TEXT,
  criteria       TEXT,              -- 完成标准
  status         TEXT NOT NULL DEFAULT 'planned', -- planned / reading / done / dropped
  due_date       TEXT,
  done_at        TEXT,
  source_id      INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX reading_plans_paper ON reading_plans(paper_id);
CREATE INDEX reading_plans_idea ON reading_plans(idea_id);

-- 阅读记录：实际读了什么、何时、收获和疑问（时长来自计时记录，也可手填）
CREATE TABLE reading_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id   INTEGER NOT NULL,
  plan_id    INTEGER,
  date       TEXT NOT NULL,
  sections   TEXT,
  content    TEXT,
  questions  TEXT,
  minutes    INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX reading_logs_paper ON reading_logs(paper_id);

-- Markdown 笔记（论文笔记 / Idea 附件 / 项目笔记）
CREATE TABLE notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id   INTEGER,
  plan_id    INTEGER,
  idea_id    INTEGER,
  project_id INTEGER,
  title      TEXT,
  filename   TEXT,
  content    TEXT NOT NULL,
  no_llm     INTEGER NOT NULL DEFAULT 1, -- 1 = 不发送给外部模型
  version    INTEGER NOT NULL DEFAULT 1, -- 乐观锁：保存时带上，冲突则提示
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX notes_paper ON notes(paper_id);
CREATE INDEX notes_idea ON notes(idea_id);

-- ───────── Idea 仓库 ─────────
CREATE TABLE ideas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  one_liner  TEXT,
  kind       TEXT NOT NULL DEFAULT 'idea',  -- idea / proposal
  status     TEXT NOT NULL DEFAULT 'seed',  -- seed / exploring / drafting / experimenting / mature / shelved / dropped
  priority   TEXT,
  tags       TEXT NOT NULL DEFAULT '[]',
  content    TEXT,
  project_id INTEGER,
  no_llm     INTEGER NOT NULL DEFAULT 1,
  version    INTEGER NOT NULL DEFAULT 1,
  source_id  INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE idea_papers (
  idea_id    INTEGER NOT NULL,
  paper_id   INTEGER NOT NULL,
  relation   TEXT,                  -- 相关工作 / 基线 / 方法借鉴 / 反例 / 数据集 / 其他
  note       TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (idea_id, paper_id)
);
CREATE INDEX idea_papers_paper ON idea_papers(paper_id);

-- 正式版本（手动「存为版本」时才生成；自动保存不产生版本）
CREATE TABLE doc_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,         -- idea / note
  entity_id  INTEGER NOT NULL,
  label      TEXT,
  title      TEXT,
  content    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX doc_versions_entity ON doc_versions(entity, entity_id);

-- ───────── 收件箱：随手记 ─────────
CREATE TABLE captures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new', -- new / done / archived
  linked_type TEXT,                 -- 整理后变成了什么：paper / idea / task / project
  linked_id   INTEGER,
  source_id   INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ───────── 定时任务与信息流 ─────────
CREATE TABLE feed_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  runner       TEXT NOT NULL DEFAULT 'manual', -- server / claude / chatgpt / manual
  schedule     TEXT,                -- 人类可读的频率
  cadence_days REAL,                -- 期望间隔天数：超过则显示「未收到新结果」
  sources      TEXT,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'active', -- active / paused
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE feed_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL,
  run_key     TEXT UNIQUE,          -- 幂等：同一次运行重复回传只记一次
  status      TEXT NOT NULL,        -- pending / running / success / partial / failed / unknown
  started_at  TEXT,
  finished_at TEXT,
  item_count  INTEGER,
  message     TEXT,
  cost_usd    REAL,
  created_at  TEXT NOT NULL
);
CREATE INDEX feed_runs_task ON feed_runs(task_id);

CREATE TABLE feed_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER,
  run_id     INTEGER,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  content    TEXT,
  url        TEXT,
  saved_kind TEXT NOT NULL DEFAULT 'summary', -- summary 摘要 / raw 原始材料
  read_state TEXT NOT NULL DEFAULT 'unread',  -- unread / read
  triage     TEXT NOT NULL DEFAULT 'untriaged', -- untriaged / partial / done
  archived   INTEGER NOT NULL DEFAULT 0,
  source_id  INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX feed_items_task ON feed_items(task_id);
