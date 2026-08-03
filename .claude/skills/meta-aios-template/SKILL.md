---
name: meta-aios-template
description: "Keep the public AI-OS template repo and its Notion docs in sync with this install, without leaking client or personal content. Not for restoring cloud memory or finding/building skills."
when_to_use: 'Invoke when the request sounds like: "update the template", "sync to the template", "template sync", "is the template up to date", "update the AI-OS docs". Every outward write is approval-gated'
---

# meta-aios-template

One deliberate surface for keeping the public template in sync with this install: the GitHub template repo (`camrontaylor/AI-OS-Template`) and its Notion "AI-OS Docs" mirror. It does not reimplement sync; it drives the machinery that already exists and gates every outward write.

## When to use

The user wants to push AI-OS fixes and changes out to the template, check whether the template is current, or refresh the Notion "AI-OS Docs" pages after the system changed. Examples: "update the template", "is the template up to date", "sync the docs to Notion".

## When NOT to use

- Restoring memory into a cloud session, use `cloud-memory-restore.sh`.
- Building or finding a skill, use `meta-skill-creator` or `meta-find-skills`.
- A general install health check, use `meta-systems-check`.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `docs/template-release.md` | full | Canonical propagation mechanics and the approval gate |
| `docs/notion-template-docs-map.md` | full | Notion page map: source doc, hierarchy, ordering, care rules |
| `context/learnings.md` | `## meta-aios-template` | Known gotchas for both halves |
| `config/update-manifest.json` | targeted | The `ai_os_owned` minus `user_owned` allowlist the GitHub sync obeys |

## The two halves

### 1. GitHub template (`scripts/template-sync.sh`)

Already automatic: the SessionEnd hook `template-sync-notify.js` and `meta-wrap-up` Step 3i run `template-sync.sh --auto` every session. It is allowlist-scoped, sanitizer-gated (client names and home paths are held back, never rewritten in flight), lands on the rolling `template-sync/main` branch as one open PR, and is disarmed unless this install ran `--arm`. This skill is the manual driver:

    bash scripts/template-sync.sh --status     # arm state + last run + PR summary
    bash scripts/template-sync.sh --dry-run     # what WOULD propagate + what is held back
    bash scripts/template-sync.sh --auto        # run the sync now (updates the PR branch)

Changes reach the template's protected `main` only when the open PR is merged. That merge is an outward action (see Approval gates).

### 2. Notion "AI-OS Docs" (`scripts/notion-docs-coverage-report.sh` + the map)

Local docs are the source; Notion is the template surface. There is a coverage check but no automatic writer, on purpose: writing to Notion is an external action.

    bash scripts/notion-docs-coverage-report.sh   # read-only: are local docs, the map, and drafts aligned?

Then, page by page from `docs/notion-template-docs-map.md`: for each Notion page whose primary local source changed, refresh that page's content to match, following the map's hierarchy, ordering, icons, and "extra care" rules (root reading order, short FAQ pages stay short, memory page stays practical, external-approval language stays visible). Use the Notion connector; keep every page's existing icon and position unless the map says otherwise. Never create a duplicate page for an existing target.

## How to run (default flow)

1. `--status` then `--dry-run` for the GitHub side. Report clean-file count, held-back count, and whether the PR is behind template `main`.
2. Run `notion-docs-coverage-report.sh`. Report which pages drifted from their local source.
3. Present the outward actions as a batch (PR merge, the specific Notion pages to edit) and stop for approval.
4. On approval, execute only the approved actions, then prove each landed (PR merged URL; each Notion page verified live).

## Approval gates (both halves)

Reading, dry-runs, and coverage checks are local work and need no approval. These are outward and need the AGENTS.md external-action gate naming target, action, artifact, risk:

- Merging the `template-sync/main` PR into the template's `main`.
- Creating or editing any Notion page.

Generic "continue" never approves these. Never widen the `ai_os_owned` allowlist, never push straight to template `main`, never strip a client name in flight to force a held file through, never copy local memory / client data / `.env` values into Notion.

## Eval

```bash
bash scripts/template-release-check.sh
bash scripts/template-sync.sh --status
```

Pass when the release check finds no private/client leakage, status is read-only, template writes remain PR-gated, and Notion writes still require a separate named approval.

## Rules

- Build on the existing scripts; this skill orchestrates, it does not re-sync.
- The GitHub sanitizer is the safety boundary for client data. If it holds a file back, sanitize the source deliberately or leave it held; do not bypass it.
- Notion writes follow `docs/notion-template-docs-map.md` for structure and icons. If the live page and the map disagree, fix the local doc and map first, then sync.
- After a real sync, log an evolution entry if the change was systemic (`meta-wrap-up` Step 3i handles this) and note the outcome with live proof, not a local assumption.
- If the Notion connector is not authorized in the session, do the GitHub half and report the Notion half as blocked on connector auth, rather than skipping it silently.
