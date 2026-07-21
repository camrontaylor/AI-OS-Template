#!/usr/bin/env bash
# Step 0: Self-update — fetch the latest update.sh first.
# Solves the chicken-and-egg problem: this script can't fix bugs in itself
# if the user is running the old version. Re-execs with __SELF_UPDATED=1
# to prevent infinite loops.

if [[ -z "${__SELF_UPDATED:-}" ]]; then
    info "Fetching the latest update script..."
    git fetch origin main --quiet 2>/dev/null || true
    REMOTE_HASH=$(git show origin/main:scripts/update.sh 2>/dev/null | md5 -q 2>/dev/null \
        || git show origin/main:scripts/update.sh 2>/dev/null | md5sum 2>/dev/null | awk '{print $1}' \
        || echo "")
    LOCAL_HASH=$(md5 -q "$SCRIPT_DIR/update.sh" 2>/dev/null \
        || md5sum "$SCRIPT_DIR/update.sh" 2>/dev/null | awk '{print $1}' \
        || echo "")
    if [[ -n "$REMOTE_HASH" ]] && [[ -n "$LOCAL_HASH" ]] && [[ "$REMOTE_HASH" != "$LOCAL_HASH" ]]; then
        ok "Update script has changed — reloading with latest version..."
        echo ""
        git checkout origin/main -- scripts/update.sh 2>/dev/null || true
        __SELF_UPDATED=1 exec bash "$SCRIPT_DIR/update.sh" "$@"
    else
        ok "Update script is current"
    fi
else
    ok "Running latest update script"
fi
