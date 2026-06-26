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

For maintainer-specific leakage checks, pass a comma-separated scan list:

```bash
AI_OS_TEMPLATE_PRIVATE_SCAN_TERMS="Client Name,/Users/yourname" bash scripts/template-release-check.sh
```

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
