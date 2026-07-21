---
name: str-research-findings
description: >
  Capture the user's own research notes, pasted findings, discovery calls, and tool-stack hypotheses into the root AI-OS research hub, even with no URL. Use when research should be saved for future use across AI-OS or clients. Not for live web trend research (str-trending-research) or simple URL capture (str-resources).
---

# Research Findings

Capture useful research and discovery into a durable root-level notebook that future AI-OS and client sessions can consult.

## Outcome

- A markdown finding saved under `projects/str-research-findings/{YYYY-MM-DD}_{slug}.md`.
- `projects/str-research-findings/INDEX.md` updated with a one-line pointer.
- Client applicability recorded without copying root research into client memory by default.
- Major implications logged to `context/learnings.md` under `## str-research-findings` only when the finding changes how future work should run.

## Context Needs

| File | Load level | Purpose |
|------|------------|---------|
| `projects/str-research-findings/INDEX.md` | Full | Avoid duplicates and link related findings. |
| `projects/str-research-findings/README.md` | Full | Follow the hub workflow and promotion rules. |
| `context/learnings.md` | `## str-research-findings` section | Reuse feedback and capture durable process lessons. |
| `context/MEMORY.md` | Summary when relevant | Check active threads before promoting a finding into hot memory. |
| `clients/*/AGENTS.md` | Only when a finding targets a named client | Confirm client scope before writing client-local pointers. |

## Skill Relationships

- Upstream: `str-resources` captures URL-based resources; `tool-youtube` captures video sources; `str-trending-research` creates fresh market/trend research.
- Downstream: `memory-recall`, strategy skills, client discovery, and future architecture work can consult the research hub.
- Trigger conflict: If the input is mainly a URL, use `str-resources`. If the user asks for new live research, use `str-trending-research`. If the user provides their own note, call, paste, synthesis, or finding to preserve, use this skill.

## Step 1: Classify The Finding

Read the user input and classify it as one or more of:

- Tool stack
- Workflow/process
- Client-service model
- AI-OS system idea
- Market/positioning insight
- Client-applicable insight
- Personal/operator note

If the finding includes claims that could change quickly, mark them as `needs verification` unless you have just verified them from primary sources.

## Step 2: Check Existing Hub

Read `projects/str-research-findings/INDEX.md` if it exists. Search `projects/str-research-findings/` for the main concepts and source names before creating a new file.

If a related finding exists, add a "Related findings" link in the new record rather than rewriting the older one.

## Step 3: Save Output

Resolve the AI-OS repo root first:

```bash
git rev-parse --show-toplevel
```

Create the root hub folder if needed.

Always save output to disk. This is not optional. Save findings to:

```text
{AI-OS repo root}/projects/str-research-findings/{YYYY-MM-DD}_{descriptive-slug}.md
```

After saving, show the user the full absolute file path so they can click it directly.

Use the template in `references/finding-template.md`. Keep the raw pasted/source text at the bottom when it is useful for provenance, but summarize the reusable insight near the top.

## Step 4: Update The Index

Update `projects/str-research-findings/INDEX.md` with:

- date
- title
- tags
- one-line takeaway
- status: `finding`, `needs verification`, `promoted`, or `parked`
- link to the saved file

Keep newest entries first.

## Step 5: Decide Promotion

Do not automatically promote every finding into operating memory or system rules.

Use this promotion path:

- Keep in research hub when it is useful reference material.
- Add a short note to `context/learnings.md` when it changes how a skill or workflow should behave.
- Add to `context/MEMORY.md` only when it is an active thread or a stable fact needed at session start.
- Update `AGENTS.md`, docs, or a skill only after the finding becomes a decision, rule, or repeatable workflow.
- For a client-specific use, create a pointer in that client's project folder only after the user confirms the client scope.

## Step 6: Ask For Feedback

After a major research capture, ask how the structure landed. If the user corrects the workflow or format, update `## Rules` in this skill immediately and log broader feedback to `context/learnings.md`.

## Rules

- 2026-06-29: The root research hub is for the user's own reusable findings and discovery notes. It is not a replacement for memory, client context, or source-of-truth docs.
- 2026-06-29: Research findings are reference material by default. Mark uncertain or time-sensitive claims as `needs verification` instead of promoting them as facts.
- 2026-06-29: Save canonical findings in the root AI-OS `projects/str-research-findings/` folder so they can inform all clients without leaking client-specific memory between folders.

## Self-Update

If the user flags an issue with the output - wrong approach, bad format, missing context, incorrect tone, or poor promotion logic - update the `## Rules` section in this SKILL.md immediately with the correction. Do not only log it to learnings.

## Troubleshooting

- If `INDEX.md` is missing, create it before saving the first finding.
- If the finding is client-specific but the session is at the root, ask the client-routing confirmation question before writing inside `clients/*`.
- If a pasted finding contains external claims that matter for a decision, either verify from primary sources or clearly mark the claim as unverified.
