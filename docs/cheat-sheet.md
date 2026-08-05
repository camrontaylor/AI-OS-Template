# AI-OS Cheat Sheet

## Daily Operations

| Action | How |
|--------|-----|
| Start working (solo) | `cd ~/Projects/AI-OS && claude` |
| Start working (client) | `cd ~/Projects/AI-OS/clients/client-name && claude` |
| End session | Just say "done" or "that's it" — wrap-up runs automatically |
| Switch clients | End session → new terminal → `cd` into different client folder |
| Quick clear (no save) | `/clear` (end session first to save context) |
| First time with new client | Open the client folder in your AI-OS agent and run `start-here` |

## Client Management

| Action | Command |
|--------|---------|
| Add a new client | `bash scripts/add-client.sh "Client Name"` |
| Update AI-OS (auto-syncs clients) | `bash scripts/update.sh` |
| Set up searchable memory | `bash scripts/setup-memory.sh` |
| Clear stuck Windows MemSearch watchers | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-memsearch-watchers.ps1` |

## Memory Search

| Action | Command |
|--------|---------|
| Search root memory | `bash scripts/memsearch-search.sh "query" 10 --scope root` |
| Search one client | `bash scripts/memsearch-search.sh "query" 10 --scope client --client client-name` |
| Search all clients | `bash scripts/memsearch-search.sh "query" 10 --scope clients` |
| Use markdown fallback directly | `bash scripts/memory-search.sh "query" 10 --scope all` |
| Refresh semantic index | `bash scripts/memsearch-reindex.sh` |

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
| **3** | GSD project | `/gsd-new-project` → full phased planning | `projects/briefs/{project-name}/` + `.planning/` |

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
| Client instructions | `AGENTS.md` (in client folder) |
| Claude compatibility wrapper | `CLAUDE.md` (in client folder) |
| Shared methodology | `AGENTS.md` (at AI-OS root) |
| Design source of truth | `docs/meta/README.md` |
| Health reports | `projects/system-health/` |

## Where Skills Live

| What | Path |
|------|------|
| Master copy (source of truth) | `.claude/skills/` at root |
| Client discovery links | `clients/client-name/.claude/skills/` |
| Skill methodology | `.claude/skills/{skill-name}/SKILL.md` |
| Skill reference material | `.claude/skills/{skill-name}/references/` |
| Live skills catalog | `docs/skills-catalog.md` |
| First-run optional menu | `.claude/skills/_catalog/catalog.json` |

Add/remove/edit skills from the **root**. They sync to clients automatically on `update.sh`. Client-only skills (created directly in a client folder) are preserved during sync.

## Rules of Thumb

- Solo user? Work from the root folder. Nothing extra needed.
- Multiple clients? One client folder each, inside `clients/`.
- End session before switching clients — wrap-up runs automatically
- Onboarding runs automatically on first session per client
- Edit shared skills at the **root** level - client paths resolve to that source
- Client-only skills are fine — create them in the client's `.claude/skills/` folder
- Edit root AGENTS.md → all clients see the shared methodology automatically
- Edit root SOUL.md / USER.md → all clients see it automatically
- `update.sh` reconciles skill and script discovery links for all clients
- Skills always have fallbacks — no API key required to start working
