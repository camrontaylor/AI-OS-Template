# Team Context

This folder holds shared Team OS context.

Use these files for information that should apply to everyone connected to the
team server. Do not put private user notes, API keys, passwords, or tokens here.

Typical files:
- `AGENTS.md` - shared team-level instructions loaded by Team OS snapshots
- `team-profile.md` - what the team is and how it works
- `operating-rules.md` - shared working rules
- `shared-preferences.md` - shared preferences for outputs and workflow
- `prompt-tags.md` - shared prompt tags available to the team

Do not add a `CLAUDE.md` or `.claude/` folder here. Runtime rules and skills
stay at the AI-OS root or inside client workspaces. This folder is shared
team context, not a separate workspace.
