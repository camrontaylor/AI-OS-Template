# Team Context Agent Instructions

This file holds shared team-level instructions for Team OS. It is loaded when
the Team OS context snapshot includes team context.

Apply these instructions after the root `AGENTS.md` system rules and before
private user or client-specific context.

## Rules

- Treat the Team OS server snapshot as the source of truth for team, user, and
  client context.
- Use `team_context/team-profile.md` to understand what the team does.
- Use `team_context/operating-rules.md` for shared approval, review, and
  working rules.
- Use `team_context/shared-preferences.md` for team-wide output and workflow
  preferences.
- Use `team_context/prompt-tags.md` only when prompt tags are needed.
- Load available brand or client files when the task needs that extra context;
  do not assume details that are only listed as available.
- Keep private user notes out of `team_context/`. Private preferences belong in
  `context/USER.md` or `context/MEMORY.md`.
- Keep client-only information in the selected client's context, not in shared
  team files.
- Keep skills in the root or client `.claude/skills/` folders. Do not treat
  `team_context/` as a separate AI-OS workspace.

## Folder Roles

- `team_context/AGENTS.md` - team-level instructions.
- `team_context/team-profile.md` - team identity and operating context.
- `team_context/operating-rules.md` - shared rules for how work is handled.
- `team_context/shared-preferences.md` - shared style and workflow preferences.
- `team_context/prompt-tags.md` - team prompt tags.
- `brand_context/` - shared brand context.
- `clients/{slug}/` - client-specific context.
