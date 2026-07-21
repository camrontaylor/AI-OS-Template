#!/usr/bin/env bash
# Create a new client workspace under clients/.
# Usage: bash scripts/add-client.sh "Client Name"

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/add-client.sh \"Client Name\""
  echo ""
  echo "Creates a client workspace under clients/ with skills, scripts,"
  echo "and empty directories for brand context, memory, and projects."
  exit 1
fi

CLIENT_NAME="$1"

# Convert to slug: lowercase, spaces to hyphens, strip non-alphanumeric
CLIENT_SLUG=$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')

CLIENT_DIR="${PROJECT_DIR}/clients/${CLIENT_SLUG}"

if [[ -d "$CLIENT_DIR" ]]; then
  echo "Error: Client folder already exists: clients/${CLIENT_SLUG}/"
  echo "To start over, remove it first and re-run this script."
  exit 1
fi

echo "Creating client workspace: clients/${CLIENT_SLUG}/"

create_client_agents_file() {
  local target="$1"
  local client_name="$2"
  cat > "$target" <<EOF
# Client: ${client_name}

Add client-specific instructions here. These layer on top of the root AGENTS.md instructions - they don't replace them.

## Client-Specific Instructions

-

## Notes

-
EOF
}

create_client_claude_wrapper() {
  local target="$1"
  cat > "$target" <<'EOF'
# CLAUDE.md

This file keeps Claude Code compatible with the client-specific instructions in `AGENTS.md`.

@AGENTS.md
EOF
}

create_memory_scaffold() {
  local target="$1"
  cat > "$target" <<'EOF'
<!-- Cap: 2,500 chars. Client-scoped curated scratchpad. -->
# Working Memory

## Active Threads

## Environment Notes

## Pending Decisions
EOF
}

create_client_cron_proxy_scripts() {
  local scripts_dir="$1"

  cat > "${scripts_dir}/start-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENTIC_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/start-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/stop-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENTIC_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/stop-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/status-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENTIC_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/status-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/logs-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENTIC_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/logs-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/run-job.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CLIENT_SLUG="$(basename "$(cd "$(dirname "$0")/.." && pwd)")"
AGENTIC_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/run-job.sh" "$@" --client "$CLIENT_SLUG"
EOF

  cat > "${scripts_dir}/start-crons.ps1" <<'EOF'
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$RootScript = Join-Path $RootProjectDir "scripts\start-crons.ps1"
$env:AGENTIC_OS_DIR = $RootProjectDir

& $RootScript @Arguments
EOF

  cat > "${scripts_dir}/stop-crons.ps1" <<'EOF'
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$RootScript = Join-Path $RootProjectDir "scripts\stop-crons.ps1"
$env:AGENTIC_OS_DIR = $RootProjectDir

& $RootScript @Arguments
EOF

  cat > "${scripts_dir}/status-crons.ps1" <<'EOF'
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$RootScript = Join-Path $RootProjectDir "scripts\status-crons.ps1"
$env:AGENTIC_OS_DIR = $RootProjectDir

& $RootScript @Arguments
EOF

  cat > "${scripts_dir}/logs-crons.ps1" <<'EOF'
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$RootScript = Join-Path $RootProjectDir "scripts\logs-crons.ps1"
$env:AGENTIC_OS_DIR = $RootProjectDir

& $RootScript @Arguments
EOF

  cat > "${scripts_dir}/run-job.ps1" <<'EOF'
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$ClientSlug = Split-Path -Leaf (Split-Path -Parent $PSScriptRoot)
$RootScript = Join-Path $RootProjectDir "scripts\run-job.ps1"
$env:AGENTIC_OS_DIR = $RootProjectDir

$ForwardedArguments = @()
if ($Arguments) {
    $ForwardedArguments += $Arguments
}
$ForwardedArguments += @("--client", $ClientSlug)

& $RootScript @ForwardedArguments
EOF

  chmod +x \
    "${scripts_dir}/start-crons.sh" \
    "${scripts_dir}/stop-crons.sh" \
    "${scripts_dir}/status-crons.sh" \
    "${scripts_dir}/logs-crons.sh" \
    "${scripts_dir}/run-job.sh"
}

# Create directory structure
mkdir -p "${CLIENT_DIR}/brand_context"
mkdir -p "${CLIENT_DIR}/context/inbox"
mkdir -p "${CLIENT_DIR}/context/intake/review"
mkdir -p "${CLIENT_DIR}/context/intake/parked"
mkdir -p "${CLIENT_DIR}/context/memory"
mkdir -p "${CLIENT_DIR}/context/reference"
mkdir -p "${CLIENT_DIR}/projects"
mkdir -p "${CLIENT_DIR}/cron/jobs"
mkdir -p "${CLIENT_DIR}/cron/logs"
mkdir -p "${CLIENT_DIR}/cron/status"
mkdir -p "${CLIENT_DIR}/cron/templates"

# Seed optional starter files from an AI-OS-owned template folder. The live
# clients/ folder stays user-owned; templates/client/ is the upstream starter.
if [[ -d "${PROJECT_DIR}/templates/client" ]]; then
  cp -R "${PROJECT_DIR}/templates/client/." "${CLIENT_DIR}/"
  echo "  Seeded client starter templates"
fi

# Link skills from root (symlink, never copy - copies drift; see AGENTS.md Skill
# Publishing). Each shared skill is a symlink back to the one root copy. Client-
# unique skills are added later as real folders and are never touched here.
if [[ -d "${PROJECT_DIR}/.claude/skills" ]]; then
  mkdir -p "${CLIENT_DIR}/.claude/skills"
  for root_skill in "${PROJECT_DIR}/.claude/skills"/*/; do
    [[ -f "$root_skill/SKILL.md" ]] || continue
    skill_name=$(basename "$root_skill")
    ln -s "../../../../.claude/skills/${skill_name}" "${CLIENT_DIR}/.claude/skills/${skill_name}"
  done
  for shared_meta in _catalog _archived; do
    if [[ -d "${PROJECT_DIR}/.claude/skills/${shared_meta}" ]]; then
      ln -s "../../../../.claude/skills/${shared_meta}" "${CLIENT_DIR}/.claude/skills/${shared_meta}"
    fi
  done
  echo "  Linked skills"
fi

# Link slash commands from root (symlink) so /onboarding etc. work in the client
if [[ -d "${PROJECT_DIR}/.claude/commands" ]]; then
  mkdir -p "${CLIENT_DIR}/.claude"
  ln -s "../../../.claude/commands" "${CLIENT_DIR}/.claude/commands"
  echo "  Linked commands"
fi

# Link Claude Code settings from root. Tool-specific state belongs outside this
# shared file; a copied settings file drifts as hooks and permissions evolve.
if [[ -f "${PROJECT_DIR}/.claude/settings.json" ]]; then
  ln -s "../../../.claude/settings.json" "${CLIENT_DIR}/.claude/settings.json"
  echo "  Linked Claude Code settings"
fi

# Copy hooks_info if it exists (required by hooks in settings.json)
if [[ -d "${PROJECT_DIR}/.claude/hooks_info" ]]; then
  mkdir -p "${CLIENT_DIR}/.claude/hooks_info"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude 'ccnotify.db' \
      --exclude 'ccnotify.log*' \
      --exclude 'footer-misses.log' \
      "${PROJECT_DIR}/.claude/hooks_info/" "${CLIENT_DIR}/.claude/hooks_info/"
  else
    find "${PROJECT_DIR}/.claude/hooks_info" -maxdepth 1 -type f \
      ! -name 'ccnotify.db' \
      ! -name 'ccnotify.log*' \
      ! -name 'footer-misses.log' \
      -exec cp -p {} "${CLIENT_DIR}/.claude/hooks_info/" \;
  fi
  echo "  Copied hooks_info"
fi

# Link hooks from root (symlink, shared for every client)
if [[ -d "${PROJECT_DIR}/.claude/hooks" ]]; then
  ln -s "../../../.claude/hooks" "${CLIENT_DIR}/.claude/hooks"
  echo "  Linked hooks"
fi

# Link shared scripts from root (symlink, never copy). The client-specific cron
# proxy scripts differ from root, so they are written as real files afterward and
# must NOT be symlinked - hence the skip list below.
mkdir -p "${CLIENT_DIR}/scripts"
for root_entry in "${PROJECT_DIR}/scripts"/*; do
  entry_name=$(basename "$root_entry")
  case "$entry_name" in
    start-crons.sh|stop-crons.sh|status-crons.sh|logs-crons.sh|run-job.sh|\
    start-crons.ps1|stop-crons.ps1|status-crons.ps1|logs-crons.ps1|run-job.ps1) continue ;;
  esac
  ln -s "../../../scripts/${entry_name}" "${CLIENT_DIR}/scripts/${entry_name}"
done
create_client_cron_proxy_scripts "${CLIENT_DIR}/scripts"
echo "  Linked scripts (shared root scripts symlinked; client cron proxies real)"

# Link shared cron templates from root.
if [[ -d "${PROJECT_DIR}/cron/templates" ]]; then
  rmdir "${CLIENT_DIR}/cron/templates"
  ln -s "../../../cron/templates" "${CLIENT_DIR}/cron/templates"
  echo "  Linked cron templates"
fi

# Create client hot memory scaffold if missing
if [[ ! -f "${CLIENT_DIR}/context/MEMORY.md" ]]; then
  create_memory_scaffold "${CLIENT_DIR}/context/MEMORY.md"
  echo "  Created MEMORY.md"
fi

# Create client instruction files
create_client_agents_file "${CLIENT_DIR}/AGENTS.md" "${CLIENT_NAME}"
echo "  Created client AGENTS.md"

create_client_claude_wrapper "${CLIENT_DIR}/CLAUDE.md"
echo "  Created client CLAUDE.md wrapper"

# Seed learnings from root (so clients start with accumulated knowledge)
if [[ -f "${PROJECT_DIR}/context/learnings.md" ]]; then
  cp "${PROJECT_DIR}/context/learnings.md" "${CLIENT_DIR}/context/learnings.md"
  echo "  Seeded learnings.md from root (will diverge per-client from here)"
else
  cat > "${CLIENT_DIR}/context/learnings.md" <<LEARNINGS
# Learnings

## General

### What works well

### What doesn't work well

## Individual Skills
LEARNINGS
  echo "  Created learnings.md"
fi

# Create .gitkeep files to preserve empty directories
touch "${CLIENT_DIR}/brand_context/.gitkeep"
touch "${CLIENT_DIR}/context/inbox/.gitkeep"
touch "${CLIENT_DIR}/context/intake/review/.gitkeep"
touch "${CLIENT_DIR}/context/intake/parked/.gitkeep"
touch "${CLIENT_DIR}/context/memory/.gitkeep"
touch "${CLIENT_DIR}/context/reference/.gitkeep"
touch "${CLIENT_DIR}/projects/.gitkeep"
touch "${CLIENT_DIR}/cron/jobs/.gitkeep"

# Do NOT copy the root .env into the client. That duplicated every secret into every
# client folder (a drift and leak risk). Clients inherit shared keys from the root .env
# at runtime; the client .env is for client-specific overrides only.
if [[ -f "${PROJECT_DIR}/.env" ]]; then
  printf '# Client-specific overrides only. Shared keys are inherited from the root .env.\n# Add CLIENT_SPECIFIC_VAR=value lines here only if this client needs its own value.\n' > "${CLIENT_DIR}/.env"
  echo "  Created clients/${CLIENT_SLUG}/.env (overrides only; shared keys inherited from root)"
fi

echo ""
echo "Client workspace ready: clients/${CLIENT_SLUG}/"
echo ""
echo "Next steps:"
echo "  cd ${PROJECT_DIR}/clients/${CLIENT_SLUG}"
echo "  claude"
echo "  Claude will automatically walk you through building the brand foundation."
