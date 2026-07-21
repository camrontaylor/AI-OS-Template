# scripts/lib/team.sh
# Shared helpers for AI-OS team sharing. SOURCED by make-team-copy.sh and
# team-join.sh; not run on its own. Callers own their own strict mode.
#
# This file is the SINGLE SOURCE OF TRUTH for the team-sharing boundary.
#
# TEAM_STRIP below is the must-never-ship list: git-tracked paths that are
# personal and must never reach a teammate. In plain words, the clean copy
# leaves out:
#   clients/                     - all client work (brand, memory, projects, IP)
#   projects/                    - your own project outputs at the root
#   context/USER.md              - your personal profile
#   context/operator/            - your personal identity and voice notes
#   CLAUDE.local.md              - your personal standing rules
#   .claude/launch.json          - your machine-specific launch config
#   scripts/notion-sync/*.plist  - your personal scheduled-sync job
#   skills-library/              - vendored candidate skills, including
#                                  proprietary and private-only sources that
#                                  must never be redistributed (LICENSES.md)
#   .aios/enabled/*.json         - local optional capability activation markers
#
# The agent persona context/SOUL.md SHIPS by default, so the whole team shares
# one house voice. To give each teammate a blank persona instead, swap the
# TEAM_STRIP line for the commented variant just below it.

# Bring in PYTHON_CMD for team_write_config and the shared secret scanner.
# python.sh only DECLARES an empty PYTHON_CMD; resolve_python_cmd populates it.
# Sourcing without calling the resolver left the array empty, which silently
# skipped the filled-secret check and reported a clean gate that never ran.
if [[ -z "${PYTHON_CMD+set}" ]] || [[ "${#PYTHON_CMD[@]}" -eq 0 ]]; then
  _team_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$_team_lib_dir/python.sh" ]]; then
    source "$_team_lib_dir/python.sh" || true
    if declare -F resolve_python_cmd >/dev/null 2>&1; then
      resolve_python_cmd >/dev/null 2>&1 || true
    fi
  fi
  unset _team_lib_dir
fi

# The must-never-ship list. Null-delimited extended regex over repo-relative paths.
TEAM_STRIP='^(clients/|projects/|context/USER\.md$|context/operator/|CLAUDE\.local\.md$|\.claude/launch\.json$|scripts/notion-sync/.*\.plist$|skills-library/|\.aios/enabled/.*\.json$)'
# To ship a BLANK persona to teammates instead of your SOUL.md, use this line
# instead of the one above (adds context/SOUL.md to the strip list):
# TEAM_STRIP='^(clients/|projects/|context/USER\.md$|context/SOUL\.md$|context/operator/|CLAUDE\.local\.md$|\.claude/launch\.json$|scripts/notion-sync/.*\.plist$|skills-library/|\.aios/enabled/.*\.json$)'

# team_slug_from_url <git-url> -> echoes "owner/repo"
# Handles https://host/owner/repo(.git), https://TOKEN@host/owner/repo(.git),
# and git@host:owner/repo(.git).
team_slug_from_url() {
  local url="${1:-}"
  url="${url%.git}"
  url="${url%/}"
  case "$url" in
    *@*:*) url="${url##*:}" ;;                                     # git@host:owner/repo
    *://*) url="${url#*://}"; url="${url#*@}"; url="${url#*/}" ;;   # https://[token@]host/owner/repo
  esac
  # Reduce to the last two path segments: owner/repo
  local repo owner rest
  repo="${url##*/}"
  rest="${url%/*}"
  owner="${rest##*/}"
  if [[ -n "$owner" && "$owner" != "$rest" ]]; then
    printf '%s/%s\n' "$owner" "$repo"
  else
    printf '%s\n' "$url"
  fi
}

# team_write_config <dest_dir> <slug> [branch]
# Writes <dest_dir>/.aios-team.json. Uses python for safe quoting when present,
# falls back to printf otherwise.
team_write_config() {
  local dest="${1:-}" slug="${2:-}" branch="${3:-main}"
  [[ -z "$branch" ]] && branch="main"
  [[ -z "$dest" ]] && return 1
  local out="$dest/.aios-team.json"
  if [[ -n "${PYTHON_CMD+set}" ]] && [[ ${#PYTHON_CMD[@]} -gt 0 ]]; then
    TEAM_SLUG="$slug" TEAM_BRANCH="$branch" "${PYTHON_CMD[@]}" - "$out" <<'PY'
import json, os, sys
out = sys.argv[1]
data = {
    "team_slug": os.environ.get("TEAM_SLUG", ""),
    "team_branch": os.environ.get("TEAM_BRANCH", "main"),
    "schema": 1,
}
with open(out, "w") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
  else
    printf '{\n  "team_slug": "%s",\n  "team_branch": "%s",\n  "schema": 1\n}\n' "$slug" "$branch" > "$out"
  fi
}

# team_copy_shared_tree <src_dir> <dest_dir>
# Copies the shareable AI-OS system into <dest_dir>. This is the one export
# path used by both first-time team copies and day-2 publishes.
team_copy_shared_tree() {
  local src="${1:-}" dest="${2:-}"
  [[ -z "$src" || ! -d "$src" ]] && { printf 'team_copy_shared_tree: missing source\n' >&2; return 2; }
  [[ -z "$dest" ]] && { printf 'team_copy_shared_tree: missing destination\n' >&2; return 2; }
  mkdir -p "$dest"

  ( cd "$src" && git ls-files -z \
      | grep -zEv "$TEAM_STRIP" \
      | rsync -a --from0 --files-from=- ./ "$dest"/ )

  # Folders teammates need, but that should start blank in the shared system.
  mkdir -p "$dest/clients" "$dest/projects" "$dest/brand_context" "$dest/skills-library"
  touch "$dest/clients/.gitkeep" "$dest/projects/.gitkeep"

  cat > "$dest/skills-library/README.md" <<'EOF'
# Skills Library

The vendored skills library is not included in team copies by default.

Team copies ship only the reviewed live skills in `.claude/skills/`. Keep raw or private-only candidate skills in the maintainer workspace, promote the useful ones into `.claude/skills/`, then publish the reviewed system to the team repo.
EOF

  cat > "$dest/skills-library/INDEX.md" <<'EOF'
# Skills Library - Team Copy

No raw backlog candidates are bundled in this team copy. Use the live skills in `.claude/skills/`, or ask the team maintainer to promote and publish a reviewed skill.
EOF

  # No backlog is re-added. The runtime mental-model catalog AGENTS.md actually
  # reads is context/thinking/model-catalog.md, which ships on its own, so
  # copying the vendored source back in would add nothing but licence risk.
}

# The only paths under a stripped prefix that team_copy_shared_tree creates on
# purpose. team_leak_verify allows exactly these, so the exporter and the
# verifier cannot disagree about what a clean tree looks like.
TEAM_EXPORT_ALLOW='^(skills-library/(README\.md|INDEX\.md)|clients/\.gitkeep|projects/\.gitkeep)$'

# team_leak_verify <tree_dir> -> returns nonzero and prints offending paths if
# ANY private data is present. Defense in depth on top of the structural
# guarantee (we only ever copy git-tracked files minus TEAM_STRIP). Never
# modifies anything, never deletes.
team_leak_verify() {
  local tree="${1:-}"
  [[ -z "$tree" || ! -d "$tree" ]] && { printf 'team_leak_verify: no tree to check\n' >&2; return 2; }
  local hits=0 rel

  # (a) must-never-ship paths present in the tree (ignore empty-folder markers)
  while IFS= read -r rel; do
    rel="${rel#./}"
    case "$rel" in
      .git/*) continue ;;
      */.gitkeep) continue ;;
    esac
    if printf '%s\n' "$rel" | grep -qE "$TEAM_EXPORT_ALLOW"; then continue; fi
    if printf '%s\n' "$rel" | grep -qE "$TEAM_STRIP"; then
      printf '  LEAK (private path present): %s\n' "$rel"
      hits=1
    fi
  done < <(cd "$tree" && find . -type f 2>/dev/null)

  # (b) gitignored brain that should never be in a clean copy
  local p
  for p in "context/MEMORY.md" "context/learnings.md" ".memsearch" "context/notion" "context/_private"; do
    if [[ -e "$tree/$p" ]]; then printf '  LEAK (brain present): %s\n' "$p"; hits=1; fi
  done
  if compgen -G "$tree/context/memory/*.md" >/dev/null 2>&1; then printf '  LEAK (brain present): context/memory/*.md\n'; hits=1; fi
  if compgen -G "$tree/context/transcripts/*.md" >/dev/null 2>&1; then printf '  LEAK (brain present): context/transcripts/*.md\n'; hits=1; fi
  if [[ -s "$tree/.env" ]]; then printf '  LEAK (filled .env present): .env\n'; hits=1; fi

  # (c) a personal home path baked into any text file. Same pattern as
  # scripts/lib/sanitize-strings.sh on purpose: the first path segment must
  # start alphanumeric/underscore, so placeholder text like "/Users/.../projects"
  # in a comment does not trip it (a real username never starts with a dot).
  local homehit
  homehit="$(cd "$tree" && grep -rIlE '/Users/[A-Za-z0-9_][A-Za-z0-9._-]*/|/home/[A-Za-z0-9_][A-Za-z0-9._-]*/' . 2>/dev/null | grep -v '^\./\.git/' | head -n 20)"
  if [[ -n "$homehit" ]]; then
    printf '  LEAK (home path in file):\n'
    printf '%s\n' "$homehit" | sed 's/^/    /'
    hits=1
  fi

  # (d) a stray filled secret. Delegated to scripts/lib/secret-scan.py, the same
  # scanner template-sync.sh and template-release-check.sh use, so "what counts
  # as a secret" has ONE definition and one test (scripts/test-secret-scan.sh).
  # A local bash heuristic here used to flag `TOKEN=""` and `TOKEN="$(... .env)"`.
  # The file list MUST be passed explicitly. With no file arguments the scanner
  # falls back to `git ls-files`, and an export tree has no git history, so it
  # would scan zero files and report a clean tree that was never checked.
  local sechit scanner="$tree/scripts/lib/secret-scan.py"
  if [[ -f "$scanner" ]] && [[ -n "${PYTHON_CMD+set}" ]] && [[ ${#PYTHON_CMD[@]} -gt 0 ]]; then
    sechit="$(cd "$tree" \
      && find . -type f -not -path './.git/*' -print0 2>/dev/null \
      | xargs -0 "${PYTHON_CMD[@]}" "scripts/lib/secret-scan.py" . 2>/dev/null \
      | cut -d: -f1 | sort -u | head -n 20)"
    if [[ -n "$sechit" ]]; then
      printf '  LEAK (filled secret value):\n'
      printf '%s\n' "$sechit" | sed 's/^/    /'
      hits=1
    fi
  else
    # Never pass quietly: an unrunnable scanner is a failed check, not a clean one.
    printf '  LEAK (secret scanner unavailable - cannot certify this tree)\n'
    hits=1
  fi

  return "$hits"
}
