#!/usr/bin/env python3
"""Package only the reviewed Mac app source and installer; no credentials or build files."""
from pathlib import Path
import plistlib
import zipfile
root = Path(__file__).resolve().parents[1]
source = root / 'macos' / 'ResearchTimer'
plistlib.loads((source / 'Info.plist').read_bytes())
output = root / 'web/public/downloads/research-timer-macos.zip'
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ('ResearchTimer.swift', 'Info.plist', 'bridge.js', '安装.command', 'README.md'):
        archive.write(source / name, 'ResearchTimer/' + name)
print(f'已打包 5 个源码与安装文件：{output.relative_to(root)}')
