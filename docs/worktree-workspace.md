# Worktree Workspace

Start a new AI-OS session any time, on a clean `main`, even when other sessions
have uncommitted work on other branches. No stash prompt, no committing someone
else's work first, and your memory never splits.

## The problem this fixes

Git lets one folder sit on only one branch at a time. So if every session opens
the same AI-OS folder, two sessions cannot be on two branches at once. When one
session has uncommitted work and you start another, Claude Desktop pops a
**Stash / Discard / Commit** box and blocks you until you pick one. (That box is a
Claude Desktop behavior, tracked upstream as issue #62142. No file on your machine
can switch it off.)

The normal fix is **git worktrees**: each session gets its own folder, on its own
branch, all sharing one git history. Claude Desktop already does this automatically
for your other projects.

But AI-OS could not use worktrees safely on its own, because your **brain is
gitignored**: `context/memory/`, `MEMORY.md`, `learnings.md`, `.env`, the command
centre's data, the memsearch index. Git does not copy gitignored files into a
worktree. So a raw worktree would boot with **empty memory** and every session
would drift apart. That is why AI-OS used one shared folder, and why the stash box
kept blocking you.

## How the fix works

Each worktree gets its own folder and branch (isolation), but its brain is
**symlinked back to the one real copy** in your primary checkout. So sessions are
isolated for code, and unified for memory. One brain, many hands.

```
~/AI-OS                 <- PRIMARY. Stays on clean main. Holds the one real brain.
~/AI-OS/.worktrees/<name> <- a session worktree on branch work/<name>
   context/memory/2026-06-23.md    --> symlink --> primary's context/memory/2026-06-23.md
   context/MEMORY.md               --> symlink --> primary's context/MEMORY.md
   .env, .mcp.json, .command-centre, .memsearch, ... all symlinked to primary
```

What is shared (symlinked, so it never forks): `.env`, `.mcp.json`,
`.claude/settings.local.json`, `.claude/skills/_catalog/installed.json`,
`.command-centre/`, `.memsearch/`, `context/MEMORY.md`, `context/learnings.md`,
`context/memory/`, `context/transcripts/`, `context/_private/`, `context/notion/`,
and the same set under each `clients/<x>/`.

What is NOT shared (it comes from git, already the same everywhere): your tracked
files - skills, scripts, `projects/`, `brand_context/`, docs, the codebase.

## How a worktree gets made

Worktrees are explicit isolation. The primary checkout on `main` is the default
place to work.

1. **On demand (one command).** `bash scripts/worktree-new.sh <name>` makes a clean
   worktree from `main`, links the brain, and prints the folder to open.
2. **Host-created worktrees.** If Claude Desktop or another host creates a worktree
   externally, AI-OS links the brain and treats work there as an explicit
   isolation choice.

Either way the brain is linked automatically. The hook re-links every session
start, so newly added memory files get picked up too.

## Commands

| Command | What it does |
|---------|--------------|
| `bash scripts/worktree-new.sh <name>`  | Make a clean isolated session folder under `.worktrees/` (branch `work/<name>` from main), brain linked. Prints the path to open. |
| `bash scripts/worktree-list.sh`        | List all worktrees (the first is your primary/home). |
| `bash scripts/worktree-done.sh <name>` | Remove a worktree. Keeps its commits as an archive tag if it had any, drops the branch if not. Your brain is never touched. |
| `bash scripts/worktree-link.sh [path]` | Re-link the brain into a worktree by hand (the hook calls this for you). |

## Rules that keep it working

- **The primary checkout (`~/AI-OS`) stays clean - automatically.** It is
  home base and the single source of the brain. One owner does this: the SessionEnd
  hook `.claude/hooks/base-autosave.js`, which calls the shared, tool-neutral
  `scripts/base-autosave.sh`. When a session ends it commits leftover work in the
  primary, so the next session opens clean and is not hit by the stash box. It runs
  only in the primary (never worktrees), never commits the gitignored brain, and
  skips any file over 5 MB so a dropped video or zip can never bloat the repo. You
  never commit by hand.
- **Worktrees are opt-in and disposable.** Commit what you want to keep, then
  `worktree-done`. Nothing in a worktree holds your only copy of anything: the
  brain lives in the primary, code lives in git.
- **Worktree audits surface state; they do not block routine work.** The audit
  reports branch and dirty-state issues in plain English. Use normal git judgment
  before committing or pushing from a side branch or worktree.
- **Nothing is ever hard-deleted.** `worktree-done` archives branch commits to a
  tag before dropping the branch (same no-delete rule as the rest of AI-OS).

## If you are not a developer: the two things to know

1. **If you ever see a box asking Stash / Discard / Commit, click `Commit`.** Never
   click `Discard` (it throws work away) and avoid `Stash` (it hides work). `Commit`
   is always safe - it just saves what is there. The autosave above makes this box
   rare, but a crash or a non-Claude session can still surface it once.
2. **To get back an earlier version, just ask in plain words** ("go back to the brief
   from yesterday"). That is handled by document versions (`ops-versioning`), not the
   git history. You never need git, branches, or the terminal.

## Recovery and limits (honest notes)

- **Your committed work is protected on update.** The updater (`scripts/update.sh`)
  used to hard-reset to the remote, which could erase un-pushed local commits; it now
  archives them to an `autosave-recovery/<date>` branch first, so nothing committed is
  ever lost.
- **Tool coverage.** The clean-primary autosave runs for Claude Code sessions when
  hooks are loaded. Cursor cannot run hooks, so after a Cursor session the primary
  may be left dirty until the next Claude session cleans it (or you click `Commit`
  once).
- **Backup.** Autosave commits stay on local `main`; they are backed up to GitHub
  through the normal update/release flow, not on every turn. Ask to "back up my work"
  any time to push a snapshot.

## Safety

- `worktree-link.sh` only ever creates symlinks. It never deletes and never
  overwrites a real file - if a real file already sits where a link would go, it
  leaves it alone and says so.
- If Claude Desktop's worktree auto-cleanup ever removes a worktree, your memory is
  safe: the worktree held only symlinks, the real files are in the primary.
- This builds on the existing coexistence safety net (`~/.claude/coexistence`,
  `epitaxy-stash-guard.js`): if a stray stash ever happens, that net still recovers
  it. Worktrees stop the collisions; the net is the backstop.
