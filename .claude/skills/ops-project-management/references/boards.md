> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only the authoritative snapshot; local context/config/knowledge examples apply only to Solo mode. Generated files use the dated project directory and dated filenames. User task authorization controls external writes.

# Boards — per-business config (TEMPLATE)

This is the template. Your real board mappings live in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/boards.md` — not in this repo. Copy the schema below and populate it there.

One row per business. Populated by `/ops-project-management setup [business]` and edited freely.

When the skill targets a business not listed in your local config, it falls back to `manual` mode and prompts setup.

| business | tool | board_id / URL / path | columns (if custom) | WIP override |
|---|---|---|---|---|
| _example_project_a_ | _notion_ | _<db-id>_ | _default_ | _default_ |

_No boards configured yet. Run `/ops-project-management setup <business>` to start._

---

## Default columns

If a row doesn't list custom columns, the skill uses:

```
Backlog → Ready → In Progress → Review/Blocked → Done/Archived
```

## Default WIP

```
In Progress: 3
Review/Blocked: no cap (flag at 5+)
Ready: soft cap 10
```

## Cross-portfolio WIP

Max **5 In Progress** across all boards combined. Above that, `/ops-project-management next` (cross-board) recommends finishing something before pulling new work.
