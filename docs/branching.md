# Branching Policy

`main` is always protected: a PR is required to merge (no direct push), CI status
checks must pass, and no force-pushes or deletions.

`dev` is the working branch. How a change flows depends on its zone:

- **Content** (`projects/`, `brand_context/`, `context/`, `cron/jobs/`,
  `clients/*/`) — commits directly to `dev`.
- **Config** (`.claude/skills/*/SKILL.md`, `AGENTS.md`, `CLAUDE.md`,
  `.env.example`, `scripts/*.sh`) — may commit directly, but a feature branch is
  advised.
- **Code** (`command-centre/src/**`, `.claude/hooks/*.js`, runtime JS/TS) —
  should use a feature branch off `dev`.

**Release:** promote `dev` to `main` via PR (`main` is protected: PR required,
CI must pass, no force-push). A release bumps `VERSION` and, in the same commit,
runs `npm version <X.Y.Z> --no-git-tag-version` in `command-centre/` so
`package.json` and `package-lock.json` match; CI enforces this with
`scripts/check-version-sync.sh`.

**Solo defaults:** no PR approval required; auto-merge available on release PRs.
Teams can tighten by requiring 1 approval on `main` PRs and disabling auto-merge.


## Workspace automation

Local autosave on main creates a separate recovery branch before committing.
Return-to-main preserves that snapshot; it does not release it. Worktrees start
from local dev and keep code isolated while using the primary Solo context.
Automatic remote backup is opt-in to a verified private GitHub remote and pushes
only autosave refs. Main/dev updates and releases keep the PR policy above.
Commands and limits: [Saving and isolated workspaces](worktree-workspace.md).
