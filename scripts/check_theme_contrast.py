#!/usr/bin/env python3
"""检查每套皮肤里主要文字与背景的对比度（WCAG）。正文 ≥ 4.5，占位符 / 大号数字 ≥ 3，热力图首档对卡片 ≥ 2。
用法：check_theme_contrast.py        有不达标的项时退出码为 1。
"""
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / 'web' / 'src'
PAIRS = [  # (前景, 背景, 最低对比度, 说明)
    ('ink', 'card', 4.5, '正文'), ('ink-2', 'card', 4.5, '次要文字'), ('ink-3', 'card', 4.5, '提示文字'),
    ('ink-3', 'surface-warm', 4.5, '页面底色上的提示文字'), ('placeholder', 'card', 3, '输入框占位'),
    ('accent-deep', 'card', 4.5, '链接'), ('on-accent', 'accent', 4.5, '主按钮'), ('danger', 'card', 4.5, '错误 / 紧急'),
    ('sidebar-ink', 'sidebar-bg', 4.5, '侧栏文字'), ('sidebar-muted', 'sidebar-bg', 4.5, '侧栏小字'),
    ('sidebar-active-ink', 'sidebar-active-bg', 4.5, '侧栏当前页'), ('sidebar-hover-ink', 'sidebar-hover', 4.5, '侧栏悬停'),
    ('capture-ink', 'capture-bg', 4.5, '随手记按钮'), ('text-on-dark', 'charcoal', 4.5, '计时卡文字'),
    ('muted-on-dark', 'charcoal', 4.5, '计时卡小字'), ('sand', 'charcoal', 3, '计时数字'),
    ('read-ink', 'read-bg', 4.5, '已读行'), ('read-muted', 'read-bg', 4.5, '已读行小字'),
    ('group-ink', 'group-bg', 4.5, '论文组标题'), ('group-muted', 'group-bg', 4.5, '论文组小字'),
    ('accent-deep', 'leaf-soft', 4.5, '绿色标签'), ('pill-sky-ink', 'sky-soft', 4.5, '灰蓝标签'), ('pill-tigger-ink', 'surface-sand', 4.5, '沙色标签'),
    ('pill-eeyore-ink', 'eeyore-soft', 4.5, '灰色标签'), ('pill-berry-ink', 'pill-berry-bg', 4.5, '红色标签'), ('read-ink', 'read-pill-bg', 4.5, '已读标签'),
    ('text-on-dark', 'piglet', 4.5, '深色标签'), ('ink', 'ev-checkin-bg', 4.5, '日程：打卡'), ('ink', 'ev-break-bg', 4.5, '日程：休息'),
    ('ink', 'ev-meeting-bg', 4.5, '日程：会议'), ('ink', 'ev-default-bg', 4.5, '日程：默认'), ('ink', 'block-bg', 4.5, '时间块'),
    ('ink', 'done-bg', 4.5, '已完成块'), ('ink', 'today-head', 4.5, '今天的日期栏'), ('ink-2', 'surface-soft', 4.5, '浅底次要文字'),
    ('ink', 'honey-mist', 4.5, '日程事件'), ('now-ink', 'card', 4.5, '当前时间'), ('chart-ramp-1', 'card', 2, '热力图第一档'),
]


def parse_block(css):
    return dict(re.findall(r'--([a-z0-9-]+)\s*:\s*([^;]+);', css))


def resolve(vals, name, depth=0):
    v = vals.get(name, '').strip()
    m = re.fullmatch(r'var\(--([a-z0-9-]+)\)', v)
    return resolve(vals, m.group(1), depth + 1) if m and depth < 10 else v


def lum(hex_):
    h = hex_.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    base_css = (WEB / 'style.css').read_text(encoding='utf-8')
    base = parse_block(re.search(r':root\s*\{([\s\S]*?)\n\}', base_css).group(1))
    themes = {'matcha': base}
    for tid, body in re.findall(r":root\[data-theme='([a-z]+)'\]\s*\{([\s\S]*?)\n\}", (WEB / 'themes.css').read_text(encoding='utf-8')):
        themes[tid] = {**base, **parse_block(body)}
    failed = 0
    for tid, vals in themes.items():
        worst = []
        for fg, bg, need, label in PAIRS:
            a, b = resolve(vals, fg), resolve(vals, bg)
            if not (a.startswith('#') and b.startswith('#')):
                worst.append(f'  ? {label}：{fg}={a} / {bg}={b} 无法计算')
                continue
            r = ratio(a, b)
            if r < need:
                failed += 1
                worst.append(f'  ✗ {label}：{fg} {a} 对 {bg} {b} = {r:.2f}（需要 {need}）')
        lows = sorted((ratio(resolve(vals, f), resolve(vals, b)), l) for f, b, n, l in PAIRS if n == 4.5 and resolve(vals, f).startswith('#') and resolve(vals, b).startswith('#'))
        print(f'{tid}：最低 {lows[0][0]:.2f}（{lows[0][1]}）' + ('' if not worst else '\n' + '\n'.join(worst)))
    print('全部达标' if not failed else f'{failed} 项不达标')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
