#!/bin/bash
# Community Intel macOS updater: download the newest community x64 build,
# verify its SHA-256, replace the installed app, and relaunch it.
set -euo pipefail

REPO="${DSH_UPDATER_REPO:-Missher12/Missher-DeepseekHarness-Desktop}"
APP="${DSH_UPDATER_APP_PATH:-/Applications/DeepSeek Harness.app}"
STATE_DIR="$HOME/Library/Application Support/dsh-community-updater"
LOG_DIR="$HOME/Library/Logs"
LOG="$LOG_DIR/dsh-community-updater.log"
LOCK_DIR="$STATE_DIR/lock"
DRY_RUN="${DSH_UPDATER_DRY_RUN:-0}"
QUIT_TIMEOUT="${DSH_UPDATER_QUIT_TIMEOUT:-30}"
RELEASES_JSON="${DSH_UPDATER_RELEASES_JSON:-}"
NO_LAUNCH="${DSH_UPDATER_NO_LAUNCH:-0}"

mkdir -p "$STATE_DIR" "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}

fail() {
  log "ERROR: $*"
  exit 1
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ]; then
    old_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$old_pid" ] && ! kill -0 "$old_pid" 2>/dev/null; then
      rm -rf "$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null || { log "another updater run is active; skipping"; exit 0; }
    else
      log "another updater run is active (pid ${old_pid:-unknown}); skipping"
      exit 0
    fi
  else
    log "another updater run is active; skipping"
    exit 0
  fi
fi
printf '%s\n' "$$" >"$LOCK_DIR/pid"

TMP=""
STAGE=""
BACKUP=""

cleanup() {
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
  rm -rf "$LOCK_DIR"
}

cleanup_stage() {
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then rm -rf "$STAGE"; fi
}

trap 'cleanup_stage; cleanup' EXIT
trap 'log "interrupted"; cleanup_stage; cleanup; exit 130' INT TERM

if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  tail -c 524288 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" || true
fi

[ -d "$APP" ] || fail "app not found: $APP"
[ -f "$APP/Contents/Info.plist" ] || fail "Info.plist not found: $APP"
[ -w /Applications ] || fail "/Applications is not writable by this user"

INSTALLED="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
[ -n "$INSTALLED" ] || fail "cannot read installed version"

log "checking installed=$INSTALLED repo=$REPO"

for tool in /usr/bin/curl /usr/bin/python3 /usr/bin/shasum /usr/bin/hdiutil /usr/bin/ditto /usr/bin/xattr; do
  [ -x "$tool" ] || fail "required tool missing: $tool"
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-updater.XXXXXX")"
JSON="$TMP/releases.json"

if [ -n "$RELEASES_JSON" ]; then
  cp "$RELEASES_JSON" "$JSON" || fail "cannot read DSH_UPDATER_RELEASES_JSON"
elif ! /usr/bin/curl -fsSL --retry 2 --max-time 30 \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: dsh-community-updater' \
  "https://api.github.com/repos/${REPO}/releases?per_page=30" -o "$JSON"; then
  fail "cannot fetch release list (network or rate limit)"
fi

SELECTION="$(/usr/bin/python3 - "$INSTALLED" "$JSON" <<'PY'
import json
import re
import sys

SEMVER = re.compile(r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$')


def key(value):
    match = SEMVER.match(value)
    if match is None:
        return None
    core = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
    pre = match.group(4)
    if pre is None:
        return (core, 1, ())
    parts = []
    for part in pre.split('.'):
        if part.isdigit():
            parts.append((0, int(part), ''))
        else:
            parts.append((1, 0, part))
    return (core, 0, tuple(parts))


installed = sys.argv[1]
try:
    with open(sys.argv[2], encoding='utf-8') as handle:
        releases = json.load(handle)
except Exception as error:
    sys.stderr.write('cannot read releases: %s\n' % error)
    sys.exit(3)
if not isinstance(releases, list):
    sys.stderr.write('release list is not an array\n')
    sys.exit(3)

candidates = []
for release in releases:
    if not isinstance(release, dict) or release.get('draft') is not False:
        continue
    tag = release.get('tag_name')
    if not isinstance(tag, str) or not tag.startswith('desktop-v'):
        continue
    version = tag[len('desktop-v'):]
    order = key(version)
    if order is None:
        continue
    assets = release.get('assets') or []
    dmg_name = dmg_url = sha_name = sha_url = None
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        name = asset.get('name')
        url = asset.get('browser_download_url')
        if not isinstance(name, str) or not isinstance(url, str):
            continue
        if name.endswith('-mac-x64-unsigned.dmg'):
            dmg_name, dmg_url = name, url
        elif name == 'SHA256SUMS':
            sha_name, sha_url = name, url
    if dmg_name and dmg_url and sha_name and sha_url:
        candidates.append((order, version, tag, dmg_name, dmg_url, sha_name, sha_url))

if not candidates:
    print('0\t\t\t\t\t\t')
    sys.exit(0)

candidates.sort(key=lambda item: item[0])
latest = candidates[-1]
installed_order = key(installed)
if installed_order is None:
    sys.stderr.write('invalid installed version: %s\n' % installed)
    sys.exit(4)
newer = 1 if latest[0] > installed_order else 0
print('\t'.join([str(newer), latest[1], latest[2], latest[4], latest[6], latest[3], latest[5]]))
PY
)" || fail "cannot select release"

IFS=$'\t' read -r NEWER LATEST TAG DMG_URL SHA_URL DMG_NAME SHA_NAME <<<"$SELECTION"

if [ -z "${LATEST:-}" ]; then
  log "no eligible community release (requires x64 DMG and SHA256SUMS)"
  exit 0
fi

if [ "$NEWER" != "1" ]; then
  log "up to date: installed=$INSTALLED latest=$LATEST"
  exit 0
fi

log "update available: installed=$INSTALLED latest=$LATEST tag=$TAG"

if [ "$DRY_RUN" = "1" ]; then
  log "dry run: would download $DMG_URL and install $DMG_NAME"
  exit 0
fi

DMG="$TMP/$DMG_NAME"
SUMS="$TMP/$SHA_NAME"

log "downloading $DMG_NAME"
/usr/bin/curl -fL --retry 3 --max-time 900 \
  -H 'User-Agent: dsh-community-updater' -o "$DMG" "$DMG_URL" \
  || fail "download failed: $DMG_NAME"
/usr/bin/curl -fL --retry 3 --max-time 60 \
  -H 'User-Agent: dsh-community-updater' -o "$SUMS" "$SHA_URL" \
  || fail "download failed: $SHA_NAME"

EXPECTED="$(grep -F "$DMG_NAME" "$SUMS" | awk '{print $1}' | head -1)"
ACTUAL="$(/usr/bin/shasum -a 256 "$DMG" | awk '{print $1}')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  fail "SHA-256 mismatch for $DMG_NAME"
fi
log "SHA-256 verified: $ACTUAL"

STAGE="/Applications/.DeepSeek Harness.app.new.$$"
BACKUP="/Applications/.DeepSeek Harness.app.backup.$$"
MNT="$TMP/mnt"
mkdir -p "$MNT"

trap 'cleanup_stage; cleanup' EXIT
trap 'log "interrupted"; cleanup_stage; cleanup; exit 130' INT TERM

log "mounting DMG"
/usr/bin/hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" >/dev/null \
  || fail "cannot mount $DMG_NAME"

SRC_APP=""
for candidate in "$MNT"/*.app; do
  if [ -d "$candidate" ]; then
    SRC_APP="$candidate"
    break
  fi
done
if [ -z "$SRC_APP" ]; then
  /usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1 || true
  fail "no .app found in DMG"
fi

log "staging $(basename "$SRC_APP")"
rm -rf "$STAGE"
if ! /usr/bin/ditto "$SRC_APP" "$STAGE"; then
  /usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1 || true
  fail "cannot stage app"
fi
/usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1 || /usr/bin/hdiutil detach -force "$MNT" >/dev/null 2>&1 || true
/usr/bin/xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true
STAGED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$STAGE/Contents/Info.plist" 2>/dev/null || true)"
if [ "$STAGED_VERSION" != "$LATEST" ]; then
  fail "DMG version ${STAGED_VERSION:-unknown} does not match release $LATEST"
fi

app_pids() {
  /usr/bin/pgrep -f "$APP/" 2>/dev/null || true
}

if [ -n "$(app_pids)" ]; then
  log "stopping all processes under $APP"
  /usr/bin/pkill -TERM -f "$APP/" 2>/dev/null || true
  waited=0
  while [ -n "$(app_pids)" ] && [ "$waited" -lt "$QUIT_TIMEOUT" ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if [ -n "$(app_pids)" ]; then
    log "app did not stop in ${QUIT_TIMEOUT}s; sending KILL"
    /usr/bin/pkill -KILL -f "$APP/" 2>/dev/null || true
    sleep 1
  fi
  [ -z "$(app_pids)" ] || fail "cannot stop running app"
fi

log "replacing $APP"
rm -rf "$BACKUP"
if ! mv "$APP" "$BACKUP"; then
  fail "cannot move current app aside"
fi
if ! mv "$STAGE" "$APP"; then
  log "install failed; restoring previous app"
  mv "$BACKUP" "$APP" 2>/dev/null || log "CRITICAL: cannot restore $APP from $BACKUP"
  fail "cannot move staged app into place"
fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
rm -rf "$BACKUP" 2>/dev/null || true

if [ "$NO_LAUNCH" = "1" ]; then
  log "updated installed=$INSTALLED -> $LATEST; launch skipped (DSH_UPDATER_NO_LAUNCH=1)"
  exit 0
fi
if ! /usr/bin/open "$APP"; then
  fail "installed $LATEST but cannot relaunch app"
fi
log "updated installed=$INSTALLED -> $LATEST; relaunched"
