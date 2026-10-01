#!/usr/bin/env bash
set -euo pipefail

# install.sh must fail with an actionable message, not a bare `set -e` exit,
# when one of the libs it sources is missing (AIOS-473).
#
# Usage: bash scripts/test-install-missing-lib.sh

REAL_REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/AI-OS-install-missing-lib.XXXXXX")"
trap 'rm -rf "$WORK_ROOT"' EXIT

LIBS=(python.sh centre-shortcut.sh gsd-migration.sh)
FAILURES=0

fail() {
    printf "  ✗ %s\n" "$1"
    FAILURES=$((FAILURES + 1))
}

for missing in "${LIBS[@]}"; do
    work="$WORK_ROOT/$missing"
    mkdir -p "$work/scripts/lib"
    cp "$REAL_REPO/scripts/install.sh" "$work/scripts/install.sh"
    for lib in "${LIBS[@]}"; do
        [[ "$lib" == "$missing" ]] && continue
        cp "$REAL_REPO/scripts/lib/$lib" "$work/scripts/lib/$lib"
    done

    before=$FAILURES
    set +e
    output="$(bash "$work/scripts/install.sh" --repair 2>&1)"
    status=$?
    set -e

    if [[ $status -eq 0 ]]; then
        fail "install.sh exited 0 with scripts/lib/$missing missing"
        continue
    fi
    for expected in "scripts/lib/$missing is missing" "git checkout" "-- scripts/lib/$missing"; do
        if [[ "$output" != *"$expected"* ]]; then
            fail "missing $missing: output lacks '$expected'"
            printf "%s\n" "$output" | sed 's/^/      /'
        fi
    done
    [[ $FAILURES -eq $before ]] && printf "  ✓ missing scripts/lib/%s fails with recovery steps\n" "$missing"
done

if [[ $FAILURES -gt 0 ]]; then
    printf "\n%d failure(s)\n" "$FAILURES"
    exit 1
fi
printf "\nAll install missing-lib checks passed.\n"
