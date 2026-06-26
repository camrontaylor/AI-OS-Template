#!/usr/bin/env bash
# Derive the AI-OS CANONICAL MemSearch collection name for the current checkout.
#
# IMPORTANT - this is DELIBERATELY different from the memsearch plugin's own
# collection. The plugin derives "ms_<name>_<hash>"; AI-OS uses
# "ms_<name>_<hash>_aios". They must NOT be the same. Why:
#   The memsearch plugin re-indexes ONLY its .memsearch/memory/ shadow folder
#   after every session, and `memsearch index` does a DESTRUCTIVE sync - it
#   deletes every source that is not in the paths it was just given. When the
#   plugin and AI-OS shared one collection, the plugin wiped AI-OS's full index
#   (root/client memory and learnings) down to just the shadow on
#   every single session. Giving AI-OS its own "_aios" collection means the
#   plugin can only ever clobber its own shadow box, never the canonical index
#   that AI-OS cron indexing and runtime recall read.
# All AI-OS callers (cron jobs, AGENTS.md recall) resolve their collection
# through THIS script, so this one change re-points all of them together.

set -euo pipefail

PROJECT_DIR="${1:-$(pwd)}"

if command -v realpath >/dev/null 2>&1; then
  PROJECT_DIR="$(realpath "$PROJECT_DIR")"
elif [ -d "$PROJECT_DIR" ]; then
  PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
else
  case "$PROJECT_DIR" in
    /*) ;;
    *) PROJECT_DIR="$(pwd)/$PROJECT_DIR" ;;
  esac
fi

sanitized=$(basename "$PROJECT_DIR" \
  | tr '[:upper:]' '[:lower:]' \
  | sed 's/[^a-z0-9]/_/g' \
  | sed 's/__*/_/g' \
  | sed 's/^_//;s/_$//' \
  | cut -c1-40)

if command -v sha256sum >/dev/null 2>&1; then
  hash=$(printf '%s' "$PROJECT_DIR" | sha256sum | cut -c1-8)
elif command -v shasum >/dev/null 2>&1; then
  hash=$(printf '%s' "$PROJECT_DIR" | shasum -a 256 | cut -c1-8)
else
  hash=$(python3 -c "import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:8])" "$PROJECT_DIR")
fi

echo "ms_${sanitized}_${hash}_aios"
