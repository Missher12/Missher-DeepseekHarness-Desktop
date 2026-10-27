#!/bin/bash
# Install the community Intel macOS updater as a per-user LaunchAgent.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/dsh-community-updater"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT="$AGENT_DIR/com.missher.dsh-community-updater.plist"
LABEL="com.missher.dsh-community-updater"
DOMAIN="gui/$(id -u)"
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

[ -f "$SRC/update.sh" ] || { echo "update.sh not found beside install.sh" >&2; exit 1; }
[ -f "$SRC/com.missher.dsh-community-updater.plist" ] || { echo "plist template not found" >&2; exit 1; }

mkdir -p "$DEST" "$AGENT_DIR" "$HOME/Library/Logs"
cp "$SRC/update.sh" "$DEST/update.sh"
cp "$SRC/uninstall.sh" "$DEST/uninstall.sh"
cp "$SRC/README.md" "$DEST/README.md"
chmod 755 "$DEST/update.sh" "$DEST/uninstall.sh"
sed "s#__HOME__#${HOME}#g" "$SRC/com.missher.dsh-community-updater.plist" >"$AGENT"
plutil -lint "$AGENT" >/dev/null

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run: copied updater to $DEST and generated $AGENT; launchctl unchanged"
  exit 0
fi

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$AGENT"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

cat <<EOF
Installed $LABEL
- updater: $DEST/update.sh
- agent:   $AGENT
- log:     $HOME/Library/Logs/dsh-community-updater.log
- launchd: $HOME/Library/Logs/dsh-community-updater.launchd.log
- interval: 7200 seconds (runs immediately on load)

Inspect:
  launchctl print $DOMAIN/$LABEL
  tail -n 100 "$HOME/Library/Logs/dsh-community-updater.log"

Dry run:
  DSH_UPDATER_DRY_RUN=1 "$DEST/update.sh"

Uninstall:
  "$DEST/uninstall.sh"  (or run uninstall.sh from this checkout)
EOF
