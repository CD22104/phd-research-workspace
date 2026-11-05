#!/usr/bin/env python3
"""把这份模板配置成你自己的实例（只改本地文件，不访问 Cloudflare，也不读取任何凭证）。

用法：python3 scripts/configure_instance.py --project alice-research --timezone Asia/Shanghai
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'instance.json'
SKIP = {'node_modules', '.git', 'dist', '.wrangler', 'backups'}
TEXT = {'.ts', '.js', '.mjs', '.py', '.sh', '.vue', '.md', '.json', '.yaml', '.swift', '.plist', '.toml'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True, help='你的 Cloudflare Pages 项目名，例如 alice-research')
    parser.add_argument('--timezone', default='Asia/Singapore', help='例如 Asia/Shanghai、Europe/London')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,49}', args.project) or args.project.endswith('-') or args.project == 'choose-project-name':
        parser.error('项目名使用 3–50 位小写字母、数字、短横线；字母开头，不以短横线结尾。请换成你自己的名字。')
    try:
        ZoneInfo(args.timezone)
    except ZoneInfoNotFoundError:
        parser.error('时区不存在，例如 Asia/Shanghai 或 Asia/Singapore。')
    current = json.loads(CONFIG.read_text())
    toml = (ROOT / 'wrangler.toml').read_text()
    database_id = re.search(r'^database_id\s*=\s*"([^"]+)"', toml, re.M)
    if database_id and database_id[1] != '00000000-0000-0000-0000-000000000000':
        parser.error('这个副本已经绑定了远程数据库。请在全新的模板里初始化，避免改坏现有实例。')
    old_project, old_host = current['project'], current['site_url'].removeprefix('https://')
    project, new_host = args.project, args.project + '.pages.dev'

    # 先算好所有改动，再一次写入，避免中途失败留下一半新一半旧的配置
    changes = {}
    for key in ['name', 'database_name']:
        toml = re.sub(r'^' + key + r'\s*=\s*"[^"]*"', key + ' = "' + project + '"', toml, flags=re.M)
    toml = re.sub(r'^TIMEZONE\s*=\s*"[^"]*"', 'TIMEZONE = "' + args.timezone + '"', toml, flags=re.M)
    changes[ROOT / 'wrangler.toml'] = toml
    for path in ROOT.rglob('*'):
        if not path.is_file() or SKIP & set(path.relative_to(ROOT).parts) or path.suffix not in TEXT or path.name in ('wrangler.toml', 'instance.json'):
            continue
        text = path.read_text(encoding='utf-8')
        new = text.replace(old_host, new_host)
        if path.name == 'Info.plist':
            new = new.replace('dev.research-workspace.' + old_project, 'dev.research-workspace.' + project)
        if new != text:
            changes[path] = new
    changes[CONFIG] = json.dumps({'project': project, 'site_url': 'https://' + new_host, 'timezone': args.timezone}, indent=2) + '\n'
    for path, text in changes.items():
        path.write_text(text, encoding='utf-8')
    subprocess.run([sys.executable, str(ROOT / 'scripts/package_macos.py')], cwd=ROOT, check=True)
    print(f'本地配置完成：{project}（时区 {args.timezone}），更新了 {len(changes)} 个文件')
    print(f'部署后服务令牌会保存到 ~/.config/{project}/service-tokens.env')
    print('下一步：按 README 配置你自己的 Cloudflare 账户，然后运行 scripts/cf_setup.py。')


if __name__ == '__main__':
    main()
