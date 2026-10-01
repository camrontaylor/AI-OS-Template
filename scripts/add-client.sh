#!/usr/bin/env bash
# Create a new client workspace under clients/.
# Usage: bash scripts/add-client.sh "Client Name"

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

source "${PROJECT_DIR}/scripts/lib/python.sh"

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

Add client-specific instructions here. These layer on top of the root AGENTS.md instructions — they don't replace them.

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

create_client_cron_proxy_scripts() {
  local scripts_dir="$1"

  cat > "${scripts_dir}/start-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AI_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/start-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/stop-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AI_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/stop-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/status-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AI_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/status-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/logs-crons.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
AI_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/logs-crons.sh" "$@"
EOF

  cat > "${scripts_dir}/run-job.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CLIENT_SLUG="$(basename "$(cd "$(dirname "$0")/.." && pwd)")"
AI_OS_DIR="$ROOT_PROJECT_DIR" bash "$ROOT_PROJECT_DIR/scripts/run-job.sh" "$@" --client "$CLIENT_SLUG"
EOF

  cat > "${scripts_dir}/start-crons.ps1" <<'EOF'
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$RootProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$RootScript = Join-Path $RootProjectDir "scripts\start-crons.ps1"
$env:AI_OS_DIR = $RootProjectDir

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
$env:AI_OS_DIR = $RootProjectDir

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
$env:AI_OS_DIR = $RootProjectDir

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
$env:AI_OS_DIR = $RootProjectDir

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
$env:AI_OS_DIR = $RootProjectDir

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

CLIENT_GITIGNORE_START="# BEGIN AI-OS generated client ignores"
CLIENT_GITIGNORE_END="# END AI-OS generated client ignores"

# Copy the root settings.json into a client, granting read access to the root.
#
# Shared skills are inherited rather than copied, but a skill is more than its
# SKILL.md: most of them ship references, templates and scripts alongside it and
# tell Claude to open those during a run. A session started in a client folder
# cannot read above its own directory, so those files would be denied and the
# skill would half-work. additionalDirectories is the documented way to widen
# file access without changing which skills load.
#
# The relative "../.." keeps a client portable within the install. The entry
# lives in the generated settings.json, which the root owns and rewrites on
# every sync, so it stays correct without touching the user's settings.local.json.
#
# Note for anyone testing this: Claude Code ignores permissions from a project
# settings.json until the workspace is trusted. A real user accepts that prompt
# on first launch; a non-interactive run will not, and the grant looks broken.
write_client_settings() {
  local source_file="$1"
  local target_file="$2"

  # resolve_python_cmd validates by executing, so a macOS python3 stub that
  # only exists to offer the developer tools is rejected instead of trusted.
  if ! resolve_python_cmd; then
    cp "$source_file" "$target_file"
    echo "  Note: Python 3 not found, so the client settings could not be granted read access" >&2
    echo "  to the root. Skills that load reference files will not find them from this client." >&2
    return 0
  fi

  if ! "${PYTHON_CMD[@]}" - "$source_file" "$target_file" <<'PY'
import json, sys

source, target = sys.argv[1], sys.argv[2]
with open(source, encoding="utf-8") as handle:
    settings = json.load(handle)

permissions = settings.setdefault("permissions", {})
directories = permissions.get("additionalDirectories") or []
if "../.." not in directories:
    directories.append("../..")
permissions["additionalDirectories"] = directories

with open(target, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(settings, handle, indent=2)
    handle.write("\n")
PY
  then
    cp "$source_file" "$target_file"
    echo "  Note: could not write the client settings with root read access; copied as-is." >&2
  fi
}

# Seed the new client's settings.local.json with the skill overrides shared by
# every client that has overrides. When each configured client hides the same
# skill, that skill is the operator's own business, so a new client should not
# be born seeing it. Clients with no overrides abstain rather than veto, and a
# skill hidden in just some of the voting clients is that client's decision,
# reported but not inherited. The file is written once here and updates never
# change its content, so the survival guarantee stays intact.
seed_client_skill_overrides() {
  local clients_dir="$1"
  local new_slug="$2"
  local target_file="$3"

  # Same execution-validated resolver as everywhere else: a python3 stub that
  # cannot actually run must mean "no inheritance", not a silent half-failure.
  resolve_python_cmd || return 0

  "${PYTHON_CMD[@]}" - "$clients_dir" "$new_slug" "$target_file" <<'PY' || true
import json, os, sys

clients_dir, new_slug, target = sys.argv[1], sys.argv[2], sys.argv[3]

voters = []
if os.path.isdir(clients_dir):
    for slug in sorted(os.listdir(clients_dir)):
        if slug == new_slug:
            continue
        path = os.path.join(clients_dir, slug, ".claude", "settings.local.json")
        try:
            with open(path, encoding="utf-8-sig") as handle:
                overrides = json.load(handle).get("skillOverrides", {})
        except (OSError, ValueError):
            continue
        if not isinstance(overrides, dict):
            continue
        hidden = {name for name, state in overrides.items() if state == "off"}
        if hidden:
            voters.append(hidden)

if not voters:
    sys.exit(0)

consensus = sorted(set.intersection(*voters))
individual = sorted(set.union(*voters) - set(consensus))

if consensus:
    # newline="\n" keeps the seeded file LF like the repo's .gitattributes
    # expects for JSON, and spares the first update a whole-file EOL diff.
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"skillOverrides": {name: "off" for name in consensus}}, handle, indent=2)
        handle.write("\n")
    print("  Hidden by default (every client with overrides hides these): " + ", ".join(consensus))
    print("    Inherited into .claude/settings.local.json; edit that file to change it.")
if individual:
    print("  Hidden in some clients only (not inherited): " + ", ".join(individual))
PY
}

generate_client_gitignore_block() {
  echo "$CLIENT_GITIGNORE_START"
  cat <<'EOF'
# Generated by AI-OS. Regenerated root copies stay out of git;
# client data, client-only skills, and SKILL.local.md stay trackable.
scripts/
.claude/hooks/
.claude/hooks_info/
.claude/settings.json
cron/templates/
cron/logs/
cron/status/

# Shared skills are inherited from the AI-OS root and are not copied
# here, so there is nothing to ignore under .claude/skills/. Everything in
# that folder is client-owned: client-only skills and SKILL.local.md overrides.
EOF

  echo "$CLIENT_GITIGNORE_END"
}

write_client_gitignore() {
  local client_dir="$1"
  local target="${client_dir}/.gitignore"
  local block_file
  local merged_file

  block_file="$(mktemp "${TMPDIR:-/tmp}/AI-OS-gitignore.XXXXXX")"
  generate_client_gitignore_block > "$block_file"

  if [[ -f "$target" ]]; then
    # tr strips CR first: a CRLF checkout must still match the markers, and
    # the awk drops the CR per line so the block is replaced, not duplicated.
    if tr -d '\r' < "$target" | grep -Fqx "$CLIENT_GITIGNORE_START" &&
      tr -d '\r' < "$target" | grep -Fqx "$CLIENT_GITIGNORE_END"; then
      merged_file="$(mktemp "${TMPDIR:-/tmp}/AI-OS-gitignore.XXXXXX")"
      awk -v start="$CLIENT_GITIGNORE_START" -v end="$CLIENT_GITIGNORE_END" -v block_file="$block_file" '
        BEGIN {
          while ((getline line < block_file) > 0) {
            block = block line "\n"
          }
          close(block_file)
        }
        { sub(/\r$/, "") }
        $0 == start {
          printf "%s", block
          skipping = 1
          next
        }
        $0 == end {
          skipping = 0
          next
        }
        !skipping { print }
      ' "$target" > "$merged_file"
      cp "$merged_file" "$target"
      rm -f "$merged_file"
    else
      {
        echo ""
        cat "$block_file"
      } >> "$target"
    fi
  else
    cp "$block_file" "$target"
  fi

  rm -f "$block_file"
}

# Create directory structure
mkdir -p "${CLIENT_DIR}/brand_context"
mkdir -p "${CLIENT_DIR}/context/memory"
mkdir -p "${CLIENT_DIR}/projects"
mkdir -p "${CLIENT_DIR}/cron/jobs"
mkdir -p "${CLIENT_DIR}/cron/logs"
mkdir -p "${CLIENT_DIR}/cron/status"
mkdir -p "${CLIENT_DIR}/cron/templates"

# Skills are inherited from the root, never copied. Claude Code discovers
# project skills from .claude/skills/ in the starting directory and in every
# parent directory up to the repository root, so a session started here sees
# the root skill pack without a local copy. This folder holds only what belongs
# to the client: client-only skills and SKILL.local.md overrides.
mkdir -p "${CLIENT_DIR}/.claude/skills"
echo "  Prepared client-only skills folder (shared skills are inherited from root)"

# Copy Claude Code settings if they exist
if [[ -f "${PROJECT_DIR}/.claude/settings.json" ]]; then
  write_client_settings "${PROJECT_DIR}/.claude/settings.json" "${CLIENT_DIR}/.claude/settings.json"
  echo "  Copied Claude Code settings"
fi

# Inherit the skill overrides every existing client agrees on
seed_client_skill_overrides "${PROJECT_DIR}/clients" "$CLIENT_SLUG" "${CLIENT_DIR}/.claude/settings.local.json"

# Copy hooks_info if it exists (required by hooks in settings.json)
if [[ -d "${PROJECT_DIR}/.claude/hooks_info" ]]; then
  cp -R "${PROJECT_DIR}/.claude/hooks_info" "${CLIENT_DIR}/.claude/hooks_info"
  echo "  Copied hooks_info"
fi

# Copy hooks if they exist (session-sync, gsd hooks, etc.)
if [[ -d "${PROJECT_DIR}/.claude/hooks" ]]; then
  cp -R "${PROJECT_DIR}/.claude/hooks" "${CLIENT_DIR}/.claude/hooks"
  echo "  Copied hooks"
fi

# Copy scripts from root
cp -R "${PROJECT_DIR}/scripts" "${CLIENT_DIR}/scripts"
create_client_cron_proxy_scripts "${CLIENT_DIR}/scripts"
echo "  Copied scripts"

# Copy cron templates if they exist
if [[ -d "${PROJECT_DIR}/cron/templates" ]]; then
  cp -R "${PROJECT_DIR}/cron/templates/." "${CLIENT_DIR}/cron/templates/"
  echo "  Copied cron templates"
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
touch "${CLIENT_DIR}/context/memory/.gitkeep"
touch "${CLIENT_DIR}/projects/.gitkeep"
touch "${CLIENT_DIR}/cron/jobs/.gitkeep"

write_client_gitignore "$CLIENT_DIR"
echo "  Created client .gitignore"

# Copy .env if one exists at root
if [[ -f "${PROJECT_DIR}/.env" ]]; then
  cp "${PROJECT_DIR}/.env" "${CLIENT_DIR}/.env"
  echo "  Copied .env (API keys)"
fi

echo ""
echo "Client workspace ready: clients/${CLIENT_SLUG}/"
echo ""
echo "Next steps:"
echo "  cd ${PROJECT_DIR}/clients/${CLIENT_SLUG}"
echo "  codex   # or claude"
echo "  Ask for a task, or say: Set up AI-OS."
echo ""
echo "Git note:"
echo "  Commit client data such as AGENTS.md, brand_context, context, projects,"
echo "  cron/jobs, client-only skills, and SKILL.local.md overrides."
echo "  Copied scripts, hooks, settings, and cron templates are"
echo "  regenerated from root during updates and are ignored. Copied .env stays"
echo "  ignored by the root .gitignore."
echo ""
echo "Skills:"
echo "  This client inherits every shared skill from the AI-OS root."
echo "  Client-only skills go in clients/${CLIENT_SLUG}/.claude/skills/."
echo "  To stop this client from inheriting a specific root skill, just ask."

"${PYTHON_CMD[@]}" "$PROJECT_DIR/scripts/sync-agent-skills.py" --root "$PROJECT_DIR" >/dev/null
