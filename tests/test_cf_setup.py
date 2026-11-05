"""部署脚本回归测试；不访问真实 Cloudflare、不读取密钥。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

spec = importlib.util.spec_from_file_location('cf_setup', Path(__file__).resolve().parents[1] / 'scripts/cf_setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
if getattr(setup, 'PROJECT_NAME', None) == 'choose-project-name':
    setup.PROJECT_NAME = 'test-project'
CONF = {'HONEY_URL': 'https://choose-project-name.pages.dev', 'MCP_CLIENT_ID': 'mcp-id', 'MCP_CLIENT_SECRET': 'mcp-secret',
        'GPT_CLIENT_ID': 'gpt-id', 'GPT_CLIENT_SECRET': 'gpt-secret'}


def response(body, content_type='application/json', status=200):
    r = io.BytesIO(body.encode())
    r.status = status
    r.headers = {'Content-Type': content_type}
    return r


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(contextlib.redirect_stdout(self.output))

    def probe_with(self, result, anonymous=False, path='/api/health'):
        opener = Mock()
        if isinstance(result, Exception):
            opener.open.side_effect = result
        else:
            opener.open.return_value = result
        with patch.object(setup.urllib.request, 'build_opener', return_value=opener):
            return setup.probe('choose-project-name.pages.dev', path, anonymous=anonymous)

    def test_login_html_is_not_api_success(self):
        self.assertFalse(self.probe_with(response('<html>Login</html>', 'text/html'))[0])

    def test_auth_redirect_is_only_success_for_anonymous_requests(self):
        for anonymous in (False, True):
            error = urllib.error.HTTPError('url', 302, 'Redirect', {
                'Location': 'https://team.cloudflareaccess.com/cdn-cgi/access/login/choose-project-name.pages.dev'}, None)
            self.assertEqual(self.probe_with(error, anonymous)[0], anonymous)

    def test_arbitrary_redirect_and_public_page_fail_anonymous_check(self):
        error = urllib.error.HTTPError('url', 302, 'Redirect', {'Location': 'https://example.org/login'}, None)
        self.assertFalse(self.probe_with(error, True)[0])
        self.assertFalse(self.probe_with(response('<html>Private app</html>', 'text/html'), True)[0])

    def test_malformed_or_error_json_is_not_healthy(self):
        for body in ('not json', '{}', '[]', '{"ok":false}', '{"ok":1}'):
            with self.subTest(body=body):
                self.assertFalse(self.probe_with(response(body))[0])
        self.assertTrue(self.probe_with(response('{"ok":true}'))[0])

    def test_database_response_required(self):
        for body, expected in [('{"papers":[]}', True), ('{"error":"no such table"}', False)]:
            self.assertEqual(self.probe_with(response(body), path='/api/papers?stage=candidate')[0], expected)

    def test_network_failure_is_reported(self):
        self.assertFalse(self.probe_with(urllib.error.URLError('offline'))[0])

    def test_failed_verification_exits_nonzero_and_does_not_print_secrets(self):
        with patch.object(setup, 'probe', return_value=(False, 'HTTP 403')):
            with self.assertRaisesRegex(SystemExit, '验收失败'):
                setup.verify('choose-project-name.pages.dev', CONF, attempts=1)
        for key in ('MCP_CLIENT_SECRET', 'GPT_CLIENT_SECRET'):
            self.assertNotIn(CONF[key], self.output.getvalue())

    def test_verification_checks_both_credentials_and_retries(self):
        with patch.object(setup, 'probe', side_effect=[(False, 'HTTP 503')] * 6 + [(True, '通过')] * 6) as probe:
            with patch.object(setup.time, 'sleep') as sleep:
                setup.verify('choose-project-name.pages.dev', CONF, attempts=2)
        sleep.assert_called_once_with(5)
        calls = probe.call_args_list[6:]
        self.assertEqual(calls[2].args[2]['CF-Access-Client-Id'], 'mcp-id')
        gpt = json.loads(calls[4].args[2]['Authorization'])
        self.assertEqual(gpt['cf-access-client-id'], 'gpt-id')
        self.assertEqual(calls[3].args[1], '/api/papers?stage=candidate')
        self.assertEqual(calls[5].args[1], '/api/papers?stage=candidate')

    def test_missing_config_fails_before_network(self):
        with patch.object(setup, 'read_conf', return_value={}), patch.object(setup, 'cf') as cf:
            with patch.object(setup, 'TOKEN', 'test'), patch.object(setup, 'ACCOUNT', 'test'):
                with patch.object(setup.sys, 'argv', ['cf_setup.py', '--deploy-only']):
                    with self.assertRaisesRegex(SystemExit, 'HONEY_URL'):
                        setup.main()
        cf.assert_not_called()

    def test_verify_only_does_not_require_account_credentials(self):
        with patch.object(setup, 'TOKEN', None), patch.object(setup, 'ACCOUNT', None):
            with patch.object(setup, 'read_conf', return_value=CONF), patch.object(setup, 'verify') as verify:
                with patch.object(setup, 'cf') as cf, patch.object(setup, 'sh') as sh:
                    with patch.object(setup.sys, 'argv', ['cf_setup.py', '--verify-only']):
                        setup.main()
        verify.assert_called_once_with('choose-project-name.pages.dev', CONF)
        cf.assert_not_called()
        sh.assert_not_called()

    def run_update(self, sh):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'wrangler.toml').write_text('database_id = "11111111-1111-1111-1111-111111111111"\n')
            with contextlib.ExitStack() as stack:
                for name, value in [('ROOT', root), ('TOKEN', 'test'), ('ACCOUNT', 'test'), ('sh', sh)]:
                    stack.enter_context(patch.object(setup, name, value))
                stack.enter_context(patch.object(setup, 'read_conf', return_value=CONF))
                stack.enter_context(patch.object(setup, 'check', return_value=True))
                stack.enter_context(patch.object(setup, 'cf', return_value={'subdomain': 'choose-project-name.pages.dev'}))
                verify = stack.enter_context(patch.object(setup, 'verify'))
                stack.enter_context(patch.object(setup.sys, 'argv', ['cf_setup.py', '--deploy-only']))
                setup.main()
                return verify

    def test_update_runs_migrations_before_deploy(self):
        sh = Mock()
        self.run_update(sh)
        cmds = [c.args for c in sh.call_args_list]
        migration = ('npx', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote')
        self.assertIn(migration, cmds)
        self.assertLess(cmds.index(('npx', 'vite', 'build')), cmds.index(migration))
        self.assertLess(cmds.index(migration), next(i for i, c in enumerate(cmds) if c[:4] == ('npx', 'wrangler', 'pages', 'deploy')))

    def test_failed_migration_never_deploys(self):
        def run(*args):
            if 'migrations' in args:
                raise SystemExit('migration failed')
        sh = Mock(side_effect=run)
        with self.assertRaisesRegex(SystemExit, 'migration failed'):
            self.run_update(sh)
        self.assertFalse(any(c.args[:4] == ('npx', 'wrangler', 'pages', 'deploy') for c in sh.call_args_list))
        self.assertNotIn('完成：https', self.output.getvalue())


if __name__ == '__main__':
    unittest.main()
