#!/usr/bin/env python3
"""给本地演示库写入一套虚构的示例数据，用来看界面、截图或试用（论文都是公开的经典论文，其余内容是虚构的）。

只允许对本机地址运行，绝不要对线上运行。
用法：
  scripts/dev-test-server.sh /tmp/research-demo 8790 &     # 先用一份全新的空库启动本地服务器
  python3 scripts/demo_data.py http://127.0.0.1:8790
"""
import json
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8790').rstrip('/')
if not any(h in BASE for h in ('127.0.0.1', 'localhost')):
    sys.exit('只允许对本机地址运行（例如 http://127.0.0.1:8790）')
warnings = []


def call(method, path, body=None, quiet=False):
    req = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'X-Requested-With': 'demo', 'X-Actor': 'script'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors='replace')[:200]
        if not quiet:
            warnings.append(f'{method} {path} → {e.code} {msg}')
        return None


boot = call('GET', '/bootstrap')
if (call('GET', '/papers') or {}).get('papers'):
    sys.exit('这个库里已经有论文了：演示数据只写入全新的空库')
today = date.fromisoformat(boot['today'])
monday = today - timedelta(days=today.weekday())
D = lambda n: (today + timedelta(days=n)).isoformat()
now = datetime.now(timezone.utc)

# ───────── 论文 ─────────
GROUPS = ['基础阅读', '方法储备', '前沿跟踪']
for g in GROUPS:
    call('POST', '/paper-groups', {'name': g})

PAPERS = [  # 标题, 作者, 发表地, 年, arXiv, 分组, 阅读状态, 深度, 优先级, 标签, 简介
    ('Attention Is All You Need', 'Ashish Vaswani, Noam Shazeer, Niki Parmar, et al.', 'NeurIPS 2017', '2017-06-12', '1706.03762', '基础阅读', 'done', '精读验证', 'P1', ['Transformer'], '提出完全基于注意力的 Transformer 结构。'),
    ('BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', 'Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova', 'NAACL 2019', '2018-10-11', '1810.04805', '基础阅读', 'done', '机制理解', 'P2', ['预训练'], '双向掩码语言模型预训练。'),
    ('Deep Residual Learning for Image Recognition', 'Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun', 'CVPR 2016', '2015-12-10', '1512.03385', '基础阅读', 'skimmed', '速览', 'P3', ['视觉'], '残差连接让很深的网络也能训练。'),
    ('Scaling Laws for Neural Language Models', 'Jared Kaplan, Sam McCandlish, et al.', 'arXiv', '2020-01-23', '2001.08361', '基础阅读', 'to_read', '机制理解', 'P2', ['缩放规律'], '模型规模、数据量与损失之间的幂律关系。'),
    ('Chain-of-Thought Prompting Elicits Reasoning in Large Language Models', 'Jason Wei, Xuezhi Wang, Dale Schuurmans, et al.', 'NeurIPS 2022', '2022-01-28', '2201.11903', '方法储备', 'reading', '机制理解', 'P1', ['推理', '提示'], '在提示里给出推理步骤，提升多步推理能力。'),
    ('ReAct: Synergizing Reasoning and Acting in Language Models', 'Shunyu Yao, Jeffrey Zhao, Dian Yu, et al.', 'ICLR 2023', '2022-10-06', '2210.03629', '方法储备', 'to_read', '机制理解', 'P1', ['推理', '工具使用'], '推理与行动交替进行。'),
    ('Toolformer: Language Models Can Teach Themselves to Use Tools', 'Timo Schick, Jane Dwivedi-Yu, et al.', 'NeurIPS 2023', '2023-02-09', '2302.04761', '方法储备', 'to_read', '速览', 'P2', ['工具使用'], '模型自己学习何时调用外部工具。'),
    ('LoRA: Low-Rank Adaptation of Large Language Models', 'Edward J. Hu, Yelong Shen, et al.', 'ICLR 2022', '2021-06-17', '2106.09685', '方法储备', 'done', '复现', 'P1', ['微调'], '用低秩矩阵高效微调大模型。'),
    ('Direct Preference Optimization: Your Language Model is Secretly a Reward Model', 'Rafael Rafailov, Archit Sharma, et al.', 'NeurIPS 2023', '2023-05-29', '2305.18290', '方法储备', 'to_read', '精读验证', 'P2', ['对齐', '偏好学习'], '不训练奖励模型，直接用偏好数据优化策略。'),
    ('Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks', 'Patrick Lewis, Ethan Perez, et al.', 'NeurIPS 2020', '2020-05-22', '2005.11401', '前沿跟踪', 'done', '精读验证', 'P0', ['RAG', '检索'], '把检索到的文档作为生成的条件。'),
    ('Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection', 'Akari Asai, Zeqiu Wu, et al.', 'ICLR 2024', '2023-10-17', '2310.11511', '前沿跟踪', 'reading', '精读验证', 'P0', ['RAG', '检索'], '模型自己判断何时检索、并评估检索结果。'),
    ('Learning Transferable Visual Models From Natural Language Supervision', 'Alec Radford, Jong Wook Kim, et al.', 'ICML 2021', '2021-02-26', '2103.00020', '前沿跟踪', 'to_read', '速览', 'P2', ['多模态'], 'CLIP：用图文对比学习得到通用视觉表示。'),
    ('Denoising Diffusion Probabilistic Models', 'Jonathan Ho, Ajay Jain, Pieter Abbeel', 'NeurIPS 2020', '2020-06-19', '2006.11239', '前沿跟踪', 'skimmed', '速览', 'P3', ['生成模型'], '扩散模型的经典形式。'),
]
items = [{'title': t, 'authors': a, 'venue': v, 'published_date': d, 'arxiv_id': x, 'collection': g, 'status': s, 'depth': dep, 'priority': pr,
          'tags': tags, 'summary': summ, 'rec_kind': '自己检索', 'purpose': '打基础' if g == '基础阅读' else '为当前项目找方法'}
         for (t, a, v, d, x, g, s, dep, pr, tags, summ) in PAPERS]
pv = call('POST', '/import/preview', {'items': items, 'enrich': False, 'defaults': {'stage': 'library', 'create_plan': True}})
if pv:
    call('POST', '/import/commit', {'import_key': 'demo-' + uuid.uuid4().hex, 'source': {'kind': 'manual', 'name': '示例数据：经典论文'},
                                    'items': [{'draft': i['draft'], 'raw': i['raw'], 'origins': i['origins'], 'action': i['action']} for i in pv['items']],
                                    'defaults': {'stage': 'library', 'create_plan': True}})
cands = [{'title': 'Tree of Thoughts: Deliberate Problem Solving with Large Language Models', 'arxiv_id': '2305.10601', 'venue': 'NeurIPS 2023',
          'rec_reason': '和思维链对比，看看搜索式推理是否值得引入'},
         {'title': 'Reflexion: Language Agents with Verbal Reinforcement Learning', 'arxiv_id': '2303.11366', 'venue': 'NeurIPS 2023',
          'rec_reason': '用文字反馈改进下一轮尝试，可能对失败分析有用'}]
pv = call('POST', '/import/preview', {'items': cands, 'enrich': False, 'defaults': {'stage': 'candidate', 'rec_kind': 'Newsletter'}})
if pv:
    call('POST', '/import/commit', {'import_key': 'demo-' + uuid.uuid4().hex, 'source': {'kind': 'feed', 'name': '示例：每周论文速递'},
                                    'items': [{'draft': i['draft'], 'action': i['action']} for i in pv['items']], 'defaults': {'stage': 'candidate'}})
papers = (call('GET', '/papers') or {}).get('papers', [])
P = lambda prefix: next((p for p in papers if p['title'].startswith(prefix)), None)
call('PUT', '/settings', {'pinned_collections': ['前沿跟踪']})

rag, selfrag, cot, lora = P('Retrieval-Augmented'), P('Self-RAG'), P('Chain-of-Thought'), P('LoRA')
if rag:
    call('POST', '/notes', {'paper_id': rag['id'], 'title': 'RAG 阅读笔记', 'no_llm': False, 'content':
         '# RAG 阅读笔记\n\n**核心**：生成时以检索到的文档 $z$ 为条件，对文档做边缘化：\n\n'
         '$$p(y\\mid x)=\\sum_{z\\in \\mathrm{top}\\text{-}k}p_\\eta(z\\mid x)\\,p_\\theta(y\\mid x,z)$$\n\n'
         '- 检索器和生成器端到端联合训练\n- 知识可以通过替换文档库来更新\n\n> 疑问：检索结果和问题无关时，模型会不会仍然「编」出答案？\n'})
    call('POST', '/logs', {'paper_id': rag['id'], 'date': D(-3), 'sections': '§2 方法、§4 实验', 'content': '边缘化公式看懂了；检索器是 DPR', 'questions': '错误主要来自检索还是生成？'})

# ───────── 项目与 Idea ─────────
proj = call('POST', '/projects', {'name': '检索增强生成的失败分析', 'kind': 'explore', 'question': 'RAG 系统答错时，是没检索到，还是检索到了却没用上？',
                                  'next_step': '用 200 条错误样例做一次人工归因，写成一页表格'}) or {}
call('POST', '/projects', {'name': '开题报告准备', 'kind': 'research', 'question': '把研究问题、相关工作和第一年计划写清楚', 'next_step': '周五前完成第二章初稿'})
call('POST', '/projects', {'name': '机器学习理论（课程）', 'kind': 'course', 'question': '每周作业与期末项目', 'next_step': '作业 4：泛化界'})
if proj.get('id'):
    call('PATCH', f"/projects/{proj['id']}", {'pinned': True})
    grp = next((g for g in (call('GET', '/paper-groups') or {}).get('groups', []) if g['name'] == '前沿跟踪'), None)
    if grp:
        call('POST', f"/projects/{proj['id']}/links", {'item_type': 'paper_group', 'item_id': grp['id']})
    call('POST', '/notes', {'project_id': proj['id'], 'title': '组会讨论：错误归因的口径', 'no_llm': False, 'content':
         '## 结论\n- 先统一「检索失败」的定义：前 5 篇里没有任何一篇包含答案\n- 生成错误再细分为忽略证据、误读证据两类\n\n## 待办\n- [ ] 抽样 200 条\n- [ ] 两人交叉标注 50 条，算一致性\n'})

idea = call('POST', '/ideas', {'title': '用检索置信度决定要不要回答', 'one_liner': '检索证据不足时先追问或拒答，而不是硬着头皮生成。', 'kind': 'idea',
                               'status': 'exploring', 'no_llm': False, 'project_id': proj.get('id'), 'content':
                               '## 一句话\n检索证据不足时先追问或拒答。\n\n## 动机\n很多错误答案来自「检索到的文档根本不包含答案」。\n\n'
                               '## 核心想法\n用前 $k$ 篇文档的相关性分数构造置信度 $c=\\max_i s_i$，当 $c<\\tau$ 时转为追问。\n\n'
                               '## 怎么验证\n在两个开放域问答数据集上比较准确率与覆盖率的权衡曲线。\n'}) or {}
call('POST', '/ideas', {'title': '偏好数据里的噪声标注', 'one_liner': '少量矛盾的偏好对会不会显著影响 DPO？', 'kind': 'proposal', 'status': 'seed'})
for p in (rag, selfrag):
    if idea.get('id') and p:
        call('POST', f"/ideas/{idea['id']}/papers", {'paper_id': p['id'], 'relation': '相关工作' if p is rag else '基线'})
if idea.get('id') and selfrag:
    call('POST', f"/ideas/{idea['id']}/reread", {'paper_id': selfrag['id'], 'criteria': '弄清它的「是否检索」判断用的是什么信号'})

# ───────── 本周目标、周任务、日任务 ─────────
call('PUT', f'/week/{monday.isoformat()}', {'focus': '把 RAG 错误归因从想法变成可执行的标注方案', 'conclusions': '检索失败和生成失败需要分开统计，混在一起看不出改进方向。'})
g1 = call('POST', '/goals', {'week_id': monday.isoformat(), 'title': '读完 3 篇 RAG 近期工作并写对比笔记', 'project_id': proj.get('id'), 'weight': 2,
                             'criteria': '每篇写清楚：何时检索、检索失败时怎么办'}) or {}
g2 = call('POST', '/goals', {'week_id': monday.isoformat(), 'title': '完成开题报告第二章初稿', 'weight': 2, 'due_date': (monday + timedelta(days=4)).isoformat()}) or {}
g3 = call('POST', '/goals', {'week_id': monday.isoformat(), 'title': '课程作业 3'}) or {}
if g3.get('id'):
    call('PATCH', f"/goals/{g3['id']}", {'status': 'done'})
for title in ['读 Self-RAG 方法部分', '整理三篇论文的对比表', '写一页错误归因方案']:
    gt = call('POST', '/goal-tasks', {'goal_id': g1.get('id'), 'title': title}) or {}
    if gt.get('id') and title.startswith('整理'):
        call('POST', f"/goal-tasks/{gt['id']}/schedule", {'date': D(1)})
gt2 = call('POST', '/goal-tasks', {'goal_id': g2.get('id'), 'title': '第二章：相关工作'}) or {}

for back in range(1, min(today.weekday(), 4) + 1):
    d = D(-back)
    t1 = call('POST', '/tasks', {'date': d, 'title': '读 RAG 实验部分', 'goal_id': g1.get('id'), 'points': 2, 'paper_ids': [rag['id']] if rag else []}) or {}
    t2 = call('POST', '/tasks', {'date': d, 'title': '开题报告：写相关工作', 'goal_id': g2.get('id'), 'points': 3}) or {}
    call('POST', f'/day/{d}/checkin', {'plan_note': '读论文 + 写开题'})
    for t in (t1, t2):
        if t.get('id') and (back % 2 or t is t1):
            call('PATCH', f"/tasks/{t['id']}", {'status': 'done'})
    base = now - timedelta(days=back)
    for t, a, b in ((t1, 6, 4.5), (t2, 3, 1.2)):
        if t.get('id'):
            call('POST', '/sessions', {'start_at': (base - timedelta(hours=a)).isoformat(), 'end_at': (base - timedelta(hours=b)).isoformat(), 'task_id': t['id']})
    call('PUT', f'/day/{d}', {'review': '方法部分读完了，实验设置还需要再看一遍。', 'mood': 4, 'energy': 3})

ta = call('POST', '/tasks', {'date': D(0), 'title': '精读 Self-RAG §3', 'goal_id': g1.get('id'), 'points': 2, 'paper_ids': [selfrag['id']] if selfrag else []}) or {}
tb = call('POST', '/tasks', {'date': D(0), 'title': '开题报告：第二章小结', 'goal_id': g2.get('id'), 'points': 3, 'criteria': '写出三类方法的对比'}) or {}
tc = call('POST', '/tasks', {'date': D(0), 'title': '回复合作者邮件', 'points': 1}) or {}
call('POST', f'/day/{D(0)}/checkin', {'plan_note': '1. 精读 Self-RAG 方法\n2. 写开题第二章'})
call('POST', '/tasks', {'date': D(0), 'title': '临时：帮同学看一段代码', 'points': 1})
if tc.get('id'):
    call('PATCH', f"/tasks/{tc['id']}", {'status': 'done'})
if ta.get('id'):
    call('POST', '/sessions', {'start_at': (now - timedelta(hours=3)).isoformat(), 'end_at': (now - timedelta(hours=1, minutes=50)).isoformat(), 'task_id': ta['id']})
    call('POST', '/time-blocks', {'task_id': ta['id'], 'date': D(0), 'start_minute': 9 * 60, 'end_minute': 10 * 60 + 30, 'client_key': uuid.uuid4().hex})
if tb.get('id'):
    call('POST', '/time-blocks', {'task_id': tb['id'], 'date': D(0), 'start_minute': 14 * 60, 'end_minute': 16 * 60, 'client_key': uuid.uuid4().hex})
    call('POST', '/timer/start', {'task_id': tb['id']})
call('POST', '/background-timer/start', {'label': '实验：跑检索基线'})

# ───────── 日程 ─────────
until = (today + timedelta(days=42)).isoformat()
call('POST', '/calendar/events', {'title': '组会', 'date': (monday + timedelta(days=2)).isoformat(), 'kind': 'meeting', 'all_day': False, 'start_time': '10:00', 'end_time': '11:00',
                                  'location': '实验室', 'client_key': 'demo-' + uuid.uuid4().hex, 'recurrence': {'frequency': 'weekly', 'interval': 1, 'weekdays': [3], 'until': until}})
call('POST', '/calendar/events', {'title': '机器学习理论', 'date': (monday + timedelta(days=1)).isoformat(), 'kind': 'course', 'all_day': False, 'start_time': '14:00', 'end_time': '15:30',
                                  'client_key': 'demo-' + uuid.uuid4().hex, 'recurrence': {'frequency': 'weekly', 'interval': 1, 'weekdays': [2, 4], 'until': until}})
call('POST', '/calendar/events', {'title': '健身', 'date': monday.isoformat(), 'kind': 'checkin', 'all_day': False, 'start_time': '19:00', 'end_time': '20:00',
                                  'client_key': 'demo-' + uuid.uuid4().hex, 'recurrence': {'frequency': 'weekly', 'interval': 1, 'weekdays': [1, 3, 5], 'until': until}})
call('POST', '/calendar/events', {'title': '和导师 1:1', 'date': D(2), 'kind': 'meeting', 'all_day': False, 'start_time': '16:00', 'end_time': '16:30', 'client_key': 'demo-' + uuid.uuid4().hex})

# ───────── 投稿 ─────────
confs = (call('GET', '/conferences') or {}).get('conferences', [])
target = next((c for c in confs if any(m.get('stage') == 'submission' and m.get('date', '') >= today.isoformat() for m in c.get('milestones') or [])), None)
if target:
    call('PATCH', f"/conferences/{target['key']}", {'base_version': target.get('version', 0), 'pinned': True, 'followed': True, 'planned': True, 'project_id': proj.get('id')})

# ───────── 信息流与收件箱 ─────────
ft = call('POST', '/feeds/tasks', {'name': '每周论文速递', 'runner': 'manual', 'schedule': '每周一', 'cadence_days': 7, 'sources': 'arXiv cs.CL、cs.IR'}) or {}
if ft.get('id'):
    call('POST', '/feeds/runs', {'task_id': ft['id'], 'run_key': 'demo-' + D(0), 'status': 'success', 'items': [{'title': f'每周论文速递 {D(0)}', 'date': D(0), 'content':
         '## 本周要点\n\n1. **检索增强**：多篇工作讨论「何时检索」——见 https://arxiv.org/abs/2310.11511\n'
         '2. **推理**：搜索式推理的新基准 https://arxiv.org/abs/2305.10601\n3. **反馈学习**：用文字反馈改进下一次尝试 https://arxiv.org/abs/2303.11366\n\n> 小结：本周值得精读的是第 1 条。'}]})
call('POST', '/feeds/tasks', {'name': '每日新闻简报', 'runner': 'chatgpt', 'schedule': '每天 08:00', 'cadence_days': 1, 'sources': 'ChatGPT 定时任务', 'bridge_key': 'daily_news'})
call('POST', '/captures', {'content': '想法：把「拒答」也算进评测指标，单看准确率会鼓励模型乱答。'})
call('POST', '/captures', {'content': 'https://arxiv.org/abs/2312.10997 组会上有人提到的综述，回头看看'})

print('示例数据已写入' + ('' if not warnings else f'（{len(warnings)} 处跳过）'))
for w in warnings:
    print('  跳过：', w)
