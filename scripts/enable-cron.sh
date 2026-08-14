#!/usr/bin/env bash
# enable-cron.sh [CLAUDE_CODE_OAUTH_TOKEN]
#
# The ONE step that turns on the self-maintaining nightly memory jobs.
#
# First, get a long-lived token (interactive, needs your Claude subscription):
#     claude setup-token
# Copy the token it prints, then run:
#     bash scripts/enable-cron.sh <token>
#
# This stores the token (chmod 600), loads the durable launchd cron daemon, and
# runs a test job so you can see it succeed. Everything after `claude setup-token`
# is automated here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/node-runtime.sh"
TOKEN="${1:-}"
TOKEN_FILE="$HOME/.config/claude-code-oauth-token"
AI_KEYS_FILE="${AI_KEYS_ENV_FILE:-$HOME/.config/ai-keys.env}"
PLIST="$HOME/Library/LaunchAgents/com.aios.cron-daemon.plist"
LABEL="com.aios.cron-daemon"

if [[ -n "$TOKEN" ]]; then
  mkdir -p "$(dirname "$TOKEN_FILE")"
  printf '%s' "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "Stored token at $TOKEN_FILE (chmod 600)"
elif [[ -f "$TOKEN_FILE" ]]; then
  echo "Using existing token at $TOKEN_FILE"
else
  echo "No token given and none stored yet."
  echo "Run:  claude setup-token   then:  bash scripts/enable-cron.sh <token>"
  exit 1
fi

# Generate the launchd plist if it is missing. Nothing else in the repo creates it,
# and it is what makes the nightly jobs durable: launchd reloads the daemon on login.
if [[ ! -f "$PLIST" ]]; then
  NODE_BIN="$(aios_resolve_node "$REPO_ROOT")"
  NODE_DIR="$(dirname "$NODE_BIN")"
  CLAUDE_BIN="${REAL_CLAUDE_BIN:-$(command -v claude || echo /usr/local/bin/claude)}"
  WRAPPER="$SCRIPT_DIR/claude-cron-wrapper.sh"
  mkdir -p "$HOME/Library/LaunchAgents" "$REPO_ROOT/.command-centre"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$REPO_ROOT/scripts/cron/cron-daemon.cjs</string>
        <string>serve</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$REPO_ROOT/.command-centre/cron-daemon.out.log</string>
    <key>StandardErrorPath</key>
    <string>$REPO_ROOT/.command-centre/cron-daemon.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$NODE_DIR:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>GLOG_minloglevel</key>
        <string>3</string>
        <key>GRPC_VERBOSITY</key>
        <string>NONE</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>AI_OS_CLAUDE_BIN</key>
        <string>$WRAPPER</string>
        <key>REAL_CLAUDE_BIN</key>
        <string>$CLAUDE_BIN</string>
        <key>AI_KEYS_ENV_FILE</key>
        <string>$AI_KEYS_FILE</string>
    </dict>
</dict>
</plist>
PLIST_EOF
  chmod 644 "$PLIST"
  echo "Generated launchd plist: $PLIST"
fi

# Load or reload the daemon.
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "Reloading existing daemon..."
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  sleep 1
fi
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Cron daemon loaded (durable, starts on login)."

if [[ ! -f "$AI_KEYS_FILE" ]] || ! grep -qE '^(export[[:space:]]+)?NOTION_API_KEY=' "$AI_KEYS_FILE"; then
  echo ""
  echo "Notion resource jobs are not fully configured yet."
  echo "Missing key name: NOTION_API_KEY in $AI_KEYS_FILE"
  echo "Until that key is present, notion-resource-health will correctly report BLOCKED."
fi

sleep 2
echo ""
echo "--- scheduler status ---"
bash "$SCRIPT_DIR/status-crons.sh" 2>&1 | grep -iE "runtime|leader|pid|heartbeat" | head

echo ""
echo "--- test run: daily-memory-distill (proves auth works) ---"
# Run the test through the same wrapper the daemon uses AND pass the token directly,
# so this test reflects what the nightly job will actually do (the plain shell does
# not have AI_OS_CLAUDE_BIN set; only the launchd plist does).
AI_OS_CLAUDE_BIN="$SCRIPT_DIR/claude-cron-wrapper.sh" \
  CLAUDE_CODE_OAUTH_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")" \
  bash "$SCRIPT_DIR/run-job.sh" daily-memory-distill 2>&1 | tail -6
echo ""
echo "If the test shows result: success, your nightly memory jobs are LIVE and self-maintaining."
echo "Jobs: daily-memory-distill 23:00, nightly semantic index plus health 23:30."
