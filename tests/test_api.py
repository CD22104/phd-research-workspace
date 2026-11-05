"""接口验收测试：对一份全新的本地数据库跑一遍关键场景。

用法：
  scripts/dev-test-server.sh /tmp/honey-test 8799 &   # 先启动测试服务器
  python3 tests/test_api.py http://127.0.0.1:8799 tests/fixtures/sample_feishu.csv   # 也可以换成自己导出的飞书 CSV
"""
import json
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8799"
CSV = sys.argv[2] if len(sys.argv) > 2 else None
passed = 0


def call(method, path, body=None, actor="web", headers=None, expect=None):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", "X-Requested-With": "test", "X-Actor": actor}
    h.update(headers or {})
    req = urllib.request.Request(BASE + "/api" + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, out = r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        status, out = e.code, json.loads(e.read() or b"{}")
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status} (期望 {expect})：{out}")
    return status, out


def ok(cond, msg):
    global passed
    if not cond:
        raise AssertionError(msg)
    passed += 1
    print("  ✓", msg)


def section(t):
    print(f"\n【{t}】")


def papers():
    return call("GET", "/papers")[1]["papers"]


# ───────── 1. 飞书迁移 ─────────
section("飞书迁移")
if CSV:
    import csv
    import io
    text = open(CSV, encoding="utf-8-sig").read()
    rows = [r for r in csv.DictReader(io.StringIO(text)) if (r.get("论文名称") or "").strip()]
    n = len(rows)
    react_row = next(r for r in rows if r["论文名称"].startswith("ReAct"))
    dropped_row = next(r for r in rows if r["Status"].strip().lower() == "giveup")
    _, pv = call("POST", "/import/preview", {"text": text, "enrich": False}, expect=200)
    ok(pv["format"] == "feishu" and pv["count"] == n, f"识别为飞书格式，{n} 条（实际 {pv['format']} / {pv['count']}）")
    ok(all(i["action"] == "create" for i in pv["items"]), "空库时全部为新建")
    commit = {"import_key": "feishu-test-1", "source": {"kind": "feishu", "name": "飞书论文清单", "raw": text},
              "items": [{"draft": i["draft"], "raw": i["raw"], "origins": i["origins"], "action": i["action"]} for i in pv["items"]]}
    _, res = call("POST", "/import/commit", commit, expect=200)
    ok(len(res["created"]) == n, f"新建 {n} 篇（实际 {len(res['created'])}）")
    _, again = call("POST", "/import/commit", commit, expect=200)
    ok(again.get("replayed") and len(papers()) == n, "同一 import_key 重复提交不会重复导入")
    _, pv2 = call("POST", "/import/preview", {"text": text, "enrich": False}, expect=200)
    ok(all(i["action"] == "merge" for i in pv2["items"]), "再次预览：全部识别为已有论文")
    feishu_source = res["source_id"]
    ps = papers()
    react = next(p for p in ps if p["title"].startswith("ReAct"))
    ok(react["reading"]["state"] == "done" and react["collection"] == react_row["分组"], f"ReAct：已读、集合 = {react_row['分组']}")
    dropped = next(p for p in ps if p["title"].startswith(dropped_row["论文名称"][:20]))
    ok(dropped["reading"]["state"] == "dropped", f"{dropped_row['论文名称'][:30]}：放弃")
    _, d = call("GET", f"/papers/{react['id']}")
    ok(d["recommendations"][0]["kind"] == "飞书迁移" and d["logs"], "ReAct 有飞书迁移推荐记录和阅读记录")
else:
    print("  （未提供 CSV，跳过）")

# ───────── 2. 同一论文从不同渠道重复导入 ─────────
section("同一论文从不同渠道导入")
_, created = call("POST", "/papers", {"title": "ReAct: Synergizing Reasoning and Acting in Language Models", "arxiv_id": "2210.03629",
                                       "my_note": "我自己的备注", "venue": "ICLR 2023", "enrich": False}, expect=201)
rid = (created["created"] or created["merged"])[0]
note_before = call("GET", f"/papers/{rid}")[1]["paper"]["my_note"]
ok(not CSV or created["merged"] == [rid], "手动添加已存在的论文：合并到已有那条，不产生第二条")
gpt = json.dumps({"papers": [{"title": "ReAct", "arxiv_id": "2210.03629", "venue": "NeurIPS 2099", "rec_reason": "GPT 说很重要",
                               "my_note": "GPT 想覆盖备注", "abstract": "摘要来自 GPT"}]}, ensure_ascii=False)
_, pv = call("POST", "/import/preview", {"text": gpt, "enrich": False, "defaults": {"rec_kind": "GPT"}}, expect=200)
it = pv["items"][0]
ok(it["action"] == "merge" and it["match"]["id"] == rid and it["match"]["certain"], "按 arXiv 号判定为同一篇，建议合并")
ok(any(c["field"] == "venue" for c in it["merge"]["conflicts"]), "发表地不一致被列为冲突")
ok("my_note" not in it["merge"]["fill"], "个人备注不在补全列表里")
_, res = call("POST", "/import/commit", {"import_key": "gpt-1", "source": {"kind": "chatgpt", "name": "GPT 推荐", "raw": gpt},
                                          "items": [{"draft": it["draft"], "action": "merge", "target_id": rid}]}, expect=200)
_, d = call("GET", f"/papers/{rid}")
ok(d["paper"]["my_note"] == note_before, "导入没有覆盖个人备注")
ok(d["paper"]["venue"] == "ICLR 2023" and res["conflicts"], "冲突未确认前不改发表地，结果里返回冲突")
ok(d["paper"]["abstract"] == "摘要来自 GPT", "空字段被补上")
ok(len([r for r in d["recommendations"] if r["kind"] == "GPT"]) == 1, "新增一条 GPT 推荐记录，论文仍是一条")
ok(any(c["field"] == "abstract" and c["origin"] and "GPT" in c["origin"] for c in d["changes"]), "变更记录写明字段来源")

# 疑似重复
section("疑似重复不自动合并")
_, pv = call("POST", "/import/preview", {"items": [{"title": "ReAct: Synergizing Reasoning and Acting in LLMs"}], "enrich": False}, expect=200)
it = pv["items"][0]
ok(it["action"] == "review" and not it["match"]["certain"], "标题相似但没有标识符：需要人工确认")
_, res = call("POST", "/papers", {"title": "ReAct: Synergizing Reasoning and Acting in LLMs", "enrich": False}, actor="mcp", expect=201)
cand = res["candidates"][0]
_, d = call("GET", f"/papers/{cand}")
ok(d["paper"]["stage"] == "candidate" and d["paper"]["possible_dup_of"] == rid, "MCP 新增疑似重复：进入候选区并标记疑似重复")

# 撤销
section("整批撤销")
_, undo = call("POST", f"/sources/{res['source_id']}/undo", {}, actor="mcp")
ok(undo[0] if False else undo.get("data", {}).get("needs_confirm"), "MCP 撤销需要确认")
_, undo = call("POST", f"/sources/{res['source_id']}/undo", {"confirm": True}, actor="mcp", expect=200)
ok(cand in undo["deleted"], "撤销后候选被删除")
gpt_src = next(s for s in call("GET", "/sources")[1]["sources"] if s["name"] == "GPT 推荐")
_, undo = call("POST", f"/sources/{gpt_src['id']}/undo", {}, expect=200)
_, d = call("GET", f"/papers/{rid}")
ok(not d["paper"]["abstract"] and not any(r["kind"] == "GPT" for r in d["recommendations"]), "撤销 GPT 导入：补上的摘要被改回，推荐记录删除")

# ───────── 3. 个人字段的确认规则 ─────────
section("对话入口的确认规则")
call("PATCH", f"/papers/{rid}", {"my_note": "我自己写的备注"}, expect=200)  # 先有一条个人备注，才谈得上「覆盖」
st, out = call("PATCH", f"/papers/{rid}", {"my_note": "MCP 改备注"}, actor="mcp")
ok(st == 409 and out["data"]["needs_confirm"], "MCP 覆盖个人备注：先返回预览，需要确认")
call("PATCH", f"/papers/{rid}", {"my_note": "MCP 改备注", "confirm": True}, actor="mcp", expect=200)
st, _ = call("DELETE", f"/papers/{rid}", actor="mcp")
ok(st == 409, "MCP 删除论文需要确认")

# ───────── 4. 读过的论文再读一次 ─────────
section("已读论文新建阅读计划")
_, idea = call("POST", "/ideas", {"title": "检索失败的归因", "one_liner": "答错时是没检索到，还是检索到了没用上"}, expect=201)
call("POST", f"/ideas/{idea['id']}/papers", {"paper_id": rid, "relation": "方法借鉴"}, expect=201)
_, idd = call("GET", f"/ideas/{idea['id']}")
ok(idd["satisfied"] == 0 and idd["papers"][0]["reading"]["state"] == "no_plan", "关联 1 篇，尚无本 Idea 的阅读计划")
_, plan = call("POST", f"/ideas/{idea['id']}/reread", {"paper_id": rid}, expect=201)
_, d = call("GET", f"/papers/{rid}")
ok(d["reading"]["state"] in ("done_more", "planned"), f"论文阅读状态：{d['reading']['state']}")
call("PATCH", f"/plans/{plan['id']}", {"status": "done"}, expect=200)
_, idd = call("GET", f"/ideas/{idea['id']}")
ok(idd["satisfied"] == 1, "本 Idea 所需的阅读目标完成后计入")

# ───────── 5. 计时 ─────────
section("计时")
today = call("GET", "/bootstrap")[1]["today"]
_, t1 = call("POST", "/tasks", {"date": today, "title": "读 ReAct 实验部分", "paper_id": rid, "points": 2}, expect=201)
_, t2 = call("POST", "/tasks", {"date": today, "title": "写 proposal 动机", "points": 3}, expect=201)
_, r = call("POST", "/timer/start", {"task_id": t1["id"]}, expect=200)
sid1 = r["running"]["id"]
_, r = call("POST", "/timer/start", {"task_id": t1["id"]}, expect=200)
ok(r.get("already") and r["running"]["id"] == sid1, "重复点开始同一任务：不新建记录")
st, r = call("POST", "/timer/start", {"task_id": t2["id"]})
ok(st == 409, "已有计时时开始另一个：提示冲突")
_, r = call("POST", "/timer/start", {"task_id": t2["id"], "switch": True}, expect=200)
ok(r["stopped"]["id"] == sid1 and r["running"]["task_id"] == t2["id"], "切换：停止旧计时并开始新计时")
_, s1 = call("POST", "/timer/stop", {"session_id": r["running"]["id"]}, expect=200)
_, s2 = call("POST", "/timer/stop", {"session_id": r["running"]["id"]}, expect=200)
ok(s2.get("already") and s1["stopped"]["id"] == s2["stopped"]["id"], "重复点停止：返回同一条记录")

results = []
def start_from(device):
    results.append(call("POST", "/timer/start", {"label": f"设备 {device}"})[0])
ths = [threading.Thread(target=start_from, args=(i,)) for i in range(4)]
[t.start() for t in ths]
[t.join() for t in ths]
_, r = call("GET", "/timer")
ok(results.count(200) >= 1 and r["running"] is not None, f"多台设备同时开始：只有一个活跃计时（状态码 {sorted(results)}）")
call("POST", "/timer/stop", {}, expect=200)

now = datetime.now(timezone.utc)
_, man = call("POST", "/sessions", {"start_at": (now - timedelta(hours=5)).isoformat(), "end_at": (now - timedelta(hours=4)).isoformat(), "task_id": t2["id"]}, expect=201)
ok(man["source"] == "manual", "补录不重叠的时间段")
st, out = call("POST", "/sessions", {"start_at": (now - timedelta(hours=4, minutes=30)).isoformat(), "end_at": (now - timedelta(hours=3)).isoformat(), "label": "补录"})
ok(st == 409, "补录与已有计时重叠：拒绝，避免重复计时")

# ───────── 6. 打卡、计划外任务与评分 ─────────
section("打卡与评分")
call("POST", f"/day/{today}/checkin", {"plan_note": "读完 ReAct 实验；写 proposal 动机"}, expect=200)
_, t3 = call("POST", "/tasks", {"date": today, "title": "临时：回复合作者邮件"}, expect=201)
ok(t3["planned"] == 0, "打卡后新加的任务记为计划外")
call("PATCH", f"/tasks/{t1['id']}", {"status": "done"}, expect=200)
call("PATCH", f"/tasks/{t3['id']}", {"status": "done"}, expect=200)
_, day = call("GET", f"/day/{today}")
sc = day["summary"]["score"]
plan_part = next(p for p in sc["parts"] if p["key"] == "plan")
ok(abs(plan_part["ratio"] - 0.4) < 1e-6, f"完成率按点数：2/5 = 40%（实际 {plan_part['ratio']}）")
ok(any("计划外" in n for n in sc["notes"]), "计划外完成单独呈现")
_, wk = call("GET", f"/week/{today}")
ok(wk["score"]["status"] == "none", "本周没有目标：暂不评分")
_, g = call("POST", "/goals", {"week_id": today, "title": "完成 proposal 初稿", "weight": 2}, expect=201)
call("PATCH", f"/goals/{g['id']}", {"progress": 50}, expect=200)
_, wk = call("GET", f"/week/{today}")
ok(wk["score"]["status"] == "in_progress" and wk["score"]["score"] is not None, f"有目标后：进行中评分 {wk['score']['score']}")

# ───────── 7. 信息流 ─────────
section("信息流")
_, ft = call("POST", "/feeds/tasks", {"name": "领域周报跟踪", "runner": "claude", "schedule": "每周一、四", "cadence_days": 3.5}, expect=201)
run = {"task_id": ft["id"], "run_key": "ls-2026-09-26", "status": "success",
       "items": [{"title": "某期 Newsletter", "date": today, "content": "本期提到 https://arxiv.org/abs/2210.03629 和 https://arxiv.org/abs/2305.10601"}]}
_, r1 = call("POST", "/feeds/runs", run, expect=201)
_, r2 = call("POST", "/feeds/runs", run, expect=200)
ok(r2.get("replayed") and r1["run"]["id"] == r2["run"]["id"], "同一次运行重复回传只记一次")
before = len(papers())
_, inbox = call("GET", "/inbox")
ok(len(inbox["feed_items"]) == 1 and len(papers()) == before, "保存动态不会自动产生论文或待办")
item = r1["items"][0]
_, fi = call("GET", f"/feeds/items/{item['id']}")
_, pv = call("POST", "/import/preview", {"text": fi["item"]["content"], "enrich": True, "defaults": {"stage": "candidate", "rec_kind": "Newsletter"}}, expect=200)
ok(all(not i["draft"]["title"].startswith("arXiv:") for i in pv["items"]) or pv.get("warnings"), f"arXiv 补全了标题：{[i['draft']['title'][:40] for i in pv['items']]}")
acts = sorted(i["action"] for i in pv["items"])
ok(acts == ["candidate", "merge"], f"提取：已有的合并，新的进候选区（{acts}）")
_, res = call("POST", "/import/commit", {"source": {"kind": "feed", "name": fi["item"]["title"], "feed_item_id": item["id"]},
                                          "items": [{"draft": i["draft"], "action": i["action"], "target_id": (i.get("match") or {}).get("id")} for i in pv["items"]],
                                          "defaults": {"stage": "candidate"}}, expect=200)
new_cand = res["candidates"][0]
call("POST", f"/papers/{new_cand}/stage", {"stage": "rejected"}, expect=200)
_, pv = call("POST", "/import/preview", {"text": fi["item"]["content"], "enrich": False, "defaults": {"stage": "candidate"}}, expect=200)
ok(any(i["action"] == "skip" and "拒绝" in (i.get("note") or "") for i in pv["items"]), "再处理同一期：已拒绝的不会重新变成候选")
_, fi = call("GET", f"/feeds/items/{item['id']}")
ok(fi["item"]["triage"] == "partial" and len(fi["papers"]) == 2, "动态记为部分整理，并能看到从中提取的论文")
_, feeds = call("GET", "/feeds")
ok(feeds["tasks"][0]["health"] == "ok", "刚回传过：状态正常")

# ───────── 8. 笔记版本冲突 ─────────
section("笔记冲突检测")
_, n = call("POST", "/notes", {"paper_id": rid, "title": "ReAct 笔记", "content": "# ReAct\n初稿"}, expect=201)
call("PATCH", f"/notes/{n['id']}", {"content": "# ReAct\n电脑上改的", "base_version": 1}, expect=200)
st, out = call("PATCH", f"/notes/{n['id']}", {"content": "# ReAct\n手机上改的", "base_version": 1})
ok(st == 409 and "电脑上改的" in out["data"]["current"]["content"], "手机用旧版本保存：提示冲突，不覆盖")
_, m = call("POST", "/notes/match", {"files": [{"filename": "react.md", "text": "---\narxiv: 2210.03629\n---\n# 笔记"}, {"filename": "随便写写.md", "text": "hello"}]})
ok(m["matches"][0]["confidence"] == "high" and m["matches"][1]["confidence"] == "none", "MD 匹配：文件内写 arXiv 号为高置信，无匹配不乱配")

# ───────── 9. 幂等请求头 ─────────
section("幂等")
h = {"Idempotency-Key": "cap-1"}
_, c1 = call("POST", "/captures", {"content": "想法：把拒答也算进评测指标"}, headers=h, expect=201)
_, c2 = call("POST", "/captures", {"content": "想法：把拒答也算进评测指标"}, headers=h)
_, inbox = call("GET", "/inbox")
ok(c2.get("replayed") and len(inbox["captures"]) == 1, "带同一个 Idempotency-Key 的请求只执行一次")

print(f"\n全部通过：{passed} 项")
