# AI-OS Glossary

Plain-English definitions for the terms used in AI-OS.

## Core Terms

| Term | Meaning |
|---|---|
| AI-OS | The local workspace that gives agent tools shared rules, memory, skills, projects, and client context. |
| Agent runtime | The tool doing the work, such as Claude Code, Cursor, or another compatible coding agent. |
| `AGENTS.md` | The canonical instruction file for AI-OS. Agents should treat this as the runtime contract. |
| `CLAUDE.md` | Claude Code wrapper file. In AI-OS it points Claude back to `AGENTS.md`. |
| `start-here` | The canonical first-run onboarding skill for new users. It runs Q/A setup, brand context, skill selection, operating context, and orientation. Claude Code exposes it as `/start-here`. |
| `/onboarding` | A Claude Code compatibility alias that points to the `start-here` skill. |
| Skill | A reusable method stored in `.claude/skills/{skill}/SKILL.md`. Skills tell the agent how to do a type of work. |
| Meta skill | A skill that maintains AI-OS itself, such as memory, wrap-up, health checks, context intake, or skill creation. |
| Optional skill | A selectable template skill shown during first-run setup. Optional does not mean low quality; it means not every user needs it. |
| Live skill | A skill currently installed under `.claude/skills/` and available to the agent. |
| Skill catalog | The generated reference at `docs/skills-catalog.md` listing live skills and library candidates. |
| Skill local override | A `SKILL.local.md` file beside a skill. It stores user-owned additions without editing the base skill. |
| Skill naming convention | The rule that folder name, frontmatter name, slash command, and learnings section should all match. |
| Brand context | Files that describe voice, positioning, ICP, and messaging so work sounds like the right brand. |
| Client workspace | A folder under `clients/{client}/` with separate memory, brand context, projects, and instructions. |
| Command Centre | Optional local dashboard for AI-OS projects, jobs, clients, and tasks. |

## Memory Terms

| Term | Meaning |
|---|---|
| Hot memory | `context/MEMORY.md`. Small active scratchpad loaded at session start. |
| Daily log | `context/memory/YYYY-MM-DD.md`. The chronological record of each session. |
| Learnings | `context/learnings.md`. Durable lessons, often grouped by skill. |
| Semantic recall | Searching memory by meaning, not just exact words. |
| Markdown fallback | Direct search over memory files when semantic search is unavailable. |
| MemSearch | The semantic recall tool AI-OS uses through wrapper scripts. |
| Milvus Lite | The local vector database MemSearch uses on macOS/Linux. It stores the derived semantic index. |
| Zilliz | Managed Milvus. Useful when a remote Milvus backend is better than local Milvus Lite. |
| Pinecone | Managed vector database usually used for production app retrieval, not normal AI-OS workspace memory. |
| Embedding | A list of numbers representing text meaning so related text can be found semantically. |
| Vector database | A database optimized for storing embeddings and finding nearby meanings. |

## Work Terms

| Term | Meaning |
|---|---|
| Level 1 | A single task or small deliverable. Usually saved under `projects/{category-type}/`. |
| Level 2 | A planned multi-deliverable project with a brief under `projects/briefs/{project}/`. |
| Level 3 | A complex project using GSD planning plus a project brief. |
| Live project | A running system, such as a website or automation, maintained over time under `projects/live/{name}/`. |
| Brief | A project file that states goal, deliverables, acceptance criteria, and context. |
| GSD | A separate structured planning/execution framework for complex multi-phase work. |
| Worktree | A separate checkout used for isolated code work. AI-OS does not create these by default. |

## Setup Terms

| Term | Meaning |
|---|---|
| First-run setup | The initial `start-here` flow that creates enough context for AI-OS to be useful. |
| Brand foundation | The first usable set of `voice-profile.md`, `samples.md`, `positioning.md`, and `icp.md`. |
| Skill selection | The first-run step that lets a user keep all optional skills or remove ones they do not need. |
| Backup remote | The user's own private GitHub repo for their AI-OS copy, separate from the upstream template. |
| Client setup | Creating a `clients/{client}/` workspace and then running `start-here` inside it. |

## Automation Terms

| Term | Meaning |
|---|---|
| Cron job | A scheduled task defined in `cron/jobs/`. |
| Cron daemon | The local process that reads cron job files and runs them on schedule. |
| Nightly jobs | Scheduled memory and maintenance jobs, usually grouped into one nightly wake window. |
| Launchd | macOS service system used to keep the AI-OS cron daemon running after login. |
| Hook | A script run by the agent/runtime around session or tool events. Hooks enforce rules and update state. |

## Integration Terms

| Term | Meaning |
|---|---|
| Connector | A tool connection such as Notion, Figma, Google Calendar, or Vercel. Usually managed outside the repo. |
| MCP | Model Context Protocol. A way for tools and apps to expose actions/data to agents. |
| `.env` | Gitignored file for local API keys and secrets. Do not put secrets in memory or docs. |
| Langfuse | Observability tool for model calls, traces, prompt versions, evals, cost, and failures. |
| LangChain | Framework for building LLM apps and chains. |
| LangGraph | Framework for stateful agent workflows and graphs. |
| LangSmith | LangChain's observability, tracing, and eval platform. |

## Source Of Truth Rule

When terms conflict, trust this order:

1. `AGENTS.md` for runtime rules.
2. `docs/meta/` for design intent.
3. Practical docs in `docs/` for user guidance.
4. Memory files for session history and local decisions.
