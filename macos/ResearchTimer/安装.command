#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(uname -s)" != Darwin ]]; then echo '请在 Mac 的终端中运行安装脚本。'; exit 1; fi
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo '需要 Apple Command Line Tools。请运行 xcode-select --install，安装完成后再次运行本脚本。'
  exit 1
fi
MAC_TIMER_BUILD=$(mktemp -d "${TMPDIR:-/tmp}/research-timer.XXXXXX")
trap 'rm -rf "$MAC_TIMER_BUILD"' EXIT
MAC_TIMER_APP="$MAC_TIMER_BUILD/Research Timer.app"
mkdir -p "$MAC_TIMER_APP/Contents/MacOS" "$MAC_TIMER_APP/Contents/Resources"
echo '正在编译菜单栏小工具…'
xcrun swiftc -swift-version 5 -O -framework AppKit -framework WebKit -target "$(uname -m)-apple-macosx12.0" ResearchTimer.swift -o "$MAC_TIMER_APP/Contents/MacOS/ResearchTimer"
cp Info.plist "$MAC_TIMER_APP/Contents/Info.plist"
cp bridge.js "$MAC_TIMER_APP/Contents/Resources/bridge.js"
codesign --force --sign - "$MAC_TIMER_APP"
codesign --verify "$MAC_TIMER_APP"
mkdir -p "$HOME/Applications"
MAC_TIMER_DEST="$HOME/Applications/Research Timer.app"
MAC_TIMER_EXECUTABLE="$MAC_TIMER_DEST/Contents/MacOS/ResearchTimer"

# Build successfully before closing the installed app. Never stop unrelated processes.
MAC_TIMER_PIDS=$(pgrep -x ResearchTimer || true)
for MAC_TIMER_PID in $MAC_TIMER_PIDS; do
  MAC_TIMER_COMMAND=$(ps -ww -p "$MAC_TIMER_PID" -o command= 2>/dev/null || true)
  if [[ "$MAC_TIMER_COMMAND" == "$MAC_TIMER_EXECUTABLE" || "$MAC_TIMER_COMMAND" == "$MAC_TIMER_EXECUTABLE "* ]]; then
    echo '正在退出旧版小工具以完成更新；网站计时与记录会保留。'
    kill -TERM "$MAC_TIMER_PID" 2>/dev/null || true
    for MAC_TIMER_WAIT in 1 2 3 4 5; do
      if ! kill -0 "$MAC_TIMER_PID" 2>/dev/null; then break; fi
      sleep 1
    done
    if kill -0 "$MAC_TIMER_PID" 2>/dev/null; then
      echo '旧版尚未退出，请在「活动监视器」中退出 ResearchTimer 后重新安装。'; exit 1
    fi
  elif [[ -n "$MAC_TIMER_COMMAND" ]]; then
    echo '另一个位置的 ResearchTimer 正在运行。请在「活动监视器」中退出它后重新安装。'; exit 1
  fi
done
MAC_TIMER_OLD=""
if [[ -e "$MAC_TIMER_DEST" ]]; then
  MAC_TIMER_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' Info.plist)
  MAC_TIMER_BACKUPS="$HOME/Library/Application Support/$MAC_TIMER_BUNDLE_ID/Backups"
  mkdir -p "$MAC_TIMER_BACKUPS"
  MAC_TIMER_BACKUP_DIR=$(mktemp -d "$MAC_TIMER_BACKUPS/update.XXXXXX")
  MAC_TIMER_OLD="$MAC_TIMER_BACKUP_DIR/Research Timer.app"
  mv "$MAC_TIMER_DEST" "$MAC_TIMER_OLD"
fi
if ! ditto "$MAC_TIMER_APP" "$MAC_TIMER_DEST"; then
  rm -rf "$MAC_TIMER_DEST"
  if [[ -n "$MAC_TIMER_OLD" ]]; then mv "$MAC_TIMER_OLD" "$MAC_TIMER_DEST"; fi
  echo '复制失败，已恢复旧版应用。请检查磁盘空间后重试。'; exit 1
fi
open -n "$MAC_TIMER_DEST"
echo '安装完成。窗口顶部应显示 v1.1.0；首次使用请登录网站。'
echo '若菜单栏没有计时，点击窗口上方「重新显示菜单栏」，或勾选「仅图标」。仍无显示时点击「复制诊断」。'
