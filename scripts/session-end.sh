#!/usr/bin/env bash
# One guarded saving path; backups never push main or dev.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/base-autosave.sh" "$@"
