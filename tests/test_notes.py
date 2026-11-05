"""Note detail page persistence. Use an isolated local database only."""
import json
import sys
import unittest
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlparse

BASE = sys.argv.pop(1) if len(sys.argv) > 1 and sys.argv[1].startswith('http') else 'http://127.0.0.1:18974'
if urlparse(BASE).hostname not in ('127.0.0.1', 'localhost'):
    raise SystemExit('These tests write records; use an isolated local server.')


def call(method, path, payload=None, expected=200):
    req = urllib.request.Request(BASE + '/api' + path, method=method,
        headers={'Content-Type': 'application/json', 'X-Requested-With': 'notes-test', 'X-Actor': 'web'},
        data=None if payload is None else json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            status, data = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, data = error.code, json.load(error)
    assert status == expected, (method, path, status, data)
    return data


class Notes(unittest.TestCase):
    def setUp(self):
        self.project = call('POST', '/projects', {'name': 'Notes ' + uuid.uuid4().hex}, 201)

    def test_long_markdown_roundtrip_and_context(self):
        content = '# Discussion\n\n' + ('## 实验\n\n公式 $E=mc^2$\n\n```py\nprint("ok")\n```\n\n' * 250)
        note = call('POST', '/notes', {'project_id': self.project['id'], 'title': '长笔记', 'content': content}, 201)
        fetched = call('GET', f"/notes/{note['id']}")
        self.assertEqual(fetched['content'], content)
        self.assertEqual(fetched['project_name'], self.project['name'])
        self.assertEqual(fetched['no_llm'], 1)
        updated = call('PATCH', f"/notes/{note['id']}", {'title': '修改后的标题', 'content': content + '\n末尾修改', 'base_version': note['version']})
        self.assertEqual(updated['version'], note['version'] + 1)
        reloaded = call('GET', f"/notes/{note['id']}")
        self.assertEqual(reloaded['content'], content + '\n末尾修改')
        project = call('GET', f"/projects/{self.project['id']}")
        self.assertEqual(next(n for n in project['notes'] if n['id'] == note['id'])['title'], '修改后的标题')

    def test_stale_save_preserves_other_edit(self):
        n = call('POST', '/notes', {'project_id': self.project['id'], 'content': 'initial'}, 201)
        call('PATCH', f"/notes/{n['id']}", {'content': 'other device', 'base_version': n['version']})
        conflict = call('PATCH', f"/notes/{n['id']}", {'content': 'stale draft', 'base_version': n['version']}, 409)
        self.assertEqual(conflict['data']['current']['content'], 'other device')
        self.assertEqual(call('GET', f"/notes/{n['id']}")['content'], 'other device')

    def test_paper_idea_context_and_version(self):
        paper = call('POST', '/papers', {'title': 'Paper ' + uuid.uuid4().hex, 'enrich': False}, 201)['created'][0]
        idea = call('POST', '/ideas', {'title': 'Idea for note'}, 201)
        n = call('POST', '/notes', {'paper_id': paper, 'idea_id': idea['id'], 'title': 'Reading', 'content': 'revision', 'no_llm': False}, 201)
        fetched = call('GET', f"/notes/{n['id']}")
        self.assertTrue(fetched['paper_title'].startswith('Paper '))
        self.assertEqual(fetched['idea_title'], 'Idea for note')
        self.assertEqual(fetched['no_llm'], 0)
        v = call('POST', '/versions', {'entity': 'note', 'entity_id': n['id'], 'label': '正式版本'}, 201)
        self.assertEqual(call('GET', f"/versions/{v['id']}")['content'], fetched['content'])

    def test_unknown_note_and_invalid_id(self):
        call('GET', '/notes/999999999', expected=404)
        call('GET', '/notes/not-an-id', expected=400)


if __name__ == '__main__':
    unittest.main()
