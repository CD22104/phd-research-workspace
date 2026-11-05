# Research Timer · Mac 菜单栏计时 v1.1.0

独立菜单栏小工具，支持 macOS 12 及以上。无需 SwiftBar、xbar 或模型 API Key。

## 安装或更新

1. 在 Mac 上重新下载并解压 ZIP。
2. 打开终端，输入 `bash `（末尾保留空格），把新解压目录里的「安装.command」拖入终端，按回车。
3. 如果提示缺少 Apple 编译工具，先执行 `xcode-select --install`；安装好后重试第 2 步。
4. 脚本先编译，再关闭安装位置的旧版并替换，保留网站计时和登录数据。旧应用会备份到本应用的 Application Support/Backups 目录。
5. 窗口标题下应显示 `v1.1.0`。首次使用时，用网站原来的邮箱验证码登录一次；WebKit 的登录状态与其他浏览器独立。
6. 在网站或小工具窗口开始计时，菜单栏显示累计专注时间。关闭窗口后，小工具仍运行。

安装位置：`~/Applications/Research Timer.app`。可手动加入 macOS「系统设置 → 通用 → 登录项」。卸载时在窗口上方或菜单栏点击「退出」，再将 App 移至废纸篓。

这是源码安装包：安装脚本在你的 Mac 上编译并本地签名，不需要开发者账户。不同 macOS 版本的菜单栏表现可能不同。若编译失败，旧应用会保留；请在 GitHub Issues 里附上终端错误信息。

## 菜单栏没有显示

- 确认窗口显示 `v1.1.0`；只刷新网站不能更新已安装的小工具。
- 确认「系统设置 → 菜单栏 → 允许在菜单栏中显示」的 Research Timer 开关打开。
- 点击窗口顶部的「重新显示菜单栏」。
- 顶部图标较多时勾选「仅图标」，缩成 26pt 入口；也可暂时隐藏不用的系统图标以留出空间。macOS 在空间不足时仍可能隐藏已启用的项目。
- 仍看不到时，点击「复制诊断」，把文字附在 GitHub Issue 里。诊断包含应用版本、状态栏尺寸、同步状态和屏幕尺寸，不包含 Cookie、密钥、任务标题或论文内容。

诊断也保存在 `~/Library/Application Support/<本应用 Bundle ID>/menu-diagnostics.txt`。其中 `statusVisibleFlag=true` 只表示系统将此项设为可见，不能证明它没有被空间限制遮挡。

## 使用

- 菜单栏只显示紧凑的专注时长；暂停时加暂停图标。空闲、尚未同步或开启「仅图标」时显示计时图标。
- 点开菜单可看任务名称、完整时长、后台任务，支持暂停 / 继续、停止并保存；每项后台任务可单独结束。
- 窗口顶部也显示连接和计时状态。登录过期或同步超过 95 秒时不再显示过期的计时数字，打开工作台重新登录或刷新即可。
- 新建专注或后台计时：打开工作台，在网页对应位置操作。
- 网站和小工具共用计时记录。每 30 秒读取网站一次；点击菜单或电脑唤醒后立即同步，秒数在本地刷新。
- 暂停期间不累计专注工时；后台时长独立累计，不计入专注统计或评分。
- 退出 App、合盖或断网不会自动停止服务端计时。回到工作台后可停止；忘记停止的记录可在网站「计时记录」修正。
- 不调用任何大模型 API，不使用 Cloudflare 服务令牌；只通过本人的网站登录 Cookie 读写网站计时接口。网站自身请求仍计入 Cloudflare 的正常用量。

## 开发说明

`ResearchTimer.swift` 使用 AppKit 的 NSStatusItem 和 WKWebView；`bridge.js` 仅在 choose-project-name.pages.dev 的 HTTPS 主框架启用。消息桥检查来源，命令限定为暂停、继续、停止和结束后台任务，携带精确的 session_id。无通用代码执行接口，无预置密钥。

Apple 文档：[NSStatusItem](https://developer.apple.com/documentation/appkit/nsstatusitem)、[可见状态与空间限制](https://developer.apple.com/documentation/appkit/nsstatusitem/isvisible)、[WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)。
