# Saving and isolated workspaces

AI-OS saves ordinary Solo work locally at session end. It also provides separate
working folders for changes that need isolation. The Git history is shared;
Solo identity, memory and learnings belong to the primary workspace.

## What runs automatically

Claude's SessionStart hook runs `workspace-git.py start`. It links ignored local
state in a registered worktree, reports recent workspace notes and returns the
primary folder to `main` when safe. The SessionEnd hook runs `save` in the primary
checkout. It replaces the former immediate skill-override commit worker with one
saving owner. A crashed session may never fire SessionEnd; unsaved edits remain
on disk and can be saved manually.

Codex and other tools use these same commands through the startup and wrap-up
instructions. They do not acquire Claude hooks automatically. No scheduler,
connector, paid service or background daemon is required. Commands need Git and
Python 3.10 or newer; Bash wrappers also work through Git Bash. Native Windows
and macOS execution still need downstream checks.

## Local autosave

`bash scripts/base-autosave.sh` saves the primary checkout. On `dev` or a feature
branch it commits there. On `main`, it first creates an
`autosave-recovery/<timestamp>-<id>` branch and saves there, leaving `main`
unchanged. The branch change is recorded in `.command-centre/branch-state.log`.
Use the normal feature-to-dev-to-main PR flow to integrate saved work.

Autosave stages the working tree, respects `.gitignore` and holds the entire
batch for possible credentials, new payloads larger than 5 MiB, more than 50 MiB
of new payloads, submodule changes, or absolute/escaping links. It scans changed
old and new blobs, including deletions. A hold retains disk edits and staged
files; it never silently omits a file and then claims everything is saved.
Credential matching is conservative and is not a complete secret detector.
Commit a reviewed false positive deliberately. Shared context stays out of an
automatic save when it is ignored; a private backup can include tracked memory.

Detached checkouts and active merges, rebases or cherry-picks are left alone.
Commands serialize with a process-owned OS lock, released when the owner exits.
No age or PID-based lock deletion is used. Saving in the primary is separate
from explicit `worktree-autosave.sh`.

## Safe return to main

`bash scripts/base-return-to-main.sh` runs only in the primary. It returns when
the branch has no commits outside `main`, carrying dirty edits only if Git can
preserve them. It also returns from a clean autosave recovery branch while
keeping that branch and its commits. Ordinary feature/dev branches with unique
commits, dirty recovery branches and in-progress Git operations remain visible.
It never merges, pulls, resets, stashes or deletes a branch. Scheduled runs with
`AI_OS_AUTONOMOUS=1` skip automatic return.

## Worktree commands

Run repository-wide commands from the root, outside client subfolders.

| Command | Result |
|---|---|
| `bash scripts/worktree-new.sh <name>` | Creates `.worktrees/<name>` on `work/<name>`, based on local `dev` when present, otherwise `main`. |
| `bash scripts/worktree-list.sh` | Lists registered working folders and branches without changes. |
| `bash scripts/worktree-link.sh [path]` | Links missing ignored local state. Existing files and links are preserved. |
| `bash scripts/worktree-autosave.sh <name-or-path>` | Explicitly saves that worktree through the same credential and size guards. |
| `bash scripts/worktree-done.sh <name-or-path>` | Saves, archives the branch tip to a local annotated `archive/*` tag, removes the clean folder and retires the branch. |

Cleanup stops on a failed save, unsafe batch, unsaved edits, real ignored local
files, or a worktree using `main` or `dev`. It never force-removes a folder. Move
unique ignored files into the primary or another durable location first. Archive
tags are local; they are not proof of an off-machine backup. Restore a branch
with `git switch -c <new-name> <archive-tag>`.

## One Solo context

The template tracks identity and memory scaffolds. Worktree linking must not
replace those tracked files or commit absolute paths. Instead,
`python3 scripts/workspace-git.py context` reports the primary context scope.
The Claude memory adapters and hookless agent instructions read and write that
scope's context. A client worktree maps only to the same client in the primary;
it never maps to a sibling. Projects and code stay in the selected worktree.

Only missing ignored state is linked, such as `.env`, `.mcp.json`,
`.command-centre` and a local memory index. Tracked files, real destination files
and existing links are preserved. An external host-created worktree can use the
same startup/link command. Team/hosted sessions and saved, expired or unreadable
Team login state disable these local commands before Git or context access;
Team authority remains the injected snapshot.

## Optional private GitHub backup

Local saving works without a remote. Automatic pushes start only after an
explicit command:

```bash
python3 scripts/workspace-git.py enable-backup <your-private-remote>
python3 scripts/workspace-git.py disable-backup
```

The named remote must be a private GitHub repository. AI-OS uses an existing Git
credential helper to verify privacy during enablement and before every push.
It stores only the remote name and URL in ignored
`.command-centre/workspace-backup.json`, never a token. A changed URL or failed
verification defers the push and retains local commits. The maintainer template
is rejected. Pushes are non-force and target only `autosave/<current-branch>`;
they never target `main` or `dev`. Network failure does not undo local saving.
Use `python3 scripts/workspace-git.py backup` to retry deliberately after review.
This opt-in does not create a remote or publish an archive tag.

## Verification

`python3 scripts/test-workspace-git.py` exercises disposable repositories and
Claude/manual adapters without network calls. The distribution CI entrypoint
runs these tests. This checks local behavior; a downstream install must verify
its own hook execution, platform and optional private remote before claiming
live backup coverage. Undo the automatic behavior by removing the two
`workspace-lifecycle.js` bindings from your local Claude settings; manual
commands and saved branches remain available.
