# Self-Sourcing Ladder

Lazy-loaded by Agency Discipline (see `AGENTS.md`). The rule is simple: before you ask the user anything, assume the answer exists somewhere you can reach, and go get it. Walk this ladder and stop at the first rung that answers. The ladder is mode-aware, because most of the user's work is building AI-OS itself, not client deliverables, and those need different context.

## First: pick the mode

- **Client mode.** The session is inside `clients/<slug>/`, or the pieces clearly target one client. Self-source from that client's folder.
- **System mode.** Root work on AI-OS itself: skills, hooks, memory, cron, scripts, `AGENTS.md`, the template, tooling. This is the most common mode. Self-source from the system surfaces, not a client folder.
- **Mixed.** Cross-client or shared methodology. Use system mode plus the specific client folders named.

The `agency-gather.sh` script detects the mode from the working directory and from whether the prompt names a client or a system file. You can also run it explicitly.

## Client mode ladder

- **Rung 0: In-context memory (free).** What startup already loaded: the client's `context/current-state.md`, `MEMORY.md`, today's daily log. Most durable-fact lookups die here.
- **Rung 1: Semantic and markdown memory.** `bash scripts/memsearch-search.sh "<question>" 10 --scope client --client <slug>`. Fallback `bash scripts/memory-search.sh`. Coverage check before saying "nothing": `bash scripts/lib/memory-meta.sh "<topic>"`. A Milvus lock is a tool problem, never proof memory is empty.
- **Rung 2: The client folder, via the brief, not a dump.** Run `bash scripts/agency-gather.sh <slug>`. It refreshes and reads the generated `current-state.md` (the curated brief that already indexes every reference file), then prints a manifest of `clients/<slug>/context/` and `clients/<slug>/brand_context/` (filename, first heading, size). You then issue targeted `Read` calls for the specific files the job needs. Never inline the whole folder; the busy client folder is hundreds of thousands of tokens and dumping it rots context and buries the one file that matters. The manifest is what stops you forgetting the folder exists without drowning in it.
- **Rung 3: Live connectors.** When the answer lives in a system the client works in, read it there per Task Routing: Notion, Google Drive, Gmail plus the agent inbox (`ops-agent-email`), Calendar, HubSpot, the client board (`ops-client-dashboard`). Order: native connector, then Composio, then web. Say which live path was unavailable if you fall back. Some Composio connectors need reconnect, so this rung can fail mid-task; detect and say so.
- **Rung 4: The open web.** Mandatory under the Blocker Research Gate before any "no / can't / dead end." parallel-search, the `q-question` skill, `deep-research`, `tool-firecrawl-scraper`.
- **Rung 5: Ask the user (last).** Only after Rungs 0 to 4 came up short, or the gap is not a fact at all but a genuine user-owned fork (irreversible, outward-facing, or real taste or direction). Framed as a real decision with a recommendation, never a fact you could have fetched.

## System mode ladder (AI-OS / root work)

This is the rung set for the user's most common work. It operationalizes the `CLAUDE.local.md` 2026-06-16 rule ("do at least one grounded read before asserting a verdict").

- **Rung 0: In-context memory (free).** Root `context/MEMORY.md`, today's daily log, `SOUL.md`, `USER.md`.
- **Rung 1: The cited artifact and its neighbours.** If the prompt names or implies a file (a hook, a script, a skill, an `AGENTS.md` section), read it and the things it references before asserting anything about it. `bash scripts/agency-gather.sh` with no slug prints a system manifest: the file(s) the prompt cites, the matching `.claude/skills/*/SKILL.md`, the matching `.claude/hooks/*`, and the relevant `AGENTS.md`/`CLAUDE.local.md` sections. Then targeted reads.
- **Rung 2: Recent session logs and learnings.** Recent `context/memory/*.md` and `context/learnings.md` for prior decisions on the same subsystem. `bash scripts/memsearch-search.sh "<question>" 10 --scope root`.
- **Rung 3: The design source of truth.** `docs/meta/` (design philosophy, system architecture, memory architecture, evolution log) when the question is about why AI-OS is shaped the way it is, so you extend the design instead of reinventing it.
- **Rung 4: The open web.** Current tool capability, APIs, platform limits, how others solve it. Same tools as client Rung 4.
- **Rung 5: Ask the user (last).** Same bar: only genuine user-owned forks reach here.

## The budget rule (applies to both modes)

`agency-gather.sh` never auto-inlines more than roughly 40,000 characters of file bodies. Above that it returns the manifest plus the always-cheap hot files (the brief, `MEMORY.md`, the overview) and leaves the rest to targeted reads. The point of gather is that you cannot pretend the context is not there, not that you read all of it. Reliability of execution is not reliability of outcome: code that reliably dumps 240k tokens is reliably harmful.

## Feeding the critic

The grounded facts this ladder surfaces (voice, relationship history, the verified list, the cited system file) are exactly what the self-critique subagent needs. Hand the critic those facts, not the transcript that made the draft. See `context/agency/assumption-and-critique.md`.
