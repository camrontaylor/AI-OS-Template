# AI-OS Glossary

Plain-English definitions for common AI-OS terms.

## Core Terms

| Term | Meaning |
|---|---|
| AI-OS | A local workspace that gives agent tools shared rules, memory, skills, projects, and client context. |
| Agent | The AI assistant doing the work in the current session. |
| Agent harness | The tool or app running the agent, such as Claude Code, Codex, Cursor, Hermes, or another compatible runtime. |
| Claude Code | An agent harness that can run inside the AI-OS repo and read `CLAUDE.md`. |
| Codex | An agent harness that can read `AGENTS.md` directly in the project. |
| Cursor | An editor-based agent harness that reads AI-OS through its rules pointer. |
| Hermes | A compatible AI harness can use AI-OS when it follows the project instructions and file structure. |
| `AGENTS.md` | The main AI-OS instruction file. It is the runtime contract for compatible agents. |
| `CLAUDE.md` | The Claude Code adapter. In AI-OS, it points Claude back to `AGENTS.md`. |
| `/start-here` | The first-run onboarding command for new users. It points to `/onboarding`. |
| `/onboarding` | The setup flow that builds user profile, brand context, skill selection, and first-session orientation. |
| Command Centre | Optional local dashboard for projects, jobs, clients, tasks, and system state. |

## Skill Terms

| Term | Meaning |
|---|---|
| Skill | A reusable method stored in `.claude/skills/{skill}/SKILL.md`. |
| Live skill | A skill currently available in `.claude/skills/`. |
| Optional skill | A skill offered during setup because some users need it and others do not. |
| Meta skill | A skill that maintains AI-OS itself, such as memory, docs, wrapping up, or skill creation. |
| Skill catalog | The generated reference at `docs/skills-catalog.md`. |
| Skill local override | A `SKILL.local.md` file beside a skill for user-owned additions. |

## Memory Terms

| Term | Meaning |
|---|---|
| Hot memory | `context/MEMORY.md`. A small active note loaded at session start. |
| Daily log | `context/memory/YYYY-MM-DD.md`. The dated record of sessions. |
| Learnings | `context/learnings.md`. Durable lessons, often grouped by skill. |
| Client memory | Memory files inside `clients/{client}/context/`. |
| Current-state brief | A generated client summary that gives the agent recent client context. |
| Semantic recall | Searching memory by meaning, not only exact words. |
| Markdown fallback | Direct search over memory files when semantic search is unavailable. |
| MemSearch | The search helper AI-OS uses through wrapper scripts. |
| Embedding | A numeric representation of text meaning. Users usually do not edit or inspect it. |
| Vector database | A search database for embeddings. Usually needed for production retrieval, not ordinary AI-OS memory. |

## Work Terms

| Term | Meaning |
|---|---|
| Level 1 | A small task or single deliverable. |
| Level 2 | A planned project with a brief and multiple deliverables. |
| Level 3 | A complex project that needs structured planning, execution, and verification. |
| Live project | An ongoing system, such as a website, dashboard, or automation. |
| Brief | A project file that states the goal, context, deliverables, and acceptance criteria. |
| Worktree | A separate checkout used for isolated code work. |
| GSD | A separate planning framework that can help with complex multi-step projects. |

## Setup Terms

| Term | Meaning |
|---|---|
| First-run setup | The initial `/start-here` flow that gets AI-OS ready for use. |
| Brand foundation | The first useful set of voice, sample, positioning, and ideal-customer files. |
| Brand context | Files that describe voice, positioning, offers, audience, and examples. |
| Skill selection | The setup step where a user chooses which optional skills to keep. |
| Backup remote | The user's own private GitHub repo for their AI-OS copy. |
| Client workspace | A folder under `clients/{client}/` with separate memory, brand context, projects, and instructions. |

## Automation Terms

| Term | Meaning |
|---|---|
| Cron job | A scheduled task defined in `cron/jobs/`. |
| Cron daemon | The local process that reads job files and runs them on schedule. |
| Nightly jobs | Scheduled memory and maintenance work, usually grouped into one nightly window. |
| Launchd | The macOS service system used to keep local background processes running. |
| Hook | A script run around session or tool events to enforce rules or update state. |

## Integration Terms

| Term | Meaning |
|---|---|
| Connector | A connection to an outside tool such as Notion, Figma, Google Calendar, GitHub, or Vercel. |
| MCP | Model Context Protocol. A way tools expose actions and data to agents. |
| `.env` | Gitignored file for local API keys and secrets. |
| External write | Any action that changes something outside the local workspace, such as a push, deploy, send, or Notion update. |
| Observability | Logs, traces, costs, scores, and failure records for repeated model workflows. |
| Hosted retrieval | Search infrastructure used by a production app or multi-user workflow. |

## Source Of Truth Rule

When terms conflict, trust this order:

1. `AGENTS.md` for runtime rules.
2. `docs/meta/` for design intent.
3. Practical docs in `docs/` for user guidance.
4. Memory files for session history and local decisions.
