#!/usr/bin/env bash
# Sync skills and scripts from the root to all client workspaces.
# Run this after update.sh to push the latest methodology to all clients.
# Usage: bash scripts/update-clients.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENTS_DIR="${PROJECT_DIR}/clients"

source "${PROJECT_DIR}/scripts/lib/python.sh"

# The committed-blob index is a temp file kept for the whole run; never let it
# outlive the script.
trap 'if [[ -n "${COMMITTED_BLOBS:-}" && "$COMMITTED_BLOBS" != "none" && -f "$COMMITTED_BLOBS" ]]; then rm -f "$COMMITTED_BLOBS"; fi' EXIT

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

COMMITTED_BLOBS=""

# Blobs reachable from committed history: branches, tags and remotes only.
#
# Deliberately NOT `--all`, and deliberately not `git cat-file -e`. Both would
# also match objects that merely exist in the object database, which includes
# anything a `git stash` wrote. scripts/lib/backup.sh stashes the untracked
# clients/ tree during an update, so every client file becomes a loose object
# minutes before this prune runs. Treating "the object exists" as "this is root
# content" would classify the user's own skills as disposable copies and delete
# them. Reachability from committed refs is the property we actually mean.
build_committed_blob_index() {
  [[ -n "$COMMITTED_BLOBS" ]] && return 0
  COMMITTED_BLOBS="none"

  command -v git >/dev/null 2>&1 || return 0
  git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 || return 0

  local index
  index="$(mktemp "${TMPDIR:-/tmp}/AI-OS-blobs.XXXXXX")"
  if git -C "$PROJECT_DIR" rev-list --branches --tags --remotes --objects 2>/dev/null \
      | cut -d' ' -f1 | sort -u > "$index" 2>/dev/null && [[ -s "$index" ]]; then
    COMMITTED_BLOBS="$index"
  else
    rm -f "$index"
  fi
  return 0
}

# True when a client skill folder is a verbatim copy of root content and can be
# removed without losing anything. Two independent conditions must both hold.
#
# First, the root must still ship a skill of that name. A folder the root does
# not know about is the user's own work by definition, whatever its content
# happens to match. This alone keeps client-only skills safe.
#
# Second, every file in it, ignoring the user's own SKILL.local.md, must be
# either identical to the root version now or present in committed history, so
# the content remains retrievable from the repository.
client_skill_is_untouched_copy() {
  local client_skill="$1"
  local skill_name="$2"
  local root_skill="${PROJECT_DIR}/.claude/skills/${skill_name}"

  [[ -d "$root_skill" ]] || return 1

  # Fast path: identical to the root as it stands right now.
  # -x instead of --exclude: the short form exists in both BSD and GNU diff.
  if diff -r -q -x SKILL.local.md "$root_skill" "$client_skill" >/dev/null 2>&1; then
    return 0
  fi

  build_committed_blob_index
  [[ "$COMMITTED_BLOBS" == "none" ]] && return 1
  [[ -f "$COMMITTED_BLOBS" ]] || return 1

  local file blob
  while IFS= read -r file; do
    [[ "$(basename "$file")" == "SKILL.local.md" ]] && continue
    blob="$(git -C "$PROJECT_DIR" hash-object "$file" 2>/dev/null)" || return 1
    grep -Fxq "$blob" "$COMMITTED_BLOBS" || return 1
  done < <(find "$client_skill" -type f)

  return 0
}

has_generated_client_gitignore() {
  local client_dir="$1"
  local target="${client_dir}/.gitignore"

  [[ -f "$target" ]] || return 1
  # tr strips CR first: a CRLF checkout must still match the markers.
  tr -d '\r' < "$target" | grep -Fqx "$CLIENT_GITIGNORE_START" &&
    tr -d '\r' < "$target" | grep -Fqx "$CLIENT_GITIGNORE_END"
}

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
  expected="Add client-specific instructions here. These layer on top of the root CLAUDE.md methodology — they don't replace it.

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

# Find client folders (any directory directly under clients/)
CLIENT_COUNT=0
SYNCED=0

for CLIENT_DIR in "${CLIENTS_DIR}"/*/; do
  [[ -d "$CLIENT_DIR" ]] || continue
  CLIENT_NAME=$(basename "$CLIENT_DIR")
  CLIENT_COUNT=$((CLIENT_COUNT + 1))

  echo "Syncing ${CLIENT_NAME}..."

  sync_client_instruction_files "$CLIENT_DIR" "$CLIENT_NAME"

  # Shared skills live only at the root and reach this client through Claude
  # Code's project-root skill discovery. Nothing is ever copied in.
  #
  # Installs created before that change still carry a full copy of every root
  # skill. Those stale copies are not harmless: a client skill folder shadows
  # the root skill of the same name, so an upgraded install would silently
  # freeze every skill at the version it was copied at. Prune them here.
  #
  # The prune rule is deliberately conservative: a copy is removed only when
  # every file in it, ignoring SKILL.local.md, matches the root version as it
  # stands now or as it stood at some point in the root's history. Either way
  # the content is recoverable from the root, so removing it cannot lose
  # information. Anything the user actually edited is kept and reported.
  mkdir -p "${CLIENT_DIR}/.claude/skills"

  CLIENT_ONLY=0
  LOCAL_OVERRIDES=0
  PRUNED_COPIES=0
  SHADOWING_SKILLS=""

  # A stale _catalog copy is dead weight; the root is the only catalog now.
  if [[ -d "${CLIENT_DIR}/.claude/skills/_catalog" ]]; then
    rm -rf "${CLIENT_DIR}/.claude/skills/_catalog"
    PRUNED_COPIES=$((PRUNED_COPIES + 1))
  fi

  for client_skill in "${CLIENT_DIR}/.claude/skills"/*/; do
    [[ -d "$client_skill" ]] || continue
    skill_name=$(basename "$client_skill")
    root_skill="${PROJECT_DIR}/.claude/skills/${skill_name}"

    if [[ -f "${client_skill}/SKILL.local.md" ]]; then
      LOCAL_OVERRIDES=$((LOCAL_OVERRIDES + 1))
    fi

    # No SKILL.md means this folder only carries an override. Nothing to prune.
    if [[ ! -f "${client_skill}/SKILL.md" ]]; then
      continue
    fi

    if client_skill_is_untouched_copy "$client_skill" "$skill_name"; then
      # Verbatim root content. Drop everything except the user's own override,
      # and only count the prune once the folder is verifiably empty: a failed
      # delete reported as success would leave the stale copy silently
      # shadowing the root skill.
      find "$client_skill" -mindepth 1 -not -name 'SKILL.local.md' -delete 2>/dev/null || true
      if [[ -n "$(find "$client_skill" -mindepth 1 -not -name 'SKILL.local.md' -print 2>/dev/null | head -n 1)" ]]; then
        echo "  Warning: could not remove the stale copy of ${skill_name}; it still shadows the root skill."
        CLIENT_ONLY=$((CLIENT_ONLY + 1))
        SHADOWING_SKILLS="${SHADOWING_SKILLS} ${skill_name}"
      else
        if [[ ! -f "${client_skill}/SKILL.local.md" ]]; then
          rmdir "$client_skill" 2>/dev/null || true
        fi
        PRUNED_COPIES=$((PRUNED_COPIES + 1))
      fi
    else
      # Edited here, or authored here. Never touched. Named only when it
      # shadows a root skill, which is the case with a real consequence.
      CLIENT_ONLY=$((CLIENT_ONLY + 1))
      if [[ -d "$root_skill" ]]; then
        SHADOWING_SKILLS="${SHADOWING_SKILLS} ${skill_name}"
      fi
    fi
  done

  echo "  Skills inherited from root (${CLIENT_ONLY} client-owned, ${LOCAL_OVERRIDES} local override(s), nothing copied)"

  if [[ $PRUNED_COPIES -gt 0 ]]; then
    echo "  Removed ${PRUNED_COPIES} stale root skill copy/copies (content matched a root version)."
    echo "  They are inherited from the root now, so they stay up to date on their own."
  fi

  if [[ -n "$SHADOWING_SKILLS" ]]; then
    echo "  Warning: client skill(s) shadowing a root skill of the same name:${SHADOWING_SKILLS}"
    echo "  These differ from the root version, so they were kept as-is. They override"
    echo "  the root skill inside this client and will not receive root updates."
    echo "  Prefer SKILL.local.md to extend a root skill without freezing it."
  fi

  # Sync Claude Code settings
  if [[ -f "${PROJECT_DIR}/.claude/settings.json" ]]; then
    write_client_settings "${PROJECT_DIR}/.claude/settings.json" "${CLIENT_DIR}/.claude/settings.json"
    echo "  Settings synced"
  fi

  # Sync hooks_info (required by hooks in settings.json)
  if [[ -d "${PROJECT_DIR}/.claude/hooks_info" ]]; then
    rm -rf "${CLIENT_DIR}/.claude/hooks_info"
    cp -R "${PROJECT_DIR}/.claude/hooks_info" "${CLIENT_DIR}/.claude/hooks_info"
    echo "  Hooks info synced"
  fi

  # Sync hooks (session-sync, gsd hooks, etc.)
  if [[ -d "${PROJECT_DIR}/.claude/hooks" ]]; then
    rm -rf "${CLIENT_DIR}/.claude/hooks"
    cp -R "${PROJECT_DIR}/.claude/hooks" "${CLIENT_DIR}/.claude/hooks"
    echo "  Hooks synced"
  fi

  # Sync scripts
  rm -rf "${CLIENT_DIR}/scripts"
  cp -R "${PROJECT_DIR}/scripts" "${CLIENT_DIR}/scripts"
  create_client_cron_proxy_scripts "${CLIENT_DIR}/scripts"
  echo "  Scripts synced"

  # Sync cron templates
  if [[ -d "${PROJECT_DIR}/cron/templates" ]]; then
    mkdir -p "${CLIENT_DIR}/cron/templates"
    cp -R "${PROJECT_DIR}/cron/templates/." "${CLIENT_DIR}/cron/templates/"
    echo "  Cron templates synced"
  fi

  write_client_gitignore "$CLIENT_DIR"
  echo "  Client .gitignore updated"

  SYNCED=$((SYNCED + 1))
  echo ""
done

if [[ $CLIENT_COUNT -eq 0 ]]; then
  echo "No client folders found in clients/."
  echo "Create a client first: bash scripts/add-client.sh \"Client Name\""
else
  echo "Done. Synced ${SYNCED} client(s)."
  echo ""
  echo "What was synced: client instruction files, scripts, settings, hooks, cron templates, client .gitignore."
  echo "What was NOT touched: brand_context, memory, learnings, projects, .env, cron jobs, .claude/settings.local.json,"
  echo "  and everything client-owned under .claude/skills: client-only skills, SKILL.local.md overrides, and any"
  echo "  skill copy that differs from the root version."
  echo "Shared skills are inherited from the root and are never copied into clients. Stale copies left by older"
  echo "  versions are removed only when their content matches a root version, which cannot lose anything."
fi
