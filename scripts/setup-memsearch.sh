#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "setup-memsearch.sh is kept for compatibility."
echo "MemSearch setup is retired. Running the memory migration/setup flow instead."
echo ""

exec bash "$SCRIPT_DIR/setup-memory.sh" "$@"
