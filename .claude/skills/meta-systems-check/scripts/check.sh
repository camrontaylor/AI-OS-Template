#!/usr/bin/env bash
# meta-systems-check / check.sh
# Plain-English health check for an AI-OS install. READ-ONLY: it changes nothing,
# it only looks and reports. Runs all checks, then prints a scorecard grouped by
# severity. Always exits 0 so the calling skill can read the full output.
set -o pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
DEEP=0
DEEP_TIMEOUT="${AI_OS_DEEP_TIMEOUT_SECONDS:-240}"

for arg in "$@"; do
  case "$arg" in
    --deep)
      DEEP=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash .claude/skills/meta-systems-check/scripts/check.sh [--deep]

Read-only AI-OS health check. Normal mode avoids expensive tests. --deep also
runs Command Centre cron tests and build.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

CRIT=(); WARN=(); OKAY=(); INFO=()
crit(){ CRIT+=("$1"); }
warn(){ WARN+=("$1"); }
okay(){ OKAY+=("$1"); }
info(){ INFO+=("$1"); }

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$seconds" "$@" <<'PY'
import os
import signal
import subprocess
import sys

timeout = int(sys.argv[1])
cmd = sys.argv[2:]
try:
    proc = subprocess.Popen(cmd, start_new_session=True)
    sys.exit(proc.wait(timeout=timeout))
except subprocess.TimeoutExpired:
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=5)
    except Exception:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except Exception:
            pass
    sys.exit(124)
PY
  elif command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    "$@"
  fi
}

# 1. Node runtime (Command Centre + cron need it)
if command -v node >/dev/null 2>&1; then
  okay "Node is installed ($(node -v))."
else
  crit "Node is not installed. Install Node 18 or newer; the dashboard and cron need it."
fi

# 2. Command Centre dependencies (better-sqlite3 powers cron + the dashboard)
if [ -d "$ROOT/command-centre/node_modules/better-sqlite3" ]; then
  okay "Command Centre dependencies are installed."
else
  crit "Command Centre dependencies are missing. Fix: cd command-centre && npm install"
fi

# 3. Onboarding command present
if [ -f "$ROOT/.claude/commands/onboarding.md" ]; then
  okay "Onboarding command is present (/onboarding)."
else
  warn "Onboarding command is missing (.claude/commands/onboarding.md); new users cannot run /onboarding."
fi

# 4. Nightly cron daemon (macOS launchd)
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.aios.cron-daemon.plist"
  if [ -f "$PLIST" ]; then
    if launchctl print "gui/$(id -u)/com.aios.cron-daemon" >/dev/null 2>&1; then
      okay "Nightly cron daemon is loaded and running."
    else
      warn "Cron plist exists but the daemon is not loaded. Fix: bash scripts/enable-cron.sh"
    fi
  else
    info "Nightly memory jobs are off (optional). Turn on: claude setup-token, then bash scripts/enable-cron.sh <token>"
  fi
else
  info "Cron daemon check skipped (not macOS)."
fi

# 5. Semantic memory (memsearch)
if command -v memsearch >/dev/null 2>&1; then
  okay "Semantic memory (memsearch) is installed."
else
  info "Semantic memory is not set up (optional). Enable: bash scripts/setup-memory.sh"
fi

# 6. API keys: documented in .env.example vs exported in this process.
# Do not read .env or any credential-bearing file.
if [ -f "$ROOT/.env.example" ]; then
  total=0; missing=0; exported=0
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    total=$((total+1))
    if [ -n "${!key-}" ]; then
      exported=$((exported+1))
    else
      missing=$((missing+1))
    fi
  done < <(grep -oE '^[A-Z][A-Z0-9_]*=' "$ROOT/.env.example" 2>/dev/null | sed 's/=$//' | sort -u)
  if [ "$total" -gt 0 ]; then
    if [ "$missing" -eq 0 ]; then
      okay "All $total documented API keys are exported in this process."
    else
      info "$missing of $total documented API keys are not exported in this process; secrets files were not read. See .env.example."
    fi
  fi
else
  info ".env.example not found; skipping the API key check."
fi

# 7. Connector readiness: static, read-only checks only.
if [ -f "$ROOT/docs/connectors.md" ]; then
  okay "Connector map is present (docs/connectors.md)."
else
  warn "Connector map is missing. Add docs/connectors.md so MCP/API/Desktop connector state has one source of truth."
fi

if [ -f "$ROOT/.claude/skills/ops-agent-email/scripts/agentmail.py" ] \
   && [ -f "$ROOT/.env.example" ] \
   && grep -q '^AGENTMAIL_API_KEY=' "$ROOT/.env.example" 2>/dev/null; then
  okay "AgentMail connector files are present and documented. Live key not checked."
else
  warn "AgentMail is not fully documented or its script is missing. Re-auth flows may fail."
fi

if [ -f "$ROOT/scripts/notion-sync/notion_sync.py" ] \
   && [ -f "$ROOT/.env.example" ] \
   && grep -q '^NOTION_API_KEY=' "$ROOT/.env.example" 2>/dev/null; then
  okay "Notion API sync files are present and documented. Live connector access not checked."
else
  info "Notion API sync is not fully configured in the repo."
fi
if [ -f "$ROOT/context/MEMORY.md" ] \
   && grep -qiE 'NOTION RESOURCE SYNC BLOCKED|object_not_found|notion.*blocked' "$ROOT/context/MEMORY.md" 2>/dev/null; then
  warn "Memory notes a Notion resource sync blocker; live connector/API access should be rechecked before relying on Notion sync."
fi

if [ -f "$ROOT/.claude/skills/ops-client-dashboard/scripts/status.sh" ]; then
  if [ -d "$HOME/.agent-browser/profiles/client-dashboard" ]; then
    okay "Client dashboard shared browser profile exists."
  else
    info "Client dashboard skill is present, but the shared browser profile was not found. Re-auth may be needed."
  fi
else
  info "Client dashboard skill status script not found."
fi

# 8. Brand context: has onboarding been run? (ignore README + _templates)
real_brand=$(ls "$ROOT/brand_context"/*.md 2>/dev/null | grep -viE "/README\.md$" | wc -l | tr -d ' ')
if [ "${real_brand:-0}" -gt 0 ]; then
  okay "Brand context is set up ($real_brand brand file(s))."
else
  info "Brand is not set up yet. Run /onboarding to build voice, positioning, and audience."
fi

# 9. Client folders complete (each needs AGENTS.md, CLAUDE.md, .claude/commands)
if [ -d "$ROOT/clients" ]; then
  for c in "$ROOT"/clients/*/; do
    [ -d "$c" ] || continue
    name="$(basename "$c")"
    for need in "AGENTS.md" "CLAUDE.md" ".claude/commands"; do
      if [ ! -e "$c$need" ]; then
        warn "Client '$name' is missing $need (re-run add-client, or copy it from the root)."
      fi
    done
  done
fi

# 10. Git backup remote
maintainer="${IS_TEMPLATE_MAINTAINER:-}"
origin="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
if [ "$maintainer" = "true" ]; then
  okay "Template-maintainer mode; backup remote check skipped."
elif [ -z "$origin" ]; then
  warn "No backup remote set. Your data is local only; one machine failure loses it."
elif echo "$origin" | grep -qiE "simonc602/agentic-os"; then
  warn "Backups point at the template repo, not your own. Create a private repo and set it as origin."
else
  okay "Backed up to your own remote ($origin)."
fi

# 11. VERSION vs CHANGELOG
if [ -f "$ROOT/VERSION" ] && [ -f "$ROOT/CHANGELOG.md" ]; then
  ver="$(tr -d '[:space:]' < "$ROOT/VERSION")"
  if grep -qE "^## (v)?${ver}([^0-9]|$)" "$ROOT/CHANGELOG.md" 2>/dev/null; then
    okay "Version $ver matches the changelog."
  else
    info "VERSION is $ver but the changelog has no matching heading (unreleased work ahead)."
  fi
fi

# 12. MEMORY.md budget (2500-char cap)
if [ -f "$ROOT/context/MEMORY.md" ]; then
  chars=$(wc -c < "$ROOT/context/MEMORY.md" | tr -d ' ')
  if [ "${chars:-0}" -gt 2500 ]; then
    warn "MEMORY.md is $chars chars, over the 2500 cap. Consolidate it."
  elif [ "${chars:-0}" -gt 2000 ]; then
    info "MEMORY.md is $chars/2500 chars; getting full, consolidate soon."
  else
    okay "MEMORY.md is $chars/2500 chars."
  fi
fi

# 13. Claude settings.json is valid JSON (broken JSON drops hooks + permissions)
if [ -f "$ROOT/.claude/settings.json" ]; then
  if command -v python3 >/dev/null 2>&1 && python3 -c "import json; json.load(open('$ROOT/.claude/settings.json'))" 2>/dev/null; then
    okay "Claude settings.json is valid JSON."
  elif command -v node >/dev/null 2>&1 && node -e "JSON.parse(require('fs').readFileSync('$ROOT/.claude/settings.json','utf8'))" 2>/dev/null; then
    okay "Claude settings.json is valid JSON."
  else
    crit "Claude settings.json is not valid JSON. Hooks and permissions may not load."
  fi
fi

# 14. Deep Command Centre checks. Kept out of normal startup because these can be slow.
if [ "$DEEP" -eq 1 ]; then
  if [ -f "$ROOT/command-centre/package.json" ]; then
    if [ -d "$ROOT/command-centre/node_modules" ]; then
      (cd "$ROOT/command-centre" && run_with_timeout "$DEEP_TIMEOUT" npm run test:cron)
      deep_status=$?
      if [ "$deep_status" -eq 0 ]; then
        okay "Deep check passed: Command Centre cron/runtime tests."
      elif [ "$deep_status" -eq 124 ]; then
        crit "Deep check timed out after ${DEEP_TIMEOUT}s: cd command-centre && npm run test:cron"
      else
        crit "Deep check failed: cd command-centre && npm run test:cron"
      fi
      (cd "$ROOT/command-centre" && run_with_timeout "$DEEP_TIMEOUT" npm run build)
      deep_status=$?
      if [ "$deep_status" -eq 0 ]; then
        okay "Deep check passed: Command Centre build."
      elif [ "$deep_status" -eq 124 ]; then
        crit "Deep check timed out after ${DEEP_TIMEOUT}s: cd command-centre && npm run build"
      else
        crit "Deep check failed: cd command-centre && npm run build"
      fi
    else
      crit "Deep check skipped: command-centre/node_modules is missing. Fix: cd command-centre && npm install"
    fi
  else
    info "Deep check skipped: command-centre/package.json not found."
  fi
else
  info "Deep Command Centre checks skipped. Run with --deep to execute npm run test:cron and npm run build."
fi

# ---- Report ----
print_section(){
  local title="$1"; shift
  [ "$#" -eq 0 ] && return
  echo "$title"
  for m in "$@"; do echo "  - $m"; done
  echo ""
}

echo "AI-OS Systems Check"
echo "==================="
echo "Checked: $ROOT"
echo ""
[ "${#CRIT[@]}" -gt 0 ] && print_section "CRITICAL (fix before relying on the system):" "${CRIT[@]}"
[ "${#WARN[@]}" -gt 0 ] && print_section "WARNINGS (worth addressing):" "${WARN[@]}"
[ "${#INFO[@]}" -gt 0 ] && print_section "INFO (optional / for awareness):" "${INFO[@]}"
[ "${#OKAY[@]}" -gt 0 ] && print_section "OK:" "${OKAY[@]}"

echo "Summary: ${#CRIT[@]} critical, ${#WARN[@]} warnings, ${#INFO[@]} info, ${#OKAY[@]} OK."
if [ "${#CRIT[@]}" -gt 0 ]; then
  echo "Status: NEEDS ATTENTION"
else
  echo "Status: HEALTHY"
fi
exit 0
