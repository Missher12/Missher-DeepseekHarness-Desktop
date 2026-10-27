#!/bin/bash
# Remove the community Intel macOS updater LaunchAgent and its installed files.
set -euo pipefail

LABEL="com.missher.dsh-community-updater"
DOMAIN="gui/$(id -u)"
DEST="$HOME/Library/Application Support/dsh-community-updater"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
rm -f "$AGENT"
rm -rf "$DEST"

# Remove only our own temporary staging/backup directories, never the installed app.
rm -rf "/Applications/.DeepSeek Harness.app.new."* 2>/dev/null || true
rm -rf "/Applications/.DeepSeek Harness.app.backup."* 2>/dev/null || true

cat <<EOF
Removed $LABEL
- agent: $AGENT
- updater directory: $DEST
- logs were kept at: $HOME/Library/Logs/dsh-community-updater.log
EOF
