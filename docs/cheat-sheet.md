# AI-OS Cheat Sheet

## Daily Operations

| Action | How |
|--------|-----|
| Start working (solo) | `cd ~/Projects/AI-OS && claude` |
| Start working (client) | `cd ~/Projects/AI-OS/clients/client-name && claude` |
| End session | Just say "done" or "that's it" — wrap-up runs automatically |
| Switch clients | End session → new terminal → `cd` into different client folder |
| Quick clear (no save) | `/clear` (end session first to save context) |
| First time with new client | Just open Claude — onboarding runs automatically |

## Client Management

| Action | Command |
|--------|---------|
| Add a new client | `bash scripts/add-client.sh "Client Name"` |
| Update AI-OS (auto-syncs clients) | `bash scripts/update.sh` |
| Migrate/setup memory | `bash scripts/setup-memory.sh` |

## Skills

| Action | Command |
|--------|---------|
| List available | `bash scripts/list-skills.sh` |
| Add skill | `bash scripts/add-skill.sh skill-name` |
| Remove skill | `bash scripts/remove-skill.sh skill-name` |

## Scheduled Jobs

The Command Centre schedules jobs while it is running. If you want scheduling with the UI closed, start the managed daemon manually.

| Action | Command |
|--------|---------|
| Start daemon | `bash scripts/start-crons.sh` |
| Stop daemon | `bash scripts/stop-crons.sh` |
| Runtime status | `bash scripts/status-crons.sh` |
| Daemon logs | `bash scripts/logs-crons.sh` |
| Run job manually | `bash scripts/run-job.sh job-name` |
| Check job logs | `cat cron/logs/job-name.log` |
| List jobs | `ls cron/jobs/` or ask Claude "what's scheduled?" |

## Projects ([full guide](projects-guide.md))

| Level | Name | How | Where |
|-------|------|-----|-------|
| **1** | Single task | Just ask Claude | `projects/{category}-{type}/` |
| **2** | Planned project | Claude scopes it → project folder with `brief.md` | `projects/briefs/{project-name}/` |
| **3** | GSD project | `/gsd:new-project` → full phased planning | `projects/briefs/{project-name}/` + `.planning/` |

Level 1 output goes to category folders. Level 2/3 output goes inside the project folder alongside `brief.md`. Claude automatically helps you pick the right level when you state your goal. Run `/archive-gsd` when a GSD project is done; `.planning/` stays in place as the project record.

## Key Paths (within your working folder)

| What | Where |
|------|-------|
| Brand voice | `brand_context/voice-profile.md` |
| Session memory | `context/memory/YYYY-MM-DD.md` |
| Learnings | `context/learnings.md` |
| Single task output | `projects/{category}-{type}/` |
| Project output | `projects/briefs/{project-name}/` (with `brief.md`) |
| Project brief | `projects/briefs/{project-name}/brief.md` |
| GSD planning | `.planning/` (one at a time, at project root) |
| API keys | `.env` |
| Skills | `.claude/skills/` |
| Team instructions | `team_context/AGENTS.md` |
| Team shared context | `team_context/` |
| Client instructions | `AGENTS.md` (in client folder) |
| Claude compatibility wrapper | `CLAUDE.md` (in client folder) |
| Shared methodology | `AGENTS.md` (at AI-OS root) |

## Where Skills Live

| What | Path |
|------|------|
| Shared skills (the only copy) | `.claude/skills/` at root |
| Client-only skills and `SKILL.local.md` overrides | `clients/client-name/.claude/skills/` |
| Skill methodology | `.claude/skills/{skill-name}/SKILL.md` |
| Skill reference material | `.claude/skills/{skill-name}/references/` |
| Available skills catalog | `.claude/skills/_catalog/catalog.json` |

Add/remove/edit shared skills at the **root**. Clients inherit them from there, so a root edit is live in every client right away with no sync step. Client-only skills and client `SKILL.local.md` overrides are never touched by updates.

To stop one client from inheriting a specific root skill, add it to `skillOverrides` in that client's `.claude/settings.local.json`:

```json
{ "skillOverrides": { "skill-name": "off" } }
```

That is per client, so other clients and the root are unaffected. A client you create later starts with the exclusions shared by every client that has overrides; clients without any abstain, and exclusions made in only some stay where they were made.

Because skills resolve from the enclosing repository root, a client folder moved outside the AI-OS install resolves no skills. To work from one anyway, start with `claude --add-dir /path/to/AI-OS`.

## Rules of Thumb

- Solo user? Work from the root folder. Nothing extra needed.
- Multiple clients? One client folder each, inside `clients/`.
- End session before switching clients — wrap-up runs automatically
- Onboarding runs automatically on first session per client
- Edit shared skills at the **root** level: clients read them from there, nothing is copied
- Put client-specific skill changes in `SKILL.local.md` — updates preserve it
- Client-only skills are fine: create them in the client's `.claude/skills/` folder, and do not register them in the root skill registry
- Avoid naming a client skill after a root skill, because it shadows the root version locally and stops getting updates
- Edit root AGENTS.md → all clients see the shared methodology automatically
- Edit team_context/AGENTS.md → Team OS snapshots get shared team-level instructions
- Edit root SOUL.md / USER.md → all clients see it automatically
- Do not put CLAUDE.md or `.claude/` inside `team_context/`; it is shared context, not a workspace
- `update.sh` auto-syncs scripts, hooks, settings, and cron templates to all clients; shared skills need no sync because clients inherit them
- Keep client folders inside the AI-OS install; moved outside, they lose skill inheritance
- Skills always have fallbacks — no API key required to start working
