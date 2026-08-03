#!/usr/bin/env bash
# relink-client-scripts.sh - idempotently restore the single-source client script
# links.
#
# Contract (see client-sync-audit.sh): every root scripts/* entry EXCEPT the real
# per-client cron proxies must exist as a symlink in each clients/*/scripts/ dir,
# so there is one source of truth. add-client.sh creates these at client-creation
# time - but a root script added LATER leaves every existing client missing a link,
# which trips client-sync-audit (and so skill-update-check, and so the health
# rollup). That drift had no idempotent repair; this is it.
#
# Safe: only ADDS missing links. Never deletes, never clobbers an existing path.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENTS_DIR="$ROOT/clients"
[[ -d "$CLIENTS_DIR" ]] || { echo "relink-client-scripts: no clients dir"; exit 0; }

is_proxy() {
  # Cron proxies must stay real per-client files, not links to root.
  case "$1" in
    start-crons.sh|stop-crons.sh|status-crons.sh|logs-crons.sh|run-job.sh|\
    start-crons.ps1|stop-crons.ps1|status-crons.ps1|logs-crons.ps1|run-job.ps1) return 0 ;;
  esac
  return 1
}

created=0
shopt -s nullglob
for client_dir in "$CLIENTS_DIR"/*/; do
  [[ -d "$client_dir" ]] || continue
  mkdir -p "$client_dir/scripts"
  for root_entry in "$ROOT"/scripts/*; do
    entry="$(basename "$root_entry")"
    is_proxy "$entry" && continue
    dest="$client_dir/scripts/$entry"
    if [[ ! -e "$dest" && ! -L "$dest" ]]; then
      ln -s "../../../scripts/$entry" "$dest"
      created=$((created + 1))
      echo "linked $(basename "${client_dir%/}")/scripts/$entry"
    fi
  done
done
shopt -u nullglob
echo "relink-client-scripts: created $created link(s)."
