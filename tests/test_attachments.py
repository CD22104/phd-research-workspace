"""Attachments (Idea / paper / note) against an isolated localhost D1 only.

用法：scripts/dev-test-server.sh <临时目录> 8806 & ; python3 tests/test_attachments.py http://127.0.0.1:8806
"""
import base64, hashlib, json, os, sys, unittest, urllib.error, urllib.parse, urllib.request, uuid
BASE = sys.argv.pop(1) if len(sys.argv) > 1 else 'http://127.0.0.1:8806'
assert urllib.parse.urlparse(BASE).hostname in ('localhost', '127.0.0.1')


def call(method, path, data=None, status=200, actor='web', csrf=True, headers=None):
    h = {'Content-Type': 'application/json', 'X-Actor': actor, **(headers or {})}
    if csrf:
        h['X-Requested-With'] = 'attachment-test'
    req = urllib.request.Request(BASE + '/api' + path, method=method, headers=h, data=json.dumps(data).encode() if data is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            code, out = r.status, json.load(r)
    except urllib.error.HTTPError as e:
        code, out = e.code, json.load(e)
    if status is None:
        return code, out
    assert code == status, (method, path, code, out)
    return out


def download(aid, status=200):
    req = urllib.request.Request(f'{BASE}/api/attachments/{aid}/download', headers={'X-Actor': 'web'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        assert e.code == status, (aid, e.code)
        return e.code, dict(e.headers), e.read()


def make_paper(prefix):
    title = f'{prefix} {uuid.uuid4().hex[:8]}'
    call('POST', '/papers', {'title': title, 'stage': 'library', 'enrich': False}, 201)
    rows = call('GET', '/papers')['papers']
    return next(r['id'] for r in rows if r['title'] == title)


def upload(owner_type, owner_id, name, data, actor='web', status=201, **extra):
    return call('POST', '/attachments', {'owner_type': owner_type, 'owner_id': owner_id, 'filename': name, 'data_base64': base64.b64encode(data).decode(), **extra}, status, actor=actor)


class Attachments(unittest.TestCase):
    def setUp(self):
        self.idea = call('POST', '/ideas', {'title': 'Attachment idea ' + uuid.uuid4().hex[:6], 'kind': 'proposal', 'content': '正文'}, 201)

    def test_upload_list_download_roundtrip(self):
        data = os.urandom(120_000) + b'PK\x03\x04'
        a = upload('idea', self.idea['id'], '实验结果 汇总.xlsx', data, content_type='')
        self.assertEqual(a['size'], len(data))
        self.assertEqual(a['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(a['content_type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        listed = call('GET', f"/attachments?owner_type=idea&owner_id={self.idea['id']}")['attachments']
        self.assertEqual([x['id'] for x in listed], [a['id']])
        self.assertNotIn('data', listed[0])
        detail = call('GET', f"/ideas/{self.idea['id']}")
        self.assertEqual([x['id'] for x in detail['attachments']], [a['id']])
        code, headers, body = download(a['id'])
        self.assertEqual(code, 200)
        self.assertEqual(body, data)
        self.assertIn("filename*=UTF-8''" + urllib.parse.quote('实验结果 汇总.xlsx'), headers['Content-Disposition'])
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')

    def test_multi_chunk_file_and_size_limits(self):
        data = os.urandom(3 * 1024 * 1024 + 17)  # 约 4MB base64，分成多块
        a = upload('idea', self.idea['id'], 'big.bin', data)
        self.assertEqual(download(a['id'])[2], data)
        code, out = upload('idea', self.idea['id'], 'too-big.bin', b'0' * (10 * 1024 * 1024 + 1), status=None)
        self.assertEqual(code, 400)
        self.assertIn('上限', out['error'])
        upload('idea', self.idea['id'], 'empty.txt', b'', status=400)
        call('POST', '/attachments', {'owner_type': 'idea', 'owner_id': self.idea['id'], 'filename': 'x.txt', 'data_base64': '%%%'}, 400)
        call('POST', '/attachments', {'owner_type': 'project', 'owner_id': 1, 'filename': 'x.txt', 'data_base64': 'aGk='}, 400)
        upload('idea', 99999999, 'x.txt', b'hi', status=404)
        call('POST', '/attachments', {'owner_type': 'idea', 'owner_id': self.idea['id'], 'filename': '', 'data_base64': 'aGk='}, 400)

    def test_duplicate_upload_saved_once_and_name_sanitized(self):
        data = b'same content'
        a = upload('idea', self.idea['id'], '../../etc/passwd.txt', data)
        self.assertNotIn('/', a['filename'])
        b = call('POST', '/attachments', {'owner_type': 'idea', 'owner_id': self.idea['id'], 'filename': '../../etc/passwd.txt', 'data_base64': base64.b64encode(data).decode()}, 200)
        self.assertTrue(b['duplicate'])
        self.assertEqual(b['id'], a['id'])
        key = uuid.uuid4().hex
        h = {'Idempotency-Key': key}
        payload = {'owner_type': 'idea', 'owner_id': self.idea['id'], 'filename': 'retry.txt', 'data_base64': base64.b64encode(b'retry').decode()}
        first = call('POST', '/attachments', payload, 201, headers=h)
        again = call('POST', '/attachments', payload, 201, headers=h)
        self.assertEqual(first['id'], again['id'])
        names = [x['filename'] for x in call('GET', f"/attachments?owner_type=idea&owner_id={self.idea['id']}")['attachments']]
        self.assertEqual(names.count('retry.txt'), 1)

    def test_unsafe_types_download_as_binary(self):
        a = upload('idea', self.idea['id'], 'page.html', b'<script>alert(1)</script>', content_type='text/html')
        _, headers, _ = download(a['id'])
        self.assertEqual(headers['Content-Type'], 'application/octet-stream')
        self.assertIn('sandbox', headers['Content-Security-Policy'])
        p = upload('idea', self.idea['id'], 'paper.pdf', b'%PDF-1.4 test')
        self.assertEqual(download(p['id'])[1]['Content-Type'], 'application/pdf')

    def test_delete_needs_confirm_outside_web(self):
        a = upload('idea', self.idea['id'], 'keep.csv', b'a,b\n1,2\n', actor='mcp')
        self.assertEqual(a['actor'], 'mcp')
        code, out = call('DELETE', f"/attachments/{a['id']}", status=None, actor='mcp')
        self.assertEqual(code, 409)
        self.assertTrue(out['data']['needs_confirm'])
        self.assertEqual(out['data']['preview']['filename'], 'keep.csv')
        self.assertEqual(download(a['id'])[0], 200)
        call('DELETE', f"/attachments/{a['id']}?confirm=1", actor='mcp')
        download(a['id'], status=404)
        b = upload('idea', self.idea['id'], 'web.csv', b'x')
        call('DELETE', f"/attachments/{b['id']}")
        self.assertEqual(call('GET', f"/attachments?owner_type=idea&owner_id={self.idea['id']}")['attachments'], [])
        changes = call('GET', '/changes?entity=attachment')['changes']
        self.assertTrue(any(c['entity_id'] == a['id'] and c['op'] == 'delete' for c in changes))
        call('DELETE', '/attachments/99999999', status=404)
        call('POST', '/attachments', {'owner_type': 'idea', 'owner_id': self.idea['id'], 'filename': 'x.txt', 'data_base64': 'aGk='}, 403, csrf=False)

    def test_owner_deletion_cascades(self):
        pid = make_paper('Attachment paper')
        note = call('POST', '/notes', {'paper_id': pid, 'title': 'n', 'content': 'x'}, 201)
        pa = upload('paper', pid, 'paper.pdf', b'%PDF paper')
        na = upload('note', note['id'], 'note.png', b'\x89PNG note')
        self.assertEqual([x['id'] for x in call('GET', f'/papers/{pid}')['attachments']], [pa['id']])
        self.assertEqual([x['id'] for x in call('GET', f"/notes/{note['id']}")['attachments']], [na['id']])
        code, out = call('DELETE', f'/papers/{pid}', status=None, actor='mcp')
        self.assertEqual(code, 409)
        self.assertEqual(out['data']['preview']['attachments'], 2)
        call('DELETE', f'/papers/{pid}')
        download(pa['id'], status=404)
        download(na['id'], status=404)
        ia = upload('idea', self.idea['id'], 'idea.txt', b'idea')
        code, out = call('DELETE', f"/ideas/{self.idea['id']}", status=None, actor='mcp')
        self.assertEqual(out['data']['preview']['attachments'], 1)
        call('DELETE', f"/ideas/{self.idea['id']}")
        download(ia['id'], status=404)
        n2 = call('POST', '/notes', {'idea_id': call('POST', '/ideas', {'title': 'tmp'}, 201)['id'], 'content': 'y'}, 201)
        a2 = upload('note', n2['id'], 'n2.txt', b'n2')
        call('DELETE', f"/notes/{n2['id']}")
        download(a2['id'], status=404)

    def test_paper_merge_moves_attachments(self):
        aid, bid = make_paper('Merge source'), make_paper('Merge target')
        att = upload('paper', aid, 'moved.pdf', b'%PDF moved')
        call('POST', f'/papers/{aid}/merge-into/{bid}', {'confirm': True})
        self.assertEqual([x['id'] for x in call('GET', f'/papers/{bid}')['attachments']], [att['id']])
        self.assertEqual(download(att['id'])[2], b'%PDF moved')

    def test_import_undo_keeps_papers_with_attachments(self):
        title = f'Undo keep {uuid.uuid4().hex[:8]}'
        r = call('POST', '/papers', {'title': title, 'stage': 'library', 'enrich': False}, 201)
        pid = r['created'][0]
        att = upload('paper', pid, 'keep.pdf', b'%PDF keep')
        out = call('POST', f"/sources/{r['source_id']}/undo", {})
        self.assertTrue(any(k['id'] == pid and '附件' in k['why'] for k in out.get('kept', [])), out)
        self.assertEqual(call('GET', f'/papers/{pid}')['paper']['id'], pid)
        self.assertEqual(download(att['id'])[2], b'%PDF keep')

    def test_export_includes_metadata_and_content(self):
        data = b'export me'
        a = upload('idea', self.idea['id'], 'export.txt', data)
        out = call('GET', '/export')
        self.assertGreaterEqual(out['schema_version'], 15)
        meta = next(r for r in out['tables']['attachments'] if r['id'] == a['id'])
        self.assertEqual(meta['sha256'], hashlib.sha256(data).hexdigest())
        chunks = sorted((r for r in out['tables']['attachment_chunks'] if r['attachment_id'] == a['id']), key=lambda r: r['seq'])
        self.assertEqual(base64.b64decode(''.join(r['data'] for r in chunks)), data)


if __name__ == '__main__':
    unittest.main(verbosity=2)
