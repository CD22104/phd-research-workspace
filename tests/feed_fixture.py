"""接口测试用：确保信息流里有三个已绑定 ChatGPT 归档编号的测试任务（已存在就跳过）。
只对本地临时测试库运行。用法：python3 tests/feed_fixture.py http://127.0.0.1:8807
"""
import json
import sys
import urllib.request

BASE = sys.argv[1].rstrip('/')
assert '127.0.0.1' in BASE or 'localhost' in BASE, '只允许对本地测试服务器运行'
# (归档编号, 任务名称, 曾用名（作为别名）, 是否开启到期提醒)
TASKS = [
    ('daily_news', '每日新闻', '新闻日报', True),
    ('field_frontier', '领域前沿', None, False),
    ('research_brief', '研究简报', '研究简报（旧名）', True),
]


def call(method, path, body=None):
    req = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', 'X-Requested-With': 'fixture', 'X-Actor': 'script'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b'{}')


bound = {t.get('bridge_key') for t in call('GET', '/feeds')['tasks']}
for key, name, alias, remind in TASKS:
    if key in bound:
        continue
    # 先用曾用名建任务并绑定，再改成现在的名字：两个名字都会成为别名
    t = call('POST', '/feeds/tasks', {'name': alias or name, 'runner': 'chatgpt', 'description': '测试用归档任务', 'bridge_key': key})
    if alias:
        call('PATCH', f'/feeds/tasks/{t["id"]}', {'name': name})
        if alias != name and key == 'research_brief':
            call('PATCH', f'/feeds/tasks/{t["id"]}', {'name': alias})
            call('PATCH', f'/feeds/tasks/{t["id"]}', {'name': name})
    call('PATCH', f'/feeds/tasks/{t["id"]}', {'expected_time': '10:30', 'expected_enabled': remind})
print('测试任务已就绪')
