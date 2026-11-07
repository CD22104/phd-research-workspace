# Claude 接入研究工作台

`honey-mcp.mjs` 是 stdio MCP 服务，共 32 个工具，使用 Node 内置模块，无需安装依赖。运行 MCP 的电脑需要 Node 18 或更新版本；网站需要先完成部署。

## Claude 电脑端配置

把 `honey-mcp.mjs` 拷到使用 Claude 的电脑。配置文件位置：

- macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows：`%APPDATA%\Claude\claude_desktop_config.json`

合并以下配置，保留已有的其他 MCP 服务：

```json
{
  "mcpServers": {
    "research-workspace": {
      "command": "node",
      "args": ["/电脑上的绝对路径/honey-mcp.mjs"],
      "env": {
        "HONEY_URL": "https://choose-project-name.pages.dev",
        "CF_ACCESS_CLIENT_ID": "<MCP_CLIENT_ID>",
        "CF_ACCESS_CLIENT_SECRET": "<MCP_CLIENT_SECRET>"
      }
    }
  }
}
```

部署机器上的 `~/.config/<项目名>/service-tokens.env` 保存实际网址和 MCP 专用令牌。填写时使用其中的 `MCP_CLIENT_ID` 与 `MCP_CLIENT_SECRET`，不要使用 Cloudflare 管理 API Token。配置后重启 Claude。

## 可以做什么

| 场景 | 工具 |
| --- | --- |
| 查询与论文 | `search`、`get_paper`、`add_papers`、`update_paper`、`delete_papers`、`undo_import` |
| 阅读 | `add_reading_plan`、`update_reading_plan`、`add_reading_log`、`add_note` |
| 每日工作 | `get_today`、`checkin`、`add_task`、`update_task`、`save_day_review`、`start_timer`、`stop_timer` |
| 周目标 | `get_week`、`add_goal`、`update_goal` |
| Idea | `list_ideas`、`get_idea`、`create_idea`、`link_paper_to_idea` |
| 项目与整理 | `list_projects`、`create_project`、`capture`、`save_feed_result`、`get_stats` |
| 附件 | `list_attachments`、`attach_file`、`delete_attachment` |

新推荐的论文默认进候选区。覆盖个人字段、已有复盘、撤销导入或删除论文时，先查看预览，用户确认后才带 `confirm: true` 再次提交。标记为“不发送给外部模型”的 Idea 和笔记不会返回正文。

## 附件

`attach_file` 把运行 MCP 的这台电脑上的一个文件（最大 10 MB，例如 Excel、PDF）挂到 Idea、论文或笔记下，返回下载链接，可以写进正文：`[文件名](下载链接)`。同名、内容相同的文件重复上传只保存一次。`list_attachments` 只返回文件名、大小和链接，不把文件内容交给模型。`delete_attachment` 和删除论文一样，先返回预览，用户同意后带 `confirm: true` 才删除。

## 删除论文

`delete_papers` 可以一次删除最多 50 篇。第一次调用只返回预览：标题，以及会一起删除的阅读计划、阅读记录、笔记数量。用户同意后，带 `confirm: true` 再调用一次才真正删除。服务端同样会拦截不带确认的删除，网页、MCP、ChatGPT 规则一致。

- 任务和计时记录会保留，只解除和这篇论文的关联。
- 删除记录保留在变更日志里。
- 如果只是不想读，也不想以后再被推荐，用 `update_paper` 把 `stage` 设为 `rejected`（拒绝）更合适：删除之后，同一篇再被推荐时会重新入库。

更新这个文件后，要把新的 `honey-mcp.mjs` 覆盖到 Mac 上原来的位置，然后重启 Claude，新工具才会出现。

## 接入验收

在 Claude 中搜索已有论文，然后添加一篇明确标为测试的候选论文；在网页收件箱确认出现。重复添加同样内容，应当仍只有一条。最后撤销这批测试导入，确认网页中已移除。

`tests/test_mcp.mjs` 是本地验收脚本，依赖测试库中的 ReAct 和 Idea #1，并会创建随手记。线上最小验收应只创建自己的临时测试记录并在结束后清理。

## 排查

- 启动失败：终端运行 `node --version`；GUI 找不到 Node 时，将 `command` 改成 Node 的绝对路径。
- 被 Access 拦截：检查网站地址、MCP 令牌及服务令牌策略。可在部署机器运行 `python3 scripts/cf_setup.py --verify-only`。
- 返回 HTML 或重定向：通常是身份认证未通过，不是 API 成功。
- API 返回 401：检查 Pages 中的 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 和 `SERVICE_TOKEN_IDS` 是否与 Access 应用一致。
- 服务日志写在 stderr，stdout 只用于 MCP JSON-RPC。


## 线上命令行验收

`tests/smoke_mcp.mjs` 是可选的线上验收示例（会写入一条测试记录再撤销）。设置 `HONEY_URL`、`CF_ACCESS_CLIENT_ID` 和 `CF_ACCESS_CLIENT_SECRET` 后运行：

```bash
node tests/smoke_mcp.mjs --run
```

它会搜索 ReAct，创建一条带唯一编号的测试候选，验证重复提交后只保留一条，再预览并撤销本次测试。研究论文不变；来源和变更审计按服务端设计保留。无参数只显示帮助。
