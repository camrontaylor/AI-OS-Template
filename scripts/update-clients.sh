#!/usr/bin/env bash
# Link shared runtime files from the root into all client workspaces.
# Run this after update.sh or after adding a shared skill. Shared methodology
# exists once at root; clients keep only their own data, instructions, cron
# proxies, runtime logs, and client-only skills.
# Usage: bash scripts/update-clients.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENTS_DIR="${PROJECT_DIR}/clients"
RUNTIME_BACKUP_DIR="${AIOS_CLIENT_LINK_BACKUP_DIR:-${TMPDIR:-/tmp}/aios-client-runtime-backup-$(date +%Y%m%d-%H%M%S)-$$}"
MIGRATED_PATHS=0

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

ensure_context_intake_scaffold() {
  local context_dir="$1"
  mkdir -p \
    "${context_dir}/inbox" \
    "${context_dir}/intake/review" \
    "${context_dir}/intake/parked" \
    "${context_dir}/reference"

  touch \
    "${context_dir}/inbox/.gitkeep" \
    "${context_dir}/intake/review/.gitkeep" \
    "${context_dir}/intake/parked/.gitkeep" \
    "${context_dir}/reference/.gitkeep"
}

require_shared_file() {
  local rel="$1"
  if [[ ! -f "${PROJECT_DIR}/${rel}" ]]; then
    echo "ERROR: required shared AI-OS file is missing: ${rel}" >&2
    echo "Refusing to sync clients because rsync --delete would propagate the deletion." >&2
    exit 1
  fi
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

sync_dir() {
  local src="${1%/}"
  local dest="${2%/}"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude '.git/' \
      --exclude '.venv/' \
      --exclude 'node_modules/' \
      --exclude '__pycache__/' \
      "$src/" "$dest/"
  else
    rm -rf "$dest"
    mkdir -p "$dest"
    cp -R "$src/." "$dest/"
  fi
}

backup_and_link() {
  local target="$1"
  local link_target="$2"
  local rel
  local backup

  if [[ -L "$target" ]] && [[ "$(readlink "$target")" == "$link_target" ]]; then
    return
  fi

  if [[ -e "$target" || -L "$target" ]]; then
    rel="${target#"$PROJECT_DIR/"}"
    backup="$RUNTIME_BACKUP_DIR/$rel"
    mkdir -p "$(dirname "$backup")"
    mv "$target" "$backup"
    MIGRATED_PATHS=$((MIGRATED_PATHS + 1))
  fi

  mkdir -p "$(dirname "$target")"
  ln -s "$link_target" "$target"
}

preflight_shared_skill_overrides() {
  local client_dir
  local root_skill
  local skill_name
  local client_skill
  local local_path

  shopt -s nullglob
  for client_dir in "$CLIENTS_DIR"/*/; do
    for root_skill in "$PROJECT_DIR"/.claude/skills/*/; do
      [[ -f "$root_skill/SKILL.md" ]] || continue
      skill_name="$(basename "$root_skill")"
      client_skill="$client_dir/.claude/skills/$skill_name"
      [[ -d "$client_skill" && ! -L "$client_skill" ]] || continue

      while IFS= read -r local_path; do
        [[ -n "$local_path" ]] || continue
        printf 'ERROR: client-local shared-skill override must be moved before linking: %s\n' "${local_path#"$PROJECT_DIR/"}" >&2
        printf 'Move client behavior into that client context/learnings.md, or make the skill client-only under a distinct name.\n' >&2
        return 1
      done < <(find "$client_skill" -maxdepth 1 \( -type f -name 'SKILL.local.md' -o -type f -name '*.local.md' -o -type d -name local -o -type d -name .local \) -print)
    done
  done
  shopt -u nullglob
}

sync_hooks_info_dir() {
  local src="${1%/}"
  local dest="${2%/}"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude 'ccnotify.db' \
      --exclude 'ccnotify.log*' \
      --exclude 'footer-misses.log' \
      "$src/" "$dest/"
  else
    find "$src" -maxdepth 1 -type f \
      ! -name 'ccnotify.db' \
      ! -name 'ccnotify.log*' \
      ! -name 'footer-misses.log' \
      -exec cp -p {} "$dest/" \;
  fi
}

is_claude_wrapper() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  grep -qx '@AGENTS.md' "$file"
}

get_client_display_name() {
  local file="$1"
  head -n 1 "$file" | tr -d '\r' | sed 's/^# Client: //'
}

is_exact_legacy_client_claude() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  local first_line
  local remainder
  local expected

  first_line="$(head -n 1 "$file" | tr -d '\r')"
  [[ "$first_line" =~ ^#\ Client:\  ]] || return 1

  remainder="$(tail -n +3 "$file" | tr -d '\r')"
  expected="Add client-specific instructions here. These layer on top of the root CLAUDE.md methodology - they don't replace it.

## Client-Specific Instructions

-

## Notes

-"

  [[ "$remainder" == "$expected" ]]
}

sync_client_instruction_files() {
  local client_dir="$1"
  local client_name="$2"
  local agents_path="${client_dir}/AGENTS.md"
  local claude_path="${client_dir}/CLAUDE.md"

  if [[ ! -f "$agents_path" ]]; then
    if [[ -f "$claude_path" ]] && ! is_claude_wrapper "$claude_path"; then
      if is_exact_legacy_client_claude "$claude_path"; then
        create_client_agents_file "$agents_path" "$(get_client_display_name "$claude_path")"
        echo "  Created AGENTS.md from legacy client scaffold"
        create_client_claude_wrapper "$claude_path"
        echo "  Converted legacy CLAUDE.md to wrapper"
      else
        cp "$claude_path" "$agents_path"
        echo "  Seeded AGENTS.md from existing CLAUDE.md"
        echo "  Preserved existing CLAUDE.md (manual cleanup recommended)"
      fi
    else
      create_client_agents_file "$agents_path" "$client_name"
      echo "  Created AGENTS.md"
    fi
  fi

  if [[ ! -f "$claude_path" ]]; then
    create_client_claude_wrapper "$claude_path"
    echo "  Created CLAUDE.md wrapper"
  fi
}

if [[ ! -d "$CLIENTS_DIR" ]]; then
  echo "No clients/ directory found. Nothing to sync."
  echo "Create a client first: bash scripts/add-client.sh \"Client Name\""
  exit 0
fi

require_shared_file "scripts/base-return-to-main.sh"
require_shared_file "scripts/base-autosave.sh"
preflight_shared_skill_overrides

# Find client folders (any directory directly under clients/)
CLIENT_COUNT=0
SYNCED=0

for CLIENT_DIR in "${CLIENTS_DIR}"/*/; do
  [[ -d "$CLIENT_DIR" ]] || continue
  CLIENT_NAME=$(basename "$CLIENT_DIR")
  CLIENT_COUNT=$((CLIENT_COUNT + 1))

  echo "Syncing ${CLIENT_NAME}..."

  sync_client_instruction_files "$CLIENT_DIR" "$CLIENT_NAME"

  if [[ ! -f "${CLIENT_DIR}/context/MEMORY.md" ]]; then
    mkdir -p "${CLIENT_DIR}/context"
    create_memory_scaffold "${CLIENT_DIR}/context/MEMORY.md"
    echo "  Created MEMORY.md scaffold"
  fi
  ensure_context_intake_scaffold "${CLIENT_DIR}/context"

  # Link every shared skill individually so client-only skills can remain as
  # real folders beside them.
  if [[ -d "${PROJECT_DIR}/.claude/skills" ]]; then
    mkdir -p "${CLIENT_DIR}/.claude/skills"

    for root_skill in "${PROJECT_DIR}/.claude/skills"/*/; do
      [[ -f "$root_skill/SKILL.md" ]] || continue
      skill_name=$(basename "$root_skill")
      backup_and_link \
        "${CLIENT_DIR}/.claude/skills/${skill_name}" \
        "../../../../.claude/skills/${skill_name}"
    done

    for shared_meta in _catalog _archived; do
      if [[ -d "${PROJECT_DIR}/.claude/skills/${shared_meta}" ]]; then
        backup_and_link \
          "${CLIENT_DIR}/.claude/skills/${shared_meta}" \
          "../../../../.claude/skills/${shared_meta}"
      fi
    done

    # Count client-only skills (exist in client but not in root)
    CLIENT_ONLY=0
    for client_skill in "${CLIENT_DIR}/.claude/skills"/*/; do
      [[ -d "$client_skill" ]] || continue
      skill_name=$(basename "$client_skill")
      [[ "$skill_name" == "_catalog" || "$skill_name" == "_archived" ]] && continue
      if [[ ! -f "${PROJECT_DIR}/.claude/skills/${skill_name}/SKILL.md" ]]; then
        CLIENT_ONLY=$((CLIENT_ONLY + 1))
      fi
    done

    if [[ $CLIENT_ONLY -gt 0 ]]; then
      echo "  Skills linked (${CLIENT_ONLY} client-only skill(s) preserved)"
    else
      echo "  Skills linked"
    fi
  fi

  # Shared commands, settings, and hooks are single-source links.
  if [[ -d "${PROJECT_DIR}/.claude/commands" ]]; then
    backup_and_link "${CLIENT_DIR}/.claude/commands" "../../../.claude/commands"
    echo "  Commands linked"
  fi

  if [[ -f "${PROJECT_DIR}/.claude/settings.json" ]]; then
    backup_and_link "${CLIENT_DIR}/.claude/settings.json" "../../../.claude/settings.json"
    echo "  Settings linked"
  fi

  # Sync hooks_info (required by hooks in settings.json)
  if [[ -d "${PROJECT_DIR}/.claude/hooks_info" ]]; then
    sync_hooks_info_dir "${PROJECT_DIR}/.claude/hooks_info" "${CLIENT_DIR}/.claude/hooks_info"
    echo "  Hooks info synced"
  fi

  if [[ -d "${PROJECT_DIR}/.claude/hooks" ]]; then
    backup_and_link "${CLIENT_DIR}/.claude/hooks" "../../../.claude/hooks"
    echo "  Hooks linked"
  fi

  # Link shared script entries. Client cron proxy scripts stay real because
  # they inject the active client slug before delegating to root.
  mkdir -p "${CLIENT_DIR}/scripts"
  for root_entry in "${PROJECT_DIR}/scripts"/*; do
    entry_name="$(basename "$root_entry")"
    case "$entry_name" in
      start-crons.sh|stop-crons.sh|status-crons.sh|logs-crons.sh|run-job.sh|\
      start-crons.ps1|stop-crons.ps1|status-crons.ps1|logs-crons.ps1|run-job.ps1) continue ;;
    esac
    backup_and_link "${CLIENT_DIR}/scripts/${entry_name}" "../../../scripts/${entry_name}"
  done
  create_client_cron_proxy_scripts "${CLIENT_DIR}/scripts"
  echo "  Scripts linked (client cron proxies kept local)"

  # Cron templates are shared methodology too.
  if [[ -d "${PROJECT_DIR}/cron/templates" ]]; then
    backup_and_link "${CLIENT_DIR}/cron/templates" "../../../cron/templates"
    echo "  Cron templates linked"
  fi

  SYNCED=$((SYNCED + 1))
  echo ""
done

if [[ $CLIENT_COUNT -eq 0 ]]; then
  echo "No client folders found in clients/."
  echo "Create a client first: bash scripts/add-client.sh \"Client Name\""
else
  echo "Done. Reconciled ${SYNCED} client(s)."
  echo ""
  echo "What is linked: shared skills, commands, scripts, settings, hooks, cron templates."
  echo "What was NOT overwritten: brand_context, existing memory, learnings, projects, .env, cron jobs."
  echo "Missing client context/MEMORY.md files may be scaffolded."
  if [[ "$MIGRATED_PATHS" -gt 0 ]]; then
    echo "Reversible migration backup: $RUNTIME_BACKUP_DIR"
  fi
fi
