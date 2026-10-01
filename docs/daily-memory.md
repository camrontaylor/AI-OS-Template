# Daily Memory — template & tracking

Claude runtime detail migrated out of `CLAUDE.md`. Loaded on demand.

Every Claude session writes to `context/memory/{YYYY-MM-DD}.md` — one file per
day, numbered session blocks.

```markdown
## Session N

### Project
[Project folder name if working on a Level 2 or 3 project. Omit for single tasks.]

### Goal
[One line — filled once the user states their goal]

### Deliverables
- `path/to/file` — what it is

### Decisions
- [Decision and rationale]

### Corrections
- [general] [Confirmed lesson, or use an installed skill name as the tag]

### Open threads
- [Anything unfinished for the next session]
```

When a memory file has a `### Project` reference, load
`projects/briefs/{project-name}/brief.md`.

## Auto-tracking (silent — never announce)

Track events as they happen. Never say "I've logged that to memory."

- File created/modified in `projects/` → `### Deliverables`
- File created in `brand_context/` or `.claude/skills/` → `### Deliverables`
- User states goal → `### Goal`
- User makes a directional decision → `### Decisions`
- Confirmed mistake → `### Corrections`, tagged with the installed skill or `general`
- Task left incomplete → `### Open threads`

Save accepted changes before dependent actions. After verification, update the
result or next action and read the changed entry back. Skip trivial or unchanged
state. Promotion and recovery rules: `agent-reliability.md`. Team mode uses only
authorized connected storage; this local file flow is Solo-only.

## Session end

On common sign-off messages, run the full `meta-wrap-up` skill automatically.
Finalise the existing session block rather than creating a new one. Keep entries
concise and skimmable.
