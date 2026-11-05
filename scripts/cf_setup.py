#!/usr/bin/env python3
"""一次性（可重复运行）的 Cloudflare 部署：D1 + Pages + Access（只有你能访问）+ 服务令牌。

需要的 API Token 权限：D1 Edit、Cloudflare Pages Edit、Access: Apps and Policies Edit、Access: Service Tokens Edit。
令牌从环境变量读取：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID（例如先 `set -a; . ./.env.cloudflare; set +a`）。

用法：
  python3 scripts/cf_setup.py --check                    # 只检查权限和现状，不做任何修改
  python3 scripts/cf_setup.py --owner 你的邮箱            # 创建 / 更新全部资源并部署
  python3 scripts/cf_setup.py --owner 你的邮箱 --deploy-only
  python3 scripts/cf_setup.py --verify-only              # 只验收线上访问和数据库

生成的服务令牌写到 ~/.config/<项目名>/service-tokens.env（权限 600，不进仓库）。
"""
import argparse
import json
import os
import re
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_NAME = json.loads((ROOT / "instance.json").read_text())["project"]
CONF = Path.home() / ".config" / PROJECT_NAME / "service-tokens.env"
APP_NAME = f"研究工作台 {PROJECT_NAME} (private)"
TOKEN_NAMES = {"MCP": PROJECT_NAME + "-mcp", "GPT": PROJECT_NAME + "-gpt"}
GPT_HEADER = "Authorization"  # ChatGPT Actions 只能带一个自定义请求头：Access 从这个头里读取服务令牌

TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def cf(method, path, body=None, ok404=False):
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}{path}", method=method,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())["result"]
    except urllib.error.HTTPError as e:
        data = json.loads(e.read() or b"{}")
        if ok404 and e.code == 404:
            return None
        msg = "; ".join(x.get("message") or x.get("error") or str(x.get("code", "")) for x in data.get("errors", []))
        raise SystemExit(f"Cloudflare API {method} {path} 失败（{e.code}）：{msg}")


def read_conf():
    env = {}
    if CONF.exists():
        for line in CONF.read_text().splitlines():
            m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
            if m:
                env[m.group(1)] = m.group(2)
    return env


def write_conf(env):
    CONF.parent.mkdir(parents=True, exist_ok=True)
    CONF.write_text("# 研究工作台服务令牌（不要提交到仓库）\n" + "".join(f"{k}={v}\n" for k, v in env.items()))
    CONF.chmod(stat.S_IRUSR | stat.S_IWUSR)


def sh(*args, input_text=None):
    print("$", " ".join(args))
    r = subprocess.run(args, cwd=ROOT, input=input_text, text=True)
    if r.returncode:
        raise SystemExit(f"命令失败：{' '.join(args)}")


def check():
    ok = True
    for path, label in [("/d1/database", "D1"), ("/pages/projects", "Pages"), ("/access/apps", "Access 应用"), ("/access/service_tokens", "Access 服务令牌")]:
        req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}{path}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            with urllib.request.urlopen(req, timeout=30):
                pass
            print(f"✓ {label} 可读取")
        except urllib.error.HTTPError as e:
            ok = False
            reason = "权限不足" if e.code in (401, 403) else "请求失败"
            print(f"✗ {label} {reason}（{e.code}）")
        except (urllib.error.URLError, TimeoutError):
            ok = False
            print(f"✗ {label} 网络连接失败或超时")
    print("以上为只读检查；部署还需要这四项的 Edit / Write 权限（包括账户级 D1: Edit）。")
    return ok


def ensure_d1(name):
    dbs = cf("GET", "/d1/database?name=" + name) or []
    db = next((d for d in dbs if d["name"] == name), None)
    if not db:
        db = cf("POST", "/d1/database", {"name": name})
        print(f"✓ 已创建 D1 数据库 {name}")
    else:
        print(f"✓ D1 数据库 {name} 已存在")
    toml = ROOT / "wrangler.toml"
    s = toml.read_text()
    s2 = re.sub(r'database_id = "[^"]*"', f'database_id = "{db["uuid"]}"', s)
    s2 = re.sub(r'database_name = "[^"]*"', f'database_name = "{name}"', s2)
    if s2 != s:
        toml.write_text(s2)
        print("  已写入 wrangler.toml 的 database_id")
    return db["uuid"]


def ensure_pages(name):
    p = cf("GET", f"/pages/projects/{name}", ok404=True)
    if not p:
        p = cf("POST", "/pages/projects", {"name": name, "production_branch": "main"})
        print(f"✓ 已创建 Pages 项目 {name}")
    else:
        print(f"✓ Pages 项目 {name} 已存在")
    return p["subdomain"]


def ensure_tokens(conf):
    existing = {t["name"]: t for t in cf("GET", "/access/service_tokens") or []}
    ids = {}
    for key, name in TOKEN_NAMES.items():
        t = existing.get(name)
        if t and conf.get(f"{key}_CLIENT_SECRET"):
            ids[key] = t
            print(f"✓ 服务令牌 {name} 已存在")
            continue
        if t:
            # 密钥只在创建时返回一次；本地没有保存就轮换一次
            r = cf("POST", f"/access/service_tokens/{t['id']}/rotate")
            print(f"✓ 服务令牌 {name} 已轮换（本地没有保存密钥）")
        else:
            r = cf("POST", "/access/service_tokens", {"name": name, "duration": "8760h"})
            print(f"✓ 已创建服务令牌 {name}")
        conf[f"{key}_CLIENT_ID"] = r["client_id"]
        conf[f"{key}_CLIENT_SECRET"] = r["client_secret"]
        ids[key] = r
        write_conf(conf)  # 每次创建后立即保存，后续步骤失败时也能恢复
    write_conf(conf)
    return ids


def ensure_access(domain, owner, tokens):
    body = {
        "name": APP_NAME, "type": "self_hosted", "domain": domain,
        "destinations": [{"type": "public", "uri": domain}, {"type": "public", "uri": "*." + domain}],
        "session_duration": "720h", "app_launcher_visible": False, "auto_redirect_to_identity": False,
        "read_service_tokens_from_header": GPT_HEADER,
        "policies": [
            {"name": "Owner", "decision": "allow", "include": [{"email": {"email": owner}}], "precedence": 1},
            {"name": "Service tokens (MCP / GPT)", "decision": "non_identity", "precedence": 2,
             "include": [{"service_token": {"token_id": t["id"]}} for t in tokens.values()]},
        ],
    }
    apps = cf("GET", "/access/apps") or []
    app = next((a for a in apps if a.get("name") == APP_NAME or a.get("domain") == domain), None)
    if app:
        app = cf("PUT", f"/access/apps/{app['id']}", body)
        print("✓ Access 应用已更新")
    else:
        app = cf("POST", "/access/apps", body)
        print("✓ 已创建 Access 应用")
    return app["aud"]


def team_domain(domain):
    req = urllib.request.Request(f"https://{domain}/", method="GET", headers={"User-Agent": "research-workspace/0.1"})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=30):
            pass
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location", "")
        m = re.match(r"https://([^/]+\.cloudflareaccess\.com)/", loc)
        if m:
            return m.group(1)
    except (urllib.error.URLError, TimeoutError):
        pass
    return None


def set_secrets(project, secrets):
    env = {k: {"type": "secret_text", "value": v} for k, v in secrets.items()}
    cf("PATCH", f"/pages/projects/{project}", {"deployment_configs": {"production": {"env_vars": env}, "preview": {"env_vars": env}}})
    print(f"✓ 已设置服务端配置：{', '.join(secrets)}")


def configured_domain(conf):
    url = urlsplit(conf.get("HONEY_URL", ""))
    if (url.scheme != "https" or not url.hostname or url.netloc != url.hostname
            or not url.hostname.endswith(".pages.dev") or url.path not in ("", "/")
            or url.query or url.fragment):
        sys.exit("缺少有效的 HONEY_URL（https://<项目>.pages.dev），请先运行首次部署。")
    for key in TOKEN_NAMES:
        if not conf.get(f"{key}_CLIENT_ID") or not conf.get(f"{key}_CLIENT_SECRET"):
            sys.exit(f"缺少 {key} 服务令牌，请先运行首次部署。")
    return url.hostname


def probe(domain, path, headers=None, anonymous=False):
    """不跟随重定向，避免把登录页 HTTP 200 当成接口成功。"""
    req = urllib.request.Request(f"https://{domain}{path}", headers={"User-Agent": "research-workspace/0.1", **(headers or {})})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=10) as r:
            if anonymous:
                return False, "未登录请求未被 Access 拦截"
            if r.status != 200 or "application/json" not in r.headers.get("Content-Type", "").lower():
                return False, "接口未返回 HTTP 200 JSON"
            data = json.load(r)
            valid = isinstance(data, dict) and (data.get("ok") is True if path == "/api/health" else isinstance(data.get("papers"), list))
            return valid, "通过" if valid else "接口响应结构不正确"
    except urllib.error.HTTPError as e:
        location = urlsplit(e.headers.get("Location", ""))
        if (anonymous and e.code in (301, 302, 303, 307, 308)
                and location.scheme == "https" and (location.hostname or "").endswith(".cloudflareaccess.com")
                and location.path.startswith("/cdn-cgi/access/login")):
            return True, "跳转到 Access 登录页"
        return False, f"HTTP {e.code}"
    except (urllib.error.URLError, TimeoutError, OSError):
        return False, "网络连接失败或超时"
    except (ValueError, UnicodeError):
        return False, "响应不是有效 JSON"


def verify(domain, conf, attempts=6, delay=5):
    mcp = {"CF-Access-Client-Id": conf["MCP_CLIENT_ID"], "CF-Access-Client-Secret": conf["MCP_CLIENT_SECRET"]}
    gpt = {GPT_HEADER: json.dumps({"cf-access-client-id": conf["GPT_CLIENT_ID"], "cf-access-client-secret": conf["GPT_CLIENT_SECRET"]})}
    checks = [("未登录访问网页", "/", None, True), ("未登录访问接口", "/api/health", None, True)]
    for name, headers in (("MCP", mcp), ("GPT", gpt)):
        checks.extend([(f"{name} 服务令牌", "/api/health", headers, False),
                       (f"{name} 数据库读取", "/api/papers?stage=candidate", headers, False)])
    for attempt in range(attempts):
        results = [(label, *probe(domain, path, headers, anonymous)) for label, path, headers, anonymous in checks]
        if all(ok for _, ok, _ in results):
            break
        if attempt + 1 < attempts:
            print(f"等待部署生效，{delay} 秒后重试验收（{attempt + 1}/{attempts}）。", flush=True)
            time.sleep(delay)
    for label, ok, detail in results:
        print(f"{'✓' if ok else '✗'} {label}：{detail}")
    if not all(ok for _, ok, _ in results):
        sys.exit("部署验收失败；修复上述问题后可运行 --verify-only 重新检查。")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=PROJECT_NAME)
    ap.add_argument("--owner", help="唯一允许登录的邮箱")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--deploy-only", action="store_true")
    mode.add_argument("--verify-only", action="store_true", help="仅验收已部署的网站，不修改任何资源")
    ap.add_argument("--team-domain", help="Access 团队域名（xxx.cloudflareaccess.com），默认自动探测")
    ap.add_argument("--llm", choices=["deepseek", "anthropic"], help="同时把对应的 API Key（从环境变量读取）设为服务端密钥")
    a = ap.parse_args()
    conf = read_conf()
    if a.verify_only:
        verify(configured_domain(conf), conf)
        return
    if not a.check and PROJECT_NAME == "choose-project-name":
        sys.exit("请先运行 scripts/configure_instance.py 设置你自己的项目名。")
    if not TOKEN or not ACCOUNT:
        sys.exit("需要环境变量 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID")
    if a.check:
        sys.exit(0 if check() else 1)
    if a.deploy_only:
        domain = configured_domain(conf)
        project = cf("GET", f"/pages/projects/{a.project}")
        if project["subdomain"] != domain:
            sys.exit("HONEY_URL 与 --project 不一致，请检查服务令牌配置。")
        db_id = re.search(r'database_id\s*=\s*"([^"]*)"', (ROOT / "wrangler.toml").read_text())
        if not db_id or db_id.group(1) in ("", "00000000-0000-0000-0000-000000000000"):
            sys.exit("wrangler.toml 尚未配置远程 D1 数据库，请先运行首次部署。")
        if a.llm:
            sys.exit("--llm 需要运行完整部署，不能与 --deploy-only 一起使用。")
    elif not a.owner:
        sys.exit("需要 --owner 邮箱")
    llm_key = {"deepseek": "DEEPSEEK_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}.get(a.llm)
    if llm_key and not os.environ.get(llm_key):
        sys.exit(f"环境变量里没有 {llm_key}")
    if not check():
        sys.exit("Cloudflare 检查未通过，见上面的 ✗")
    # 构建失败时不创建远程资源，也不更改数据库。
    sh("npx", "tsc", "-p", "tsconfig.json")
    sh(sys.executable, str(ROOT / "scripts" / "package_macos.py"))
    sh("npx", "vite", "build")
    if not a.deploy_only:
        ensure_d1(a.project)
        domain = ensure_pages(a.project)
        tokens = ensure_tokens(conf)
        aud = ensure_access(domain, a.owner, tokens)
        team = a.team_domain or team_domain(domain)
        if not team:
            sys.exit("没能自动探测 Access 团队域名，请用 --team-domain 指定")
        conf["HONEY_URL"] = f"https://{domain}"
        write_conf(conf)
        secrets = {
            "ACCESS_TEAM_DOMAIN": team, "ACCESS_AUD": aud, "OWNER_EMAILS": a.owner,
            "SERVICE_TOKEN_IDS": ",".join(conf[f"{k}_CLIENT_ID"] for k in TOKEN_NAMES),
        }
        if llm_key:
            secrets[llm_key] = os.environ[llm_key]
        set_secrets(a.project, secrets)
    domain = configured_domain(read_conf())
    sh("npx", "wrangler", "d1", "migrations", "apply", "DB", "--remote")
    sh("npx", "wrangler", "pages", "deploy", "dist", "--project-name", a.project, "--branch", "main", "--commit-dirty=true")
    verify(domain, read_conf())
    print(f"\n完成：https://{domain}  （用 {a.owner or '你的邮箱'} 收一次性验证码登录）")


if __name__ == "__main__":
    main()
