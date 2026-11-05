# 把部署交给 AI 编程助手

如果你用 Claude Code、Codex 这类 AI 编程助手，可以把下面这段话交给它，让它在克隆下来的项目根目录里完成部署：

> 请先阅读 README.md 和 AGENTS.md，把这个研究工作台部署到我自己的 Cloudflare 账户，使用新的空数据库。
>
> 先检查依赖与本地配置，一次性问我还缺的信息：项目名、登录邮箱、时区、Cloudflare Zero Trust 团队域名，以及我把 Cloudflare 凭证放在本机的哪个文件（默认 `.env.cloudflare`）。凭证由我自己填写，不要输出凭证内容。
>
> 用 `scripts/configure_instance.py` 设置项目名和时区；运行 `npm ci`、类型检查、测试与构建。保持大模型关闭，不配置也不调用任何收费模型 API。
>
> 确认我的 API Token 有 D1、Pages、Access 应用和服务令牌的 Edit 权限，Zero Trust 已开启邮箱验证码登录。用 `scripts/cf_setup.py` 完成部署：只允许我的邮箱和我自己的服务令牌访问。不要导入演示数据，所有带写入的测试只在本机临时库运行。
>
> 发布后验证：未登录访问被拦截、我可以用邮箱验证码登录、论文库和计划都是空的、专注计时可以暂停 / 继续、后台计时独立。完成后告诉我网址、登录方法、服务令牌文件路径（不显示内容）、备份方法，以及哪些已经验证、哪些还需要我自己检查。

## 需要你自己完成的

- 注册 Cloudflare 账户、建 Zero Trust 组织、开启 One-time PIN 登录、创建 API Token（权限见 README）。
- 在本机填写 `.env.cloudflare`，不要把它发给任何人或提交到 Git。
- 第一次用邮箱验证码登录自己的网站。
