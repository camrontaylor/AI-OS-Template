# Template Release Proof

The release source of truth for the public template is:

```text
https://github.com/camrontaylor/AI-OS-Template.git
branch: main
```

The local `ai-os-template` folder is not source of truth by itself. Treat it as a
candidate checkout until its Git history, remote, branch, and contents have been
proved. If it has corrupt Git history or unknown local edits, rebuild a fresh
checkout from the GitHub template repo instead of pushing from it.

## Run The Check

From the AI-OS repo:

```bash
bash scripts/template-release-check.sh
```

That command clones the template repo to a temporary folder, verifies the remote,
branch, and commit, scans tracked files for high-risk personal or client strings,
checks for generated artifacts, and runs the memory/routing guard tests. It is
read-only and does not push.

To inspect an existing local checkout without network:

```bash
bash scripts/template-release-check.sh --path ~/Desktop/AI/ai-os-template --skip-network
```

A passing run ends with:

```text
READY: template <sha> passed release check.
Proof: <repo> <branch> <full-sha>
No push or publish was performed.
```

## Approval Gate

Publishing the template is an external action. Before pushing, merging, tagging,
or changing GitHub template settings, use the AGENTS.md external-action approval
gate and name:

- Target: the exact template repo URL and branch.
- Action: push, merge, release, or settings update.
- Artifact: the commit hash, PR URL, tag, or setting.
- Risk: what changes for future template users.

Generic "continue" approval is not enough for a template publish.

## Template Propagation Mechanics (canonical detail; AGENTS.md points here)

`scripts/template-sync.sh` flows documented systemic changes from this install out to the template repo (`camrontaylor/AI-OS-Template`, the `upstream` remote) - the reverse direction of `scripts/update.sh`. Every safety property is enforced in the script, not left to the agent:

- **Allowlist-scoped.** Only files matching `config/update-manifest.json` `ai_os_owned` propagate, minus anything matching `user_owned`. Client memory, brand context, projects, `.env`, and per-client folders can never move.
- **Sanitizer-gated.** Every changed file is scanned for private strings (`scripts/lib/sanitize-strings.sh`), with client slugs and display names derived live from `clients/*` so a client added later is covered without editing a list. A file carrying a client name, display name, or the maintainer's home path is held back and reported, never silently rewritten - a missed rewrite would leak client data to a public repo. Clean files still propagate; held files surface for deliberate sanitizing.
- **Branch, not main.** Changes land on a rolling `template-sync/main` branch with one open PR, force-updated each run. They reach the template's protected `main` only when that PR is merged.
- **Disarmed by default.** The script and its hook ship in `ai_os_owned`, so every install gets them, but auto mode is a silent no-op unless the install ran `template-sync.sh --arm` (the arm flag lives in user-owned, gitignored `.command-centre/`). Only the maintainer's install is armed; a downstream install never pushes to the maintainer's template.

Enforcement surfaces: the Claude Code SessionEnd hook `.claude/hooks/template-sync-notify.js` runs `template-sync.sh --auto` fire-and-forget after `base-autosave`; `meta-wrap-up` Step 3i runs the same script in every tool; manual control via `--dry-run` / `--arm` / `--disarm` / `--status`.

Regression to avoid: do not turn this into a silent auto-rewriter that strips client names in flight (one missed string leaks), do not push straight to template `main`, do not widen the allowlist past `ai_os_owned`, and do not arm it by default for downstream installs.
