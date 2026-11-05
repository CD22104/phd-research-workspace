# 维护说明（给人和 AI 编程助手）

先读 README.md。这是一个新实例模板，不含任何人的研究数据。

## 结构

- 前端 `web/`（Vue 3 + Naive UI + ECharts），构建输出 `dist/`；后端 `server/`（Hono），入口 `functions/`，数据库 Cloudflare D1。
- MCP 服务 `mcp/honey-mcp.mjs` 与网页使用同一组 API；ChatGPT 日报归档在 `server/feed-bridge/`。
- 皮肤：颜色全部是 CSS 变量，默认值在 `web/src/style.css` 的 `:root`，其他皮肤在 `web/src/themes.css`；组件里不要写死颜色。新增皮肤同时改 `web/src/lib/theme.js` 的 `THEMES` 和 `server/db.ts` 的 `THEME_IDS`，并运行 `python3 scripts/check_theme_contrast.py`。

## 数据与行为约束

- 表结构改动只追加新的 `migrations/00xx_*.sql`，不要修改已有迁移。
- 论文资料、阅读计划、阅读记录是不同实体；读过的论文可以为新目标再读一轮。
- 导入只补空字段；个人备注、问题、阅读状态和笔记不被导入覆盖。只有 arXiv / DOI / 链接这类可靠标识符相同才自动合并，标题相似只能标为疑似重复。
- 保留导入原文、推荐来源和字段变更记录；同批导入可撤销，重复提交只生效一次。
- 非网页入口（MCP、服务令牌）覆盖个人内容、删除、撤销时，保留 `needs_confirm` 预览流程；服务令牌不能伪装成网页操作。
- Idea 和笔记默认不向外部模型返回正文；大模型默认关闭。
- 同一时间只有一个专注计时（可暂停 / 继续）；后台任务可以多个并行，不计入专注工时与评分。
- 评分规则带生效日期，改权重不改历史；没有数据时显示「暂不评分」，不记零分。日期按 `TIMEZONE` 计算。

## 检查

```bash
npm run typecheck && npm test && npm run build
```

接口写入测试必须用 `scripts/dev-test-server.sh` 新建的临时空库（它会清空传入的目录）；绝不对线上运行 `tests/test_api.py`、`scripts/demo_data.py` 等写入脚本。

## 发布

- 先运行 `scripts/configure_instance.py`；部署用 `scripts/cf_setup.py`（`--deploy-only` 更新代码并迁移数据库，`--verify-only` 只验收）。
- 凭证放在本机 `.env.cloudflare`（已被 Git 忽略）与 `~/.config/<项目名>/service-tokens.env`，不要写进代码、文档或输出。
- 保持 Cloudflare Access 私有访问；`DEV_NO_AUTH` 只用于本机测试服务器。
