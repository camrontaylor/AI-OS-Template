# Starting an AI-OS session

These rules apply to Codex and Claude Code. `AGENTS.md` is authoritative;
`CLAUDE.md` imports it and adds only Claude runtime details.

## Scope and context

Identify the AI-OS root by its `AGENTS.md` and `.claude/skills/_catalog/catalog.json`.
If the working directory is below `clients/{slug}/`, that client is the active
scope. Resolve brand context, memory, learnings, config and projects against the
active scope. Never read sibling clients. Root skills are inherited; a client's
skill and `SKILL.local.md` take precedence for that client.

Team-connected sessions require a fresh authoritative context snapshot injected
by the connected runtime. If there is no snapshot, continue in conversation-only
mode; never substitute local context or cached team files. Do not run Solo
startup, onboarding or local memory writes in Team mode.

Scheduled jobs skip interactive onboarding and session logging; follow the job
prompt and its scope. For an ordinary Solo session, silently:

1. Read the scope's `context/SOUL.md`, `context/USER.md` and
   `context/MEMORY.md` (maximum 2,500 characters). Within a client, only these
   identity/scratchpad files may fall back to the root when absent.
2. Read today's daily memory, or yesterday's if today is absent. Follow an
   explicit `### Project` pointer when relevant. Do not scan all project files.
3. Open one numbered `## Session N` block in the active scope's daily file per
   `docs/daily-memory.md`. Reuse it during this session; don't duplicate a block
   that the onboarding flow already opened.
4. Load brand context and learnings only when the selected skill needs them.
   Check `.claude/settings.local.json` in the active client for `skillOverrides`;
   an `off` skill must not be invoked even if it appears in discovery.

For substantive Solo client work, run the root's
`scripts/workspace-maintenance.py brief --scope <active-client>` with Python 3,
then read that client's `context/current-state.md`. Use its links for targeted
source reads. It covers recent state, not the full history; recover the matching
project checkpoint before resuming work. If refresh fails, use permitted primary
client sources and report a material persistence gap. Never use this local flow
in Team mode. Details: `docs/agent-reliability.md`.

## First use

No installation interview, API key, MCP, GitHub backup, Command Centre, or
external memory service is needed for an ordinary skill task. Use available
tools and the skill's documented manual fallback when optional services are
missing. Never read or print secret values from `.env`.

If the user states a task, begin it immediately. An empty brand profile enhances
the opportunity for later setup; it never blocks the task. If the user asks to
start, set up, or onboard AI-OS, read `.claude/commands/start-here.md` and follow
its questions. Codex uses a plain request such as "Set up AI-OS"; Claude also
supports `/start-here`. If they greet without a task and no brand context exists,
give a brief introduction and offer setup or immediate work. Honor the
`context/.onboarding-skipped` marker and configured personal-hub clients.

## Skill invocation and session memory

Read the canonical `.claude/skills/{name}/SKILL.md` and any active local extension.
Codex discovers the same files through relative `.agents/skills/{name}` links;
use `$name` or normal task language. Claude uses `/name` or normal task language.
Tool names in methodology are capabilities: map them to the current agent's
available read, edit, shell, browser or connector tools. If a tool isn't
available, follow the fallback and report material limits.

Keep the daily session's goal, file paths, decisions and open threads current,
without recording secrets. Claude's Stop hook also captures session events.
Codex maintains the daily block during the session and runs `meta-wrap-up` on an
explicit sign-off; it does not depend on Claude hooks or hidden external memory.

Save material changed decisions before dependent actions. Save verified results
or the exact next unfinished action and read the changed record back before
delivery or handoff. Record confirmed mistakes under `### Corrections`; retain
that section during wrap-up. These Solo records stay in the active scope. Team
records use only the connected runtime's authorized storage.

After building or removing a skill, run `python3 scripts/sync-agent-skills.py`
from the root. This updates Codex discovery and preserves one shared source.
