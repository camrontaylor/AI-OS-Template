---
name: meta-context-intake
description: >
  Intake, classify, and review messy AI-OS context before it becomes memory or infrastructure. Use to process client context inboxes, organize client folders, or decide what goes into MEMORY.md versus reference folders. Not for simple recall (use memory-recall).
---

# Context Intake

Turns messy incoming material into a reviewable promotion plan without silently adopting it into AI-OS memory, skills, or infrastructure.

## Outcome

Produces a promotion report under `clients/{slug}/context/intake/review/{YYYY-MM-DD}_{slug}_promotion-plan.md` for client context, or `context/intake/review/{YYYY-MM-DD}_root_promotion-plan.md` for root AI-OS context. It may create intake folders, but it does not move, summarize into hot memory, or promote files without explicit user approval.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## meta-context-intake` | Prior corrections and operating preferences for this skill. |
| `config/memory-index-policy.json` | full | Current indexing tiers and promotion rules. |
| `docs/memory-search-and-observability.md` | relevant sections | Memory architecture and escalation thresholds. |
| `clients/{slug}/context/inbox/` | file list + relevant files | Incoming material to classify. |
| `clients/{slug}/context/MEMORY.md` | skim | Avoid duplicating existing hot memory. |
| `clients/{slug}/context/reference/` | file list | Avoid proposing duplicate reference files. |

## Skill Relationships

| Relationship | Skill | How it relates |
|---|---|---|
| Upstream | `memory-recall` | Search existing memory before deciding whether an inbox item is new. |
| Upstream | `meta-find-skills` | Route external skill material into the inert skill library path. |
| Downstream | `meta-memory-write` | Apply approved durable memory writes after the report is reviewed. |
| Downstream | `meta-skill-creator` | Build or modify live skills only after context intake marks the need as approved infrastructure. |
| Trigger conflict | `memory-recall` | If the user asks to find past context, recall wins. If they ask what to promote or how to organize new material, this skill wins. |

## Step 1: Load Policy And Learnings

Read `config/memory-index-policy.json` and the `## meta-context-intake` section of `context/learnings.md`. Use the policy tiers as the source of truth for whether material is routine semantic memory, selective semantic candidate, deep-search-only, or excluded.

## Step 2: Identify Scope

Choose one scope:

- Client scope: `clients/{slug}/context/inbox/`.
- Root scope: `context/inbox/`.

If the user named a client, use that client slug. If the client folder does not exist, stop and ask whether to create the client through the Add Client Flow. Do not create a client folder implicitly.

## Step 3: Run Deterministic Intake

Run the intake script from the AI-OS root:

```bash
bash scripts/context-intake.sh --client <slug>
```

For root AI-OS context, run:

```bash
bash scripts/context-intake.sh --root
```

The script creates the inbox, reference, review, and parked folders if missing. It writes a promotion plan and leaves source files in place.

## Step 4: Review The Promotion Plan

Open the generated report and check:

- every inbox item has a classification,
- the proposed destination matches the memory-index policy,
- no large raw transcript or project artifact is being proposed for hot memory,
- durable facts are proposed as summaries first, not pasted whole,
- external skills go to `skills-library/backlog/`, not live `.claude/skills/`,
- infrastructure changes require a tested prototype before adoption.

## Step 5: Apply Only Approved Promotions

After the user approves specific rows, apply them with the narrowest change that preserves source provenance:

- Hot memory: distill the smallest stable fact into `context/MEMORY.md` or `clients/{slug}/context/MEMORY.md`.
- Dated memory: summarize session or decision details into `context/memory/YYYY-MM-DD.md`.
- Reference: create or update a focused file under `context/reference/` or `clients/{slug}/context/reference/`.
- Skills: vendor candidate material into `skills-library/backlog/` and follow skill intake.
- Infrastructure: create a branch or explicit implementation plan, then test before registering it as AI-OS behavior.

Never promote an entire inbox file into hot memory just because it is important. Importance decides whether it deserves a summary; size and durability decide where it lives.

## Step 6: Verify And Report

Run the relevant focused tests after changing infrastructure:

```bash
bash scripts/test-context-intake.sh
bash scripts/test-memory-index-policy.sh
```

Report the generated promotion plan path, any approved files changed, and the tests run.

## Eval

Run these checks before changing intake policy, promotion destinations, or folder
creation behavior:

```bash
bash scripts/test-context-intake.sh
bash scripts/test-memory-index-policy.sh
```

The eval passes when intake creates review plans without promoting source files,
client material stays client-scoped, memory-index policy still controls
destinations, and large/raw material is proposed as reference or deep-search
content instead of hot memory.

## Rules

- 2026-06-29: Intake is automatic, adoption is not. Create folders and reports freely, but do not move, index, or promote inbox material without explicit approval.
- 2026-06-29: Client context stays client-scoped. Do not write client facts into root memory unless the fact is about AI-OS operations itself.
- 2026-06-29: A large client folder is not proof Pinecone is needed. First improve curation, reference structure, selective indexing, and retrieval quality.

## Self-Update

If the user flags an issue with the output, such as wrong promotion destination, unsafe indexing, missing client boundary, or too much manual review, update the `## Rules` section in this SKILL.md immediately with the correction. Do not just log it to learnings; fix the skill so it does not repeat the mistake.

## Troubleshooting

If the inbox is empty, still create the folder scaffold and report that there is nothing to promote yet.

If a file is binary or too large to read safely, classify it as deep-search-only or parked source material and propose a human-readable summary, not direct indexing.

If the user asks for full automation, separate capture and classification from promotion. The first two can be automatic; promotion needs an approval gate because it changes operating memory.
