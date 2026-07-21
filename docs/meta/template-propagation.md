# Template Propagation

How a systemic change made in this install reaches the public AI-OS template
(`camrontaylor/AI-OS-Template`) automatically, and why it is shaped this way.

This is the design source of truth. The short contract lives in `AGENTS.md`
under "Template Propagation"; this file holds the reasoning and the parts a future
session needs so it does not undo a hard-won decision.

## The problem

AI-OS had exactly one update direction: template to install. `scripts/update.sh`
pulls upstream changes without touching user data. There was no reverse. So every
improvement to the system itself - a new rule in `AGENTS.md`, a new hook, a new
script - lived only in the maintainer's working install. The template drifted
behind, and keeping it current was a manual chore that got skipped.

The ask: a documented systemic change should also apply to the template on GitHub,
automatically, every single time.

## Why a naive file copy is wrong

The template is a **sanitized derivative** of the install, not a mirror of it. Many
`ai_os_owned` files carry real client examples in this install - a skill `SKILL.md`
that names a specific client, a doc that walks through that client's dashboard, a
test that uses a client slug as a fixture, a `notion-sync` plist with the maintainer's
home path. The template holds generic versions of those same files.

A blind copy of every changed `ai_os_owned` file would overwrite the clean template
versions with the personalized ones and leak client data to a public repo. This was
proven the first time the sanitizer ran: dozens of changed files tripped it.

Two rejected alternatives:

- **Auto-rewrite in flight** (replace a client name with a placeholder, home path
  with `$HOME`).
  Rejected: a single missed string leaks client data publicly, and silent transforms
  are exactly the kind of hidden decision AI-OS is built to avoid. The cost of a miss
  is unbounded; the safe failure is to not send the file.
- **Abort the whole sync on any dirty file.** Rejected: one personalized file would
  block every clean structural change, so nothing would ever propagate.

## The design

`scripts/template-sync.sh` owns it. Per changed file:

1. **Scope.** Take tracked files matching `ai_os_owned` (from
   `config/update-manifest.json`), drop any that also match `user_owned`. That deny
   overlay is why `SKILL.local.md`, `context/MEMORY.md`, `clients/`, `brand_context/`,
   `projects/`, and `.env` can never move even though their parent globs are owned.
2. **Mirror.** Clone the template once to `.backup/template-mirror/` (gitignored),
   refresh it to `origin/main`, copy the scoped files in, and prune owned files that
   the install has deleted.
3. **Sanitize per file.** `scripts/lib/sanitize-strings.sh` builds the needle set:
   static personal identifiers (written with string concatenation so the scanner file
   never contains the literal and cannot self-flag or leak), plus client slugs and
   display names derived live from `clients/*`. A file with an un-allowed hit is
   reverted in the mirror and added to the held list. Clean files stay staged.
4. **Land on a branch.** Commit the clean staged files to a rolling
   `template-sync/main` branch, force-push it, and keep one open PR. The template's
   protected `main` only advances when that PR is merged.

Held files are reported every run (dry-run output, the log, the commit body) so
sanitizing them is a visible, deliberate act, never a silent drop and never a silent
transform.

## Disarmed by default

`template-sync.sh` and `template-sync-notify.js` are `ai_os_owned`, so they ship in
the template and every install gets them. If auto mode pushed by default, every
downstream install would try to push to the maintainer's template. So auto mode is a
silent no-op unless the install ran `template-sync.sh --arm`, which writes a flag to
user-owned, gitignored `.command-centre/template-sync-armed`. Only the maintainer's
install is armed. The arm flag never propagates (it is user-owned and gitignored).

## Enforcement surfaces

Prose gets dodged; hooks and scripts do not. Same pattern as the memory and evolution
loops:

- **Claude Code:** SessionEnd hook `.claude/hooks/template-sync-notify.js` runs
  `--auto` fire-and-forget after `base-autosave` commits the session's edits. Detached,
  so session end is never blocked by network I/O.
- **Every tool:** `meta-wrap-up` Step 3i runs the same script after logging evolution,
  covering Cursor and Codex, which have no SessionEnd hook.
- **Manual:** `--dry-run` previews, `--arm` / `--disarm` / `--status` control it.

## Relationship to existing pieces

- **`update-manifest.json`** is the shared ownership contract. Propagation reads the
  same file the updater reads, so the two directions can never disagree about what is
  shareable.
- **`template-release-check.sh`** stays the read-only release proof (fresh clone, no
  personal strings, tests pass). Propagation is the write path that feeds it; the
  release check is the gate before the template's `main` is trusted for publishing.
- **The evolution log** documents *why* the system changed; template propagation ships
  *what* changed. A systemic session touches both: log the shift, propagate the files.

## Regression to avoid

Do not turn this into a silent in-flight rewriter (one missed string leaks). Do not
push straight to template `main`. Do not widen the scope past `ai_os_owned`. Do not
arm it by default for downstream installs. Do not make the SessionEnd hook blocking.
