#!/usr/bin/env python3
"""Concurrency gate for headless `claude` cron jobs (macOS-portable, flock-style).

ceiling: serializes ALL scheduled claude sessions to one at a time via a single
advisory fcntl lock. This is the fix for the 2026-07-23 catch-up storm - when the
cron daemon replayed a batch of missed jobs at once, the flood of parallel claude
sessions starved each other and every job timed out (exit 124). One-at-a-time is
plenty: on a normal day the claude jobs are spread minutes apart and each runs in
~90s, so contention is rare; under a storm they queue instead of melting down.

Why not `flock(1)`: macOS does not ship it. fcntl advisory locks give the same
guarantee AND auto-release when the holder dies or the fd closes, so there is no
stale-lock risk. After acquiring, this exec()s claude with the lock fd inherited
(FD_CLOEXEC cleared), so the wrapper's own PID still IS claude - the runtime's
timeout-kill semantics are unchanged, and killing the job releases the lock.

Fail-open by design: any lock error, or a wait that runs out, proceeds uncapped
rather than blocking the job. A stuck gate must never wedge every cron claude job.

Upgrade path if genuine parallelism is ever wanted: replace the single lock with
an N-slot counting semaphore (try LOCK_EX on lock.0..lock.N-1, take the first
that is free) keyed on an AIOS_CRON_CLAUDE_SLOTS env var.

Usage:  cron-claude-lock.py <real_claude_bin> [args...]
Env:    AIOS_CRON_CLAUDE_LOCK          lock file path (default: $TMPDIR/aios-cron-claude.lock)
        AIOS_CRON_CLAUDE_LOCK_WAIT     max seconds to wait for the slot (default: 600)
        AIOS_CRON_CLAUDE_LOCK_DISABLE  set to 1 to bypass the gate entirely
"""
import fcntl
import os
import sys
import tempfile
import time


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("cron-claude-lock: no claude binary given\n")
        os.execv("/usr/bin/false", ["/usr/bin/false"])

    real = sys.argv[1]
    argv = sys.argv[1:]  # argv[0] for the exec'd process = the real claude path

    # Bypass switch - run claude straight through, no gate.
    if os.environ.get("AIOS_CRON_CLAUDE_LOCK_DISABLE") == "1":
        os.execv(real, argv)

    lock_path = os.environ.get("AIOS_CRON_CLAUDE_LOCK") or os.path.join(
        tempfile.gettempdir(), "aios-cron-claude.lock"
    )
    try:
        wait = float(os.environ.get("AIOS_CRON_CLAUDE_LOCK_WAIT", "600"))
    except ValueError:
        wait = 600.0

    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
        # The lock must survive the exec below, so clear close-on-exec.
        flags = fcntl.fcntl(fd, fcntl.F_GETFD)
        fcntl.fcntl(fd, fcntl.F_SETFD, flags & ~fcntl.FD_CLOEXEC)

        deadline = time.time() + wait
        acquired = False
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                if time.time() >= deadline:
                    break
                time.sleep(2)

        if not acquired:
            sys.stderr.write(
                "cron-claude-lock: gate still busy after %ss; proceeding "
                "uncapped (safety valve)\n" % int(wait)
            )
    except Exception as exc:  # never let the gate block the job
        sys.stderr.write("cron-claude-lock: lock error (%s); proceeding uncapped\n" % exc)

    os.execv(real, argv)


if __name__ == "__main__":
    main()
