#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="${TMPDIR:-/tmp}/aios-notion-resource-health-test"
SERVER_PID=""
MOCK_PORT=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok() { printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %s${NC}\n" "$1" >&2; exit 1; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }

make_workspace() {
  rm -rf "$TEST_ROOT"
  mkdir -p "$TEST_ROOT/repo/context" "$TEST_ROOT/repo/projects/system-health"
  cat > "$TEST_ROOT/repo/context/MEMORY.md" <<'EOF'
# Working Memory

## Active Threads
- Existing item.
EOF
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] || fail "Missing file: $file"
  grep -Fq "$expected" "$file" || fail "Expected '$expected' in $file"
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  [[ -f "$file" ]] || fail "Missing file: $file"
  ! grep -Fq "$unexpected" "$file" || fail "Did not expect '$unexpected' in $file"
}

start_mock_server() {
  local mode="$1"
  local port_file="$TEST_ROOT/port.txt"
  local server_py="$TEST_ROOT/server.py"
  cat > "$server_py" <<'PY'
import http.server
import json
import os
import pathlib
import socketserver

MODE = os.environ["MOCK_NOTION_MODE"]
PORT_FILE = pathlib.Path(os.environ["MOCK_NOTION_PORT_FILE"])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        _ = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0"))
        if MODE == "success":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "results": [{
                    "properties": {
                        "Name": {"type": "title", "title": [{"plain_text": "Queued Test"}]},
                        "Status": {"type": "status", "status": {"name": "Queued"}}
                    }
                }],
                "has_more": False
            }).encode("utf-8"))
            return
        self.send_response(403)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "object": "error",
            "code": "restricted_resource",
            "message": "Integration does not have access to this database."
        }).encode("utf-8"))

    def log_message(self, *_args):
        return

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as httpd:
    PORT_FILE.write_text(str(httpd.server_address[1]), encoding="utf-8")
    httpd.serve_forever()
PY
  MOCK_NOTION_MODE="$mode" MOCK_NOTION_PORT_FILE="$port_file" python3 "$server_py" &
  SERVER_PID="$!"
  for _ in $(seq 1 50); do
    [[ -f "$port_file" ]] && break
    sleep 0.1
  done
  [[ -f "$port_file" ]] || fail "Mock Notion server did not start"
  MOCK_PORT="$(cat "$port_file")"
}

stop_mock_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}

test_missing_key_blocks() {
  make_workspace
  if env -u NOTION_API_KEY \
    AI_OS_DIR="$TEST_ROOT/repo" \
    AI_KEYS_ENV_FILE="$TEST_ROOT/missing.env" \
    AI_OS_NOTION_HEALTH_REPORT_DATE="2026-01-01" \
    bash "$REAL_REPO/scripts/notion-resource-health.sh" --no-memory --quiet >/tmp/aios-notion-health.out 2>&1; then
    fail "Expected missing NOTION_API_KEY to fail"
  fi

  assert_file_contains "$TEST_ROOT/repo/projects/system-health/2026-01-01_notion-resource-health.md" "Status: BLOCKED"
  assert_file_contains "$TEST_ROOT/repo/projects/system-health/2026-01-01_notion-resource-health.md" "Error class: \`missing_api_key\`"
  ok "missing NOTION_API_KEY writes BLOCKED report and exits non-zero"
}

test_success_from_env_file() {
  make_workspace
  start_mock_server success
  printf 'NOTION_API_KEY=secret-token\n' > "$TEST_ROOT/keys.env"

  env -u NOTION_API_KEY \
    AI_OS_DIR="$TEST_ROOT/repo" \
    AI_KEYS_ENV_FILE="$TEST_ROOT/keys.env" \
    AI_OS_NOTION_HEALTH_API_BASE="http://127.0.0.1:${MOCK_PORT}" \
    AI_OS_NOTION_HEALTH_REPORT_DATE="2026-01-02" \
    bash "$REAL_REPO/scripts/notion-resource-health.sh" --no-memory --quiet >/tmp/aios-notion-health.out

  assert_file_contains "$TEST_ROOT/repo/projects/system-health/2026-01-02_notion-resource-health.md" "Status: OK"
  # Count only, NEVER row content: echoing the first row's title/Status into
  # the report is exactly how a real password leaked onto the autosave path
  # (2026-07-16 audit, MYOB incident). The report must prove reachability
  # without reproducing data.
  assert_file_contains "$TEST_ROOT/repo/projects/system-health/2026-01-02_notion-resource-health.md" "Row count returned:"
  assert_file_not_contains "$TEST_ROOT/repo/projects/system-health/2026-01-02_notion-resource-health.md" "Queued Test"
  stop_mock_server
  ok "env-file NOTION_API_KEY can query Notion and writes OK report"
}

test_permission_failure_blocks() {
  make_workspace
  start_mock_server forbidden
  printf 'NOTION_API_KEY=secret-token\n' > "$TEST_ROOT/keys.env"

  if env -u NOTION_API_KEY \
    AI_OS_DIR="$TEST_ROOT/repo" \
    AI_KEYS_ENV_FILE="$TEST_ROOT/keys.env" \
    AI_OS_NOTION_HEALTH_API_BASE="http://127.0.0.1:${MOCK_PORT}" \
    AI_OS_NOTION_HEALTH_REPORT_DATE="2026-01-03" \
    bash "$REAL_REPO/scripts/notion-resource-health.sh" --quiet >/tmp/aios-notion-health.out 2>&1; then
    fail "Expected Notion permission failure to fail"
  fi

  assert_file_contains "$TEST_ROOT/repo/projects/system-health/2026-01-03_notion-resource-health.md" "Status: BLOCKED"
  assert_file_contains "$TEST_ROOT/repo/projects/system-health/2026-01-03_notion-resource-health.md" "Error class: \`restricted_resource\`"
  assert_file_contains "$TEST_ROOT/repo/context/MEMORY.md" "**NOTION BLOCKER (2026-01-03):**"
  stop_mock_server
  ok "Notion permission failure writes BLOCKED report, updates memory, and exits non-zero"
}

test_claude_wrapper_loads_env_file_before_oauth() {
  make_workspace
  local fake_claude="$TEST_ROOT/fake-claude.sh"
  local keys_file="$TEST_ROOT/keys.env"

  cat > "$fake_claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${CLAUDE_CODE_OAUTH_TOKEN:-}" == "oauth-token" ]] || exit 11
[[ "${NOTION_API_KEY:-}" == "notion-secret" ]] || exit 12
printf 'wrapper env ok\n'
EOF
  chmod +x "$fake_claude"
  printf 'NOTION_API_KEY=notion-secret\n' > "$keys_file"

  output="$(
    env -u NOTION_API_KEY \
      _AIOS_CAFFEINATED=1 \
      CLAUDE_CODE_OAUTH_TOKEN="oauth-token" \
      AI_KEYS_ENV_FILE="$keys_file" \
      REAL_CLAUDE_BIN="$fake_claude" \
      bash "$REAL_REPO/scripts/claude-cron-wrapper.sh"
  )"

  [[ "$output" == "wrapper env ok" ]] || fail "Claude cron wrapper did not pass env-file keys through OAuth path"
  ok "Claude cron wrapper loads env-file keys before OAuth fast path"
}

info "Running Notion resource health tests..."
test_claude_wrapper_loads_env_file_before_oauth
test_missing_key_blocks
test_success_from_env_file
test_permission_failure_blocks
ok "Notion resource health tests passed"
