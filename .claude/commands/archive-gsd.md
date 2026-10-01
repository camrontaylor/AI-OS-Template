# /archive-gsd

Mark a GSD project as complete. GSD operates in two modes:

- **Flat mode** — single project, files at `.planning/` root. Archive flips the brief status only.
- **Workstream mode** — multiple projects at `.planning/workstreams/{slug}/`. Archive runs
  `workstream complete` (moves state to `.planning/milestones/`) then flips the brief.

## Steps

### Step 1: Detect GSD mode

Run:
```
node ~/.claude/get-shit-done/bin/gsd-tools.cjs workstream list --raw
```

Parse the `mode` field:

- **`"flat"`** → flat mode means a single project with no workstreams. This is the default. **Immediately proceed to Step 2a** — do NOT stop here, the project brief may still exist.
- **`"workstream"` with workstreams** → go to Step 2b.
- **`"workstream"` with no workstreams** → tell the user: "No active GSD project found — nothing to archive."

### Step 2a: Flat mode — find the active brief

Scan `projects/briefs/*/brief.md` for `level: 3` and `status: active`.

- **None** → "No active GSD project found — nothing to archive."
- **One** → continue to Step 3a.
- **Multiple** → ask the user which one to archive.

### Step 2b: Workstream mode — pick the workstream

- **One workstream** → continue to Step 3b.
- **Multiple** → ask the user which one to archive.

### Step 3a: Confirm (flat mode)

> "I'll mark the GSD project **{brief-name}** as complete:"
> - Update `projects/briefs/{slug}/brief.md` → `status: complete`
> - `.planning/` stays in place
>
> "Go ahead?"

Wait for confirmation, then flip `status: active` → `status: complete` in the brief frontmatter.

### Step 3b: Confirm (workstream mode)

> "I'll archive the GSD project **{workstream-name}**:"
> - Run `workstream complete {workstream-name}` → moves planning state to `.planning/milestones/`
> - Update `projects/briefs/{slug}/brief.md` → `status: complete`
>
> "Go ahead?"

Wait for confirmation, then:

1. Run:
```
node ~/.claude/get-shit-done/bin/gsd-tools.cjs workstream complete {slug} --raw
```

2. Find the matching brief at `projects/briefs/*/brief.md` where the folder name matches
   the workstream slug and `level: 3` and `status: active`.

3. Flip `status: active` → `status: complete` in the brief frontmatter.

### Step 4: Report

**Flat mode:**
> "Done. **{project-name}** is archived."
>
> - Brief: `projects/briefs/{slug}/brief.md` (status: complete)
> - Planning: `.planning/` (unchanged)

**Workstream mode:**
> "Done. **{workstream-name}** is archived."
>
> - Planning state: `.planning/milestones/ws-{slug}-{date}/` (moved by GSD)
> - Brief: `projects/briefs/{slug}/brief.md` (status: complete)

## Anti-Patterns

- Never delete `.planning/` files manually — use `workstream complete` in workstream mode.
- Never archive without user confirmation.
- Never assume workstream mode — always check `mode` from `workstream list --raw`.
