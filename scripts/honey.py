#!/usr/bin/env python3
"""研究工作台命令行（只用标准库）。部署、备份、批量导入和 Claude Code 会话都用它调用接口。

连接配置（按顺序查找）：
  环境变量 HONEY_URL / CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
  ~/.config/<项目名>/service-tokens.env（scripts/cf_setup.py 生成，权限 600）

用法：
  honey.py health
  honey.py get /papers                     # 任意 GET 接口
  honey.py import 文件 [--kind feishu|claude|chatgpt|paste] [--name 来源名] [--stage library|candidate] [--no-enrich] [--yes]
  honey.py export 输出.json                 # 完整导出（所有表）
  honey.py markdown 导出.json 目录           # 把导出转成便于阅读的 Markdown（单向）
  honey.py attach idea|paper|note 编号 文件 [--name 文件名] [--note 备注]   # 上传附件（≤10MB），打印下载链接
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

PROJECT_NAME = json.loads((Path(__file__).resolve().parents[1] / "instance.json").read_text())["project"]
CONF = Path.home() / ".config" / PROJECT_NAME / "service-tokens.env"


def load_conf():
    env = {}
    if CONF.exists():
        for line in CONF.read_text().splitlines():
            m = re.match(r"^\s*([A-Z_]+)\s*=\s*(.*)\s*$", line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    for k in ("HONEY_URL", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    # 脚本默认用 MCP 令牌（与 Claude 同一权限级别）
    env.setdefault("CF_ACCESS_CLIENT_ID", env.get("MCP_CLIENT_ID", ""))
    env.setdefault("CF_ACCESS_CLIENT_SECRET", env.get("MCP_CLIENT_SECRET", ""))
    if not env.get("HONEY_URL"):
        sys.exit("没有配置 HONEY_URL（先运行 scripts/cf_setup.py，或设置环境变量）")
    return env



def site_timezone():
    """网站时区：instance.json 里有就用它（开源模板），否则用默认的 Asia/Singapore"""
    inst = Path(__file__).resolve().parents[1] / 'instance.json'
    try:
        return json.loads(inst.read_text())['timezone']
    except Exception:
        return 'Asia/Singapore'


CFG = None


def call(method, path, body=None, headers=None):
    global CFG
    CFG = CFG or load_conf()
    h = {"User-Agent": "research-workspace/0.1", "Content-Type": "application/json", "X-Requested-With": "honey-cli", "X-Actor": "script"}
    if CFG.get("CF_ACCESS_CLIENT_ID"):
        h["CF-Access-Client-Id"] = CFG["CF_ACCESS_CLIENT_ID"]
        h["CF-Access-Client-Secret"] = CFG["CF_ACCESS_CLIENT_SECRET"]
    h.update(headers or {})
    req = urllib.request.Request(CFG["HONEY_URL"].rstrip("/") + "/api" + path, method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            ctype = r.headers.get("Content-Type", "")
            raw = r.read()
            if "json" not in ctype:
                sys.exit(f"返回的不是 JSON（{ctype}）：可能被 Access 拦截，检查服务令牌")
            return json.loads(raw or b"{}")
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read() or b"{}")
        except Exception:
            data = {}
        raise SystemExit(f"{method} {path} 失败（{e.code}）：{data.get('error')} {json.dumps(data.get('data'), ensure_ascii=False) if data.get('data') else ''}")


def cmd_import(a):
    text = Path(a.file).read_text(encoding="utf-8-sig")
    kind = a.kind or ("feishu" if "论文名称" in text[:500] and "Topic Tags" in text[:500] else "paste")
    defaults = {"stage": a.stage}
    pv = call("POST", "/import/preview", {"text": text, "enrich": not a.no_enrich, "defaults": defaults})
    acts = {}
    for it in pv["items"]:
        acts[it["action"]] = acts.get(it["action"], 0) + 1
    print(f"识别为 {pv['format']}，{pv['count']} 条：{acts}")
    for w in pv.get("warnings", []):
        print("注意：", w)
    review = [it for it in pv["items"] if it["action"] == "review"]
    for it in review:
        print(f"  疑似重复（将进候选区等你确认）：{it['draft']['title']}  ≈ #{it['match']['id']} {it['match']['title']}")
    if not a.yes and input("确认导入？[y/N] ").strip().lower() != "y":
        return print("已取消")
    key = "cli-" + hashlib.sha256(text.encode()).hexdigest()[:32]
    res = call("POST", "/import/commit", {
        "import_key": key,
        "source": {"kind": kind, "name": a.name or Path(a.file).name, "raw": text},
        "items": [{"draft": i["draft"], "raw": i["raw"], "origins": i["origins"], "action": i["action"], "target_id": (i.get("match") or {}).get("id")} for i in pv["items"]],
        "defaults": defaults,
    })
    print(f"{'（之前已导入过，没有重复写入）' if res.get('replayed') else ''}新建 {len(res['created'])}，候选 {len(res['candidates'])}，合并 {len(res['merged'])}，跳过 {res.get('skipped', 0)}；来源记录 #{res['source_id']}")


def cmd_export(a):
    data = call("GET", "/export")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已导出 {sum(len(v) for v in data['tables'].values())} 行 → {a.out}")


def slug(s, n=60):
    s = re.sub(r"[\\/:*?\"<>|\n\r\t]+", " ", str(s or "")).strip()
    return (s[:n] or "untitled").strip()


def fm(d):
    lines = ["---"]
    for k, v in d.items():
        if v is None or v == "" or v == []:
            continue
        lines.append(f"{k}: {json.dumps(v, ensure_ascii=False)}")
    lines.append("---\n")
    return "\n".join(lines)


def cmd_markdown(a):
    """单向导出：便于在 Git 里阅读和查看历史；完整恢复请用数据库快照（.sql）。"""
    data = json.loads(Path(a.json).read_text(encoding="utf-8"))["tables"]
    out = Path(a.dir)
    by = lambda t, k: {r[k]: r for r in data[t]}
    papers = by("papers", "id")
    plans, logs, notes, recs = {}, {}, {}, {}
    for r in data["reading_plans"]:
        plans.setdefault(r["paper_id"], []).append(r)
    for r in data["reading_logs"]:
        logs.setdefault(r["paper_id"], []).append(r)
    for r in data["notes"]:
        if r["paper_id"]:
            notes.setdefault(r["paper_id"], []).append(r)
    sources = by("sources", "id")
    for r in data["recommendations"]:
        recs.setdefault(r["paper_id"], []).append(r)
    (out / "papers").mkdir(parents=True, exist_ok=True)
    keep = set()
    for p in papers.values():
        name = f"{p['id']:04d} {slug(p['short_name'] or p['title'])}.md"
        keep.add("papers/" + name)
        body = [fm({k: p[k] for k in ("id", "title", "authors", "venue", "published_date", "url", "arxiv_id", "doi", "collection", "side", "direction", "stage", "added_at")} | {"tags": json.loads(p["tags"] or "[]")}),
                f"# {p['title']}\n"]
        if p["summary"]:
            body.append(f"**简介**：{p['summary']}\n")
        if p["my_note"]:
            body.append(f"**我的备注**：{p['my_note']}\n")
        if p["my_question"]:
            body.append(f"**我的问题**：{p['my_question']}\n")
        if plans.get(p["id"]):
            body.append("## 阅读计划\n")
            for x in plans[p["id"]]:
                body.append(f"- [{x['status']}] {x['depth'] or ''} {x['purpose'] or ''} {('重点：' + x['focus_sections']) if x['focus_sections'] else ''} {('完成于 ' + x['done_at']) if x['done_at'] else ''}")
            body.append("")
        if logs.get(p["id"]):
            body.append("## 阅读记录\n")
            for x in sorted(logs[p["id"]], key=lambda x: x["date"]):
                body.append(f"- {x['date']}：{x['sections'] or ''} {x['content'] or ''} {('疑问：' + x['questions']) if x['questions'] else ''}")
            body.append("")
        if recs.get(p["id"]):
            body.append("## 来源\n")
            for x in recs[p["id"]]:
                s = sources.get(x["source_id"]) or {}
                body.append(f"- {x['created_at'][:10]} {x['kind'] or s.get('kind', '')} {x['recommender'] or ''} {s.get('name') or ''}：{x['reason'] or ''}")
            body.append("")
        for n in notes.get(p["id"], []):
            body.append(f"## 笔记：{n['title'] or n['filename'] or ''}\n\n{n['content']}\n")
        (out / "papers" / name).write_text("\n".join(body), encoding="utf-8")
    (out / "ideas").mkdir(exist_ok=True)
    for i in data["ideas"]:
        name = f"{i['id']:04d} {slug(i['title'])}.md"
        keep.add("ideas/" + name)
        (out / "ideas" / name).write_text(fm({k: i[k] for k in ("id", "title", "kind", "status", "priority", "project_id", "updated_at")}) + f"# {i['title']}\n\n{i['one_liner'] or ''}\n\n{i['content'] or ''}\n", encoding="utf-8")
    (out / "journal").mkdir(exist_ok=True)
    weeks = by("weeks", "id")
    goals = {}
    for g in data["goals"]:
        goals.setdefault(g["week_id"], []).append(g)
    for wid in sorted(set(weeks) | set(goals)):
        w = weeks.get(wid, {})
        body = [f"# {wid} 这一周\n", f"主题：{w.get('focus') or ''}\n", "## 目标\n"]
        body += [f"- [{g['status']}] {g['title']}（{g['progress']}%）" for g in goals.get(wid, [])]
        for k, label in (("conclusions", "得到的结论"), ("ruled_out", "排除的假设"), ("open_questions", "仍未解决"), ("review", "复盘")):
            if w.get(k):
                body.append(f"\n## {label}\n\n{w[k]}")
        keep.add(f"journal/{wid}.md")
        (out / "journal" / f"{wid}.md").write_text("\n".join(body) + "\n", encoding="utf-8")
    # 删掉已不存在的旧文件（例如论文被删除后）
    for sub in ("papers", "ideas", "journal"):
        for f in (out / sub).glob("*.md"):
            if f"{sub}/{f.name}" not in keep:
                f.unlink()
    print(f"已写出 {len(keep)} 个 Markdown 文件 → {out}")


def feed_payload(a):
    """Pure local validation; no model, network, or credentials are needed."""
    content = Path(a.file).read_text(encoding="utf-8-sig")
    if not content.strip() or len(content) > 400_000:
        raise ValueError("文件内容应为 1–400000 个字符")
    date = a.date or datetime.now(ZoneInfo(site_timezone())).date().isoformat()
    if datetime.strptime(date, "%Y-%m-%d").date().isoformat() != date:
        raise ValueError("日期格式应为 YYYY-MM-DD")
    if a.task_id <= 0:
        raise ValueError("task-id 应为网站信息流中的正整数任务编号")
    heading = next((line.lstrip('#').strip() for line in content.splitlines() if line.startswith('# ')), '')
    title = a.title or heading or Path(a.file).stem
    if len(title) > 300:
        raise ValueError("标题最多 300 字")
    item = {"title": title, "date": date, "content": content, "saved_kind": "summary"}
    digest = hashlib.sha256(json.dumps({"task": a.task_id, "item": item}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    key = a.run_key or "codex-" + digest
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", key):
        raise ValueError("run-key 只能包含字母、数字及 _ . : -，最多 160 字符")
    return {"task_id": a.task_id, "run_key": key, "status": "success", "message": "Codex 定时任务上传已有结果；上传过程未调用模型", "items": [item]}


def cmd_feed_upload(a):
    try:
        payload = feed_payload(a)
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc))
    if a.dry_run:
        print(json.dumps({"dry_run": True, "task_id": payload["task_id"], "run_key": payload["run_key"], "title": payload["items"][0]["title"], "date": payload["items"][0]["date"], "characters": len(payload["items"][0]["content"])}, ensure_ascii=False))
        return
    result = call("POST", "/feeds/runs", payload)
    print(json.dumps({"ok": True, "run_id": result["run"]["id"], "items": result["items"], "replayed": bool(result.get("replayed"))}, ensure_ascii=False))


def cmd_attach(a):
    import base64
    p = Path(a.file)
    if not p.is_file():
        sys.exit(f"找不到文件：{p}")
    data = p.read_bytes()
    if len(data) > 10 * 1024 * 1024:
        sys.exit(f"文件 {len(data) / 1024 / 1024:.1f} MB，超过单个附件上限 10 MB")
    name = a.name or p.name
    key = "att-" + hashlib.sha256(data + f"{a.owner_type}:{a.owner_id}:{name}".encode()).hexdigest()[:32]
    r = call("POST", "/attachments", {"owner_type": a.owner_type, "owner_id": a.owner_id, "filename": name, "note": a.note,
                                      "data_base64": base64.b64encode(data).decode()}, {"Idempotency-Key": key})
    url = CFG["HONEY_URL"].rstrip("/") + f"/api/attachments/{r['id']}/download"
    print(json.dumps({"ok": True, "id": r["id"], "filename": r["filename"], "size": r["size"], "sha256": r["sha256"],
                      "duplicate": bool(r.get("duplicate") or r.get("replayed")), "download": url}, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser(description="研究工作台命令行")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("health")
    f = sub.add_parser("feed-upload", help="上传 Codex 已生成的 Markdown；不调用模型")
    f.add_argument("file")
    f.add_argument("--task-id", required=True, type=int)
    f.add_argument("--title")
    f.add_argument("--date", help="YYYY-MM-DD，默认网站时区的当天")
    f.add_argument("--run-key", help="同一期使用同一标识，重试不会重复上传")
    f.add_argument("--dry-run", action="store_true", help="仅本地检查，不联网")
    g = sub.add_parser("get")
    g.add_argument("path")
    i = sub.add_parser("import")
    i.add_argument("file")
    i.add_argument("--kind")
    i.add_argument("--name")
    i.add_argument("--stage", default="library", choices=["library", "candidate"])
    i.add_argument("--no-enrich", action="store_true")
    i.add_argument("--yes", action="store_true")
    e = sub.add_parser("export")
    e.add_argument("out")
    t = sub.add_parser("attach", help="把文件作为附件挂到 Idea / 论文 / 笔记下")
    t.add_argument("owner_type", choices=["idea", "paper", "note"])
    t.add_argument("owner_id", type=int)
    t.add_argument("file")
    t.add_argument("--name", help="保存的文件名，默认用原文件名")
    t.add_argument("--note")
    m = sub.add_parser("markdown")
    m.add_argument("json")
    m.add_argument("dir")
    a = ap.parse_args()
    if a.cmd == "health":
        print(call("GET", "/health"))
    elif a.cmd == "get":
        print(json.dumps(call("GET", a.path), ensure_ascii=False, indent=1))
    elif a.cmd == "import":
        cmd_import(a)
    elif a.cmd == "feed-upload":
        cmd_feed_upload(a)
    elif a.cmd == "export":
        cmd_export(a)
    elif a.cmd == "markdown":
        cmd_markdown(a)
    elif a.cmd == "attach":
        cmd_attach(a)


if __name__ == "__main__":
    main()
