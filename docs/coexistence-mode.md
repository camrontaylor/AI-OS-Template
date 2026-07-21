# Coexistence Mode

Run several AI sessions or tools in one folder at once without losing files or getting
nagged about git. The live system is global, in `~/.claude/coexistence/`, so it works in
every session, every branch, every project (it is not tied to this repo or any branch).

## The problem

When more than one session shares one git checkout, whichever one switches branches first
runs `git stash --include-untracked` on the whole folder. That shelves the other session's
uncommitted and untracked files; if that session ends first, the files look deleted.
Committed work is never affected.

This is **tool-neutral**. Do not pin it on a specific tool without proof. The incidents here
have been concurrent **Claude Code** sessions, not Cursor (an earlier note wrongly
blamed those, and that has been corrected).

## What's installed (`~/.claude/coexistence/`)

| File | Role |
|------|------|
| `recover.js` | SessionStart hook. Auto-restores stranded files from stashes on the current branch: restores missing files, saves any conflict as `<file>.recovered` (never overwrites your current work), never drops the backup stash. |
| `steer.sh` | SessionStart hook. Tells the assistant to stop nagging about commit / PR / stash / branch for routine work. |
| `calm.sh` | The control command (see below). |
| `state` | The on/off switch (`on` or `off`). |
| `README.md` | Short user guide. |

The repo hook `.claude/hooks/branch-guard.js` also reads the switch and goes silent while
coexistence is on, so the "you're on main, switch branches" advisories stop for routine work.

## Commands

```
calm status         show the mode + your backup stashes
calm on / calm off  toggle the whole thing
calm recover        scan the current folder now and bring back stranded work
calm new <name>     make a private, collision-proof copy of the project (a worktree)
calm list           list your project copies
```

`calm` is aliased in `~/.zshrc`. If it isn't found, run `~/.claude/coexistence/calm.sh`.

## Two ways it keeps you safe (you chose "both")

1. **Safety net (always on in the shared folder).** Stranded files auto-return at the next
   session start; backups are kept; nothing is overwritten.
2. **Isolation on demand.** `calm new <name>` gives a session or another tool (Cursor)
   its own private copy of the folder, so there is zero chance of collision. Use it when you
   want to run something heavy in parallel.

## The scheduled "robot" agents (cron)

Finding: the cron agents are **not** your file-loss cause. They run jobs in place on the
current branch and commit their own work, and they do not switch the shared branch. The
daemon also wasn't running. So they are low-risk as-is.

If you still want them fully isolated, run them from their own copy:

```
calm new cron                       # makes a private copy on branch coexist/cron
# then, inside that copy's folder:
bash scripts/start-crons.sh
```

Trade-off to know: isolating cron means its outputs (memory distill, search indexing,
digests) land on that separate branch and need merging back to be visible in your normal
sessions. For jobs whose whole purpose is to update your shared memory, that may not be what
you want, so this is opt-in, not forced.

## Turning it off

`calm off`, or delete `~/.claude/coexistence/`. Nothing there changes your files; removing it
only takes away the safety net.

## Note on branches

The live protection is global (`~/.claude`), so it is active immediately regardless of which
branch any checkout is on. The repo-side de-nag (`branch-guard.js`) and this doc take full
effect once this branch is merged to the branches you open sessions on.
