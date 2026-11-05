# 让 ChatGPT 定时任务把报告归档到信息流

适合这样的用法：你在 ChatGPT 里有定时任务（Scheduled Tasks），每天 / 每周整理一份新闻简报、领域前沿或论文速递。接入后，任务生成报告时会调用工作台的 `save_feed_result` 工具，把**完整 Markdown** 存进「信息流」，你在「今日」和「信息流」里阅读、勾选完成，从中提取论文到候选区。

> 能否使用取决于你的 ChatGPT 套餐和账户是否支持自定义 MCP 连接器，以及定时任务能否调用连接器。请先按下面的「验收」走一遍，再交给定时任务无人值守运行。

## 它能做什么、不能做什么

- 只有两个工具：`save_feed_result`（归档一份报告）和 `get_feed_result`（查询归档回执）。
- 只能归档到你在「信息流」里**填写了归档编号**的任务；不能读取论文、笔记、计划，也不能删除任何报告。
- 同一期报告重复提交只保存一次；内容修订会另存一个版本，旧版保留。
- 认证用 OAuth：第一次连接时必须由你登录网站并点「允许连接」；授权最长一年，可以随时撤销。网站和普通接口仍然在 Cloudflare Access 之后，不会因此公开。

## 设置步骤

前提：已经按 README 部署好网站，并且在同一个终端里载入了 `.env.cloudflare`。

```bash
# 1. 生成归档专用的签名密钥（保存在 ~/.config/<项目名>/feed-bridge.env），并写入网站的服务端配置
python3 scripts/setup_feed_bridge.py --prepare

# 2. 重新发布，让配置生效
python3 scripts/cf_setup.py --deploy-only

# 3. 只为 OAuth / MCP 这几个机器路径设置 Access 放行（由工具自己校验 OAuth；网站本身仍然私有）
python3 scripts/setup_feed_bridge.py --open-tool-paths
```

4. 在网站「信息流」里为每个定时任务新建一个任务：「在哪运行」选 ChatGPT 任务，「ChatGPT 归档」填一个归档编号（小写字母、数字、下划线），例如 `daily_news`、`weekly_papers`。已经有归档报告的编号不能再修改。
5. 在 ChatGPT 里添加自定义 MCP 连接器：
   - 服务器地址：`https://<你的项目名>.pages.dev/feed-bridge/mcp`
   - 认证方式：OAuth（支持动态注册，不需要填写 Client ID）
   - 回调地址只接受 `https://chatgpt.com/connector_platform_oauth_redirect`
6. 第一次连接时，浏览器会跳到你的网站：先用邮箱验证码登录，确认页面上列出的任务范围，点「允许连接」。
7. 在每个定时任务的提示词末尾加上归档说明，例如：

   ```text
   生成完整报告后，调用 save_feed_result 归档：
   - task_key：daily_news
   - report_date：报告所属日期（YYYY-MM-DD）
   - title：报告标题
   - markdown：完整报告正文（不要用摘要代替）
   - content_status：完整写 complete；只完成一部分写 partial；当天没有更新写 no_updates（正文里说明）
   - run_key：这次运行的固定编号，例如 daily_news:<日期>；重试和修订保持不变
   归档成功会返回 report_id；如果失败，用同样的 run_key 重试，并在回复里说明失败原因。
   ```

## 参数

| 参数 | 说明 |
| --- | --- |
| `task_key` / `task_name` | 至少给一个：归档编号，或信息流里的任务名称（改过名的旧名称也认） |
| `report_date` | 必填，`YYYY-MM-DD`，按网站时区 |
| `title` | 必填，1–300 字 |
| `markdown` | 必填，完整 Markdown，原样保存（最多 40 万字） |
| `content_status` | 必填：`complete`、`partial`、`no_updates` |
| `run_key` | 可选，同一期的重试与修订保持相同值 |
| `source_url` | 可选，来源链接 |

`get_feed_result` 传 `task_key`（或 `task_name`），再加 `report_id`，或 `report_date`（可加 `run_key`），返回该期最近 50 个版本的回执，不返回正文。

## 验收

1. 在普通对话里让 ChatGPT 用 `save_feed_result` 保存一份测试报告，记下返回的 `report_id`；在网站「信息流」里能看到完整正文。
2. 用同样的参数再保存一次，应返回同一个 `report_id`（`duplicate: true`）。
3. 打开一个定时任务，手动「立即运行」，确认信息流里出现这一期报告。
4. 之后观察几次按时自动运行是否稳定。

## 撤销与排查

- 查看和撤销已连接的客户端：`https://<你的项目名>.pages.dev/feed-connect/connections`。
- 返回 `unknown_or_conflicting_task`：归档编号没填或填错，先到「信息流」检查任务的归档编号。
- 返回 `integration_not_configured`：第 1、2 步没有完成，或者重新部署前没有设置好服务端配置。
- 不想用 ChatGPT 连接器时，也可以把报告保存成 Markdown，用网页「上传一期」或 `python3 scripts/honey.py feed-upload` 上传。
