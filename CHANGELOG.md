# Changelog

All notable changes to AI-OS will be documented in this file. Written for humans, not machines.

## Unreleased

### Added

- Shared thinking, task recovery, evidence and code rules, with scoped checkpoints and live result checks.
- Solo correction promotion, client current-state briefs and read-only setup checks through one local maintenance command. The new correction job starts paused.
- `meta-find-skills` selects one to three methods from the shared and authorized client inventory. The pack now contains 94 skills.

### Preserved

- Team snapshot authority, user-owned context and overrides, optional setup and paused example jobs. Local maintenance stops when Team mode is detected.

## v1.1.5 - 2026-09-29

### Security

- **Command Centre dependency security update**: Next.js moves to 16.3.6, which fixes a critical remote code execution issue on Windows-hosted servers and several image-optimizer and server-action advisories. Sharp moves to 0.35.4 (patched libvips and libheif), PostCSS to 8.5.28, and brace-expansion, tar, nanoid, js-yaml and browserslist get patch updates. `npm audit` goes from 12 findings (1 critical, 9 high) to 1 (pdfjs-dist, which needs a major upgrade and is tracked separately). Sharp 0.35 no longer runs an install script, so it installs cleanly even when npm blocks install scripts.

### Fixed

- **Scheduled jobs and terminal sessions are no longer killed by the Command Centre**: while the Command Centre was open, its cleanup loop stopped any running Claude it had not started itself, so memory jobs died about 10 seconds in (memory stopped updating) and Claude Code sessions opened from a terminal were cut off with "Session was interrupted". It now stops only the processes the Command Centre spawned, leaves scheduled jobs and terminal sessions alone, ignores the short summary Claude that memory capture runs inside a session, and no longer closes a scheduled job early while it is still starting or waiting in the queue.
- **`/start-here` stops re-running on personal roots**: if you use the root folder for personal work and keep your businesses in `clients/`, onboarding no longer fires on every root session once a client has its brand context set up. You can also skip onboarding once and it stays skipped.
- **Scheduled jobs no longer look healthy when nothing is running them**: a job used to show "Active" as long as it wasn't paused, even when no cron runtime was alive to run it. Each job row now shows "Not running" (with "Waiting for runtime" as its next run) when the cron runtime stopped without handing off scheduling. `status-crons` now ends with a warning instead of a green check when active jobs have no runtime.
- **Updates keep your config files out of the stash**: the updater used to park your credentials and MCP config in a git stash while it pulled, so an update that died mid-way (closed window, dropped SSH session) could leave them missing, hidden in the stash. Untracked `.env`, `.mcp.json`, `.claude/settings.local.json` and `.claude/skills/_catalog/installed.json` (at the root and in every `clients/*` folder), plus gitignored files such as `.planning/`, now stay on disk for the whole update instead of going into the stash. Updates run through `npx local installer` get this protection on the first run. If you update with `bash scripts/update.sh`, this update still runs your current updater, so the protection applies from the next update.
- **Update stashes are restored even when another stash lands on top**: the updater now finds its own stash by commit instead of assuming it is still the newest, and any leftover update stash comes with the exact `git stash apply` command to get it back.
- **Missing scripts get a clear fix instead of a silent crash**: `install.sh` / `install.ps1` stop with the name of the missing file and the commands to restore it, and the updater warns when a shipped script is missing from your folder (for example after a manual merge removed it).
- **Clarifying questions no longer disappear in the Command Centre**: Claude could ask through Claude Code's built-in question tool, which nothing answers in a Command Centre session, so the question was folded into the Thinking group and the task sat waiting on an answer you never saw. Command Centre sessions and scheduled jobs now run without that tool, so Claude asks through the question modal. If a call still slips through, its questions open in the modal, and a "user did not answer" result keeps the task in Your Turn.
- **Command Centre shows the right version**: `command-centre/package.json` and its lockfile now match `VERSION` (they were stuck on 1.1.3 and 1.1.1), so `npm run dev` no longer prints an older version on an up-to-date install. CI now fails if they drift apart again.

### Changed

- **Instruction files cleaned up for the latest Claude models**: broken references, rules that had drifted apart in duplicated places, and outdated notes were fixed across the skills, commands and scheduled-job prompts, so Claude no longer follows instructions that lead nowhere. Scheduled jobs also skip the interactive session startup.

## v1.1.4 - 2026-09-15

### Added

- **"Answer vs Action" default** — Claude now reports its assessment and stops when you are asking a question, describing a problem, or thinking out loud, instead of jumping straight to editing files or drafting things you did not ask for. Explicit tasks and scheduled jobs are unaffected. Based on Anthropic's current prompting guidance for the latest Claude models.
- **One place for writing style** — a single concision-and-voice instruction in `AGENTS.md` keeps chat replies focused and free of mannered prose, scoped so it never shortens the documents a skill is actually asked to produce.
- **Scheduled jobs run autonomously** — cron jobs now state up front that they operate without you watching, so they proceed on reversible work instead of stalling to ask for input no one is there to give.

### Changed

- **Instruction files follow the latest prompting guidance** — hard rules and CAPS across `CLAUDE.md`, `AGENTS.md`, `start-here` and several skills now carry the reason behind each rule instead of relying on emphasis; reason-free shouting was removed (the constraints themselves stay), and three cross-file contradictions (GitHub-backup cadence, the post-deliverable question, and local-override loading) were reconciled to a single source of truth.
- **Area-specific guidance moved to reference docs** — client-scoping and skill-authoring guidance now lives in `docs/multi-client-guide.md` and `docs/building-skills.md` (referenced from `AGENTS.md`) instead of path-scoped `.claude/rules/` files. Same on-demand loading and token savings, but it works on any CLI version and for AGENTS.md-based tools (e.g. Codex), not only recent Claude Code.

## v1.1.3 - 2026-08-31

### Improved

- **Leaner instruction files** — `CLAUDE.md` and `AGENTS.md`, the files Claude loads every session, are about 58% smaller (from ~22.9k to ~9.6k characters). Area-specific guidance now lives in path-scoped rules (`.claude/rules/`) and reference docs that load only when they're relevant, so sessions start with less overhead and Claude follows the rules that matter more reliably.

### Fixed

- **Correct skill category** — the finance skills (invoice reconciliation, month-end reporting) are now listed under the `fin` category they actually use, instead of the stale `acc`.
- **Correct GSD command references** — the docs now use the `/gsd:` command form the current GSD install provides, replacing the old `/gsd-` form that no longer resolves.

## v1.1.2 - 2026-08-04

### Changed

- **Shared skills are inherited, not copied** — client workspaces no longer carry a copy of every root skill. A session inside a client resolves skills from the root, so clients are ~70% smaller, creation drops from ~16s to ~2s, and updating a root skill reaches every client instantly with no destructive sync. Existing installs migrate automatically on the next update: stale copies are pruned only when their content is verifiably recoverable from the repository, and everything the user wrote (client-only skills, `SKILL.local.md` overrides, hand-edited copies) is preserved.
- **Skill commands understand clients** — `list-skills.sh` inside a client shows what that client actually sees, separating inherited, client-only, customized and hidden skills; `add-skill.sh` and `remove-skill.sh` refuse inside a client and point to the root.

### Added

- **Per-client skill control** — hide any root skill from one client via `skillOverrides` in that client's `settings.local.json` (documented, survives every update). New clients are born with the exclusions every configured client shares, and the Command Centre now shows each skill's per-client state (client-only, customized, off) with the client's `SKILL.local.md` visible and editable in the file tree.
- **Explicit client slugs** — client-scoped operations accept an explicit slug instead of relying on detection.
- **Cursor-aware slash commands** — the Command Centre composer handles slash commands at the cursor position.

### Fixed

- **`SKILL.local.md` finally survives updates** — the documented promise the old sync flow silently broke now holds, guarded by a regression test.
- **Deterministic file-tree skeletons** — loading placeholders no longer cause hydration mismatches.
- **Memory metadata works on stock macOS bash** — bash 3.2 compatibility for the memory meta helpers.
- **Cross-platform hardening** — client tooling now behaves on macOS/BSD userland (no GNU-only tools, execution-validated Python discovery) and on Windows CRLF checkouts (generated `.gitignore` merges instead of duplicating, seeded files stay LF, BOM-tolerant settings readers).

## v1.1.1 - 2026-07-24

### Changed

- **Cleaner distributions** — release packages now exclude personal workspace content and verify the intended starter files before publishing.

### Fixed

- **Restored chats keep their history** — logged-out Command Centre chats now preserve restored sessions and handle their lifecycle reliably.
- **Reliable cron startup after upgrades** — the cron daemon waits for legacy databases to become ready, claims ownership safely, and confirms that the expected process is running before reporting success.
- **Safe local memory rebuilds** — rebuilding a local memory index preserves the private owner before recovery, rejects unknown future migration layouts, keeps automatic watching local-only, and applies private search to the stable local user.

## v1.1.0 - 2026-07-17

### Added

- **Real Claude Auto mode** - Command Centre can now use Claude's native Auto permission mode, check local CLI/model compatibility, and change permission modes in a live task without restarting it.

### Changed

- **Clearer permission names** - the unrestricted bypass mode is now called Full access, with a compact four-option permission picker for Ask, Auto, Full access, and Plan.

## v0.5.1 - 2026-07-15

### Changed

- **Lighter, cheaper sessions** — the always-loaded instructions file was trimmed roughly in half, with the reference detail moved into the docs where it already lived. Every session now starts with less baggage and burns fewer tokens. Subagents also run on a lighter model by default, and the OS no longer pays for Claude Code's built-in background memory, since it keeps its own.
- **Junk stays out of context** — new ignore and read-deny rules keep bulky generated folders (node_modules, dist, build) and lockfiles from ever being pulled into a session, at any depth.

### Fixed

- **No more phantom PRD.md** — removed a stale reference that sent sessions looking for a specification file that isn't shipped.
- **Clean install passes CI** — trimmed the `mkt-visual-identity` skill description under the frontmatter size limit, so the validation check stays green on a fresh install.
- **Repaired internal doc pointers** — references that pointed at sections moved or removed during the trim (service registry, external-service detection, branching defaults) now point to the right place.

## v0.5.0 - 2026-07-03

### Added

- **Visual identity in onboarding** — `/start-here` now sets up your brand's visual identity right after building your voice, positioning, and ICP. It captures your design tokens (typography, colors, layout) and produces a brand-bible PDF that every visual skill — image generation, slides, diagrams — draws from, so visuals stay on-brand from day one. The `mkt-visual-identity` skill ships by default and needs no API key.
- **Automatic onboarding on first run** — if your brand isn't set up yet (no brand context on file), the onboarding now starts on its own the moment a session opens — you no longer have to know to type `/start-here`. Once your brand is set up, it stays quiet and never nags.

### Changed

- **New image generator** — the image generation skill is now `viz-image-gen`, replacing `viz-nano-banana`. It guides you through visual direction with a 6-element framework and style presets, and can generate with either GPT Image or Gemini (use whichever key you have; set both and it picks the best model per image). Requires `OPENAI_API_KEY` and/or `GEMINI_API_KEY`.

### Fixed

- **Weekly cron jobs fire on the right days** — schedules with a day filter (e.g. every Monday) no longer fire daily; both the in-app scheduler and the daemon now check the day of week as well as the time. Restart the cron daemon after updating to pick up the fix.
- **Clearer final install step** — the installer now tells you to move into the OS folder (with the exact path) before running `/start-here`, so the command is always available.

## v0.4.0 - 2026-06-30

### Added

- **Memory expand** — `npm run memory:expand` returns the scope-safe surrounding source context around a search-result chunk.
- **Memory transcript drill-down** — `npm run memory:transcript` returns the raw conversation turn window behind a chunk, scope-checked the same way as search and expand.
- **Recall ladder dispatch** — `npm run memory:recall` now drives all three rungs (`--expand <chunk-id>` / `--transcript <chunk-id>`, default `search`), and the `meta-memory-recall` skill teaches when to escalate a rung and when to stop.

### Changed

- **Memory indexing defaults** — normal memory setup/reindex now indexes `context/memory/` and `context/learnings.md` only. Brand context remains available through skill-directed file loading and can still be indexed only when passed explicitly with `--root`.
- **Keyword search on Postgres FTS** — the keyword leg of hybrid search now uses Postgres full-text search (`tsvector` + `ts_rank_cd`), fused with vector search via RRF.

## v0.3.1 - 2026-06-17

### Changed

- **Semantic memory upgrade** — updates now set up BGE-M3 semantic memory, download the model when needed, rebuild old 384-dim memory stores, and reindex existing memory so recall uses the same model for indexing and search.
- **More reliable recall** — memory search now combines semantic vector search with keyword search, and it fails clearly if the stored embeddings do not match the active model.
- **Recoverable memory sources** — `.aos.md` summarized memory captures are now included in private GitHub backups, so memory can be rebuilt later with a new model or pipeline. Raw transcripts and built memory databases still stay local.

## v0.3.0 - 2026-06-16

### Added

- **Recommended Memory Setup** — install and update now offer searchable memory through `scripts/setup-memory.sh` and `scripts/setup-memory.ps1`, with Claude Code as the default and Codex/both/skip choices.
- **Version visibility** — install and update now show the current AI-OS version, and update confirms the version received.

### Changed

- **Primary recall on PGLite/pgvector** — semantic recall now runs on the new scope-isolated PGLite store via `npm run memory:recall` (Tier 1 in `AGENTS.md` points here). The legacy `memsearch` path is kept only as a temporary, explicit rollback (`MEMORY_BACKEND=memsearch` or `--backend memsearch`); it triggers automatically only when the new backend is unavailable, and never on an empty result or a scope error, so it cannot mask an isolation failure. Slated for removal once the new backend is stable.
- `setup-memsearch.sh` and `setup-memsearch.ps1` now route to the recommended setup flow for backward compatibility.

## v0.2.2 — 2026-06-02

### Added

- **Semantic Memory (Tier 1 recall)** — `memsearch` integration for semantic search across session logs, transcripts, learnings, and brand context. Run `bash scripts/setup-memsearch.sh` once after updating to activate (see README for details).
- **Auto-capture** — every session is automatically summarised and indexed to `.memsearch/memory/` at session end via the Stop hook.
- **Nightly memory indexer** — cron job runs at 02:00 to keep the semantic index up-to-date with new sessions and content.
- **Weekly memory gap analysis** — cron job runs Sunday at 09:30, before the weekly curator, to identify date gaps, stale threads, and orphaned decisions. Saves report to `context/memory/{date}_gap-analysis.md`.
- **Gap citation protocol** — memory recall responses now cite sources with dates, note temporal gaps, and state exactly what was searched when nothing is found.
- **Post-fusion reranker** — `scripts/lib/reranker.py` re-ranks memsearch results by source authority and recency before summarising. Configuration lives in `context/memory-config.json`.
- **Memory coverage stats** — `scripts/lib/memory-meta.sh` reports session log date range, gaps, and MEMORY.md usage. Runs automatically at session wrap-up.

### Changed

- Memory retrieval in `AGENTS.md` now uses a structured 3-tier protocol (MEMORY.md → semantic search → citation) instead of a bare fallback.

## v0.1.0 — 2026-04-13

First versioned release. Everything before this was unversioned iteration.

### Added

- Project template with personality (`SOUL.md`), user preferences (`USER.md`), and session memory
- Skill system with auto-registration, reconciliation, and category prefixes
- Brand context layer — voice profile, positioning, ICP, samples, and assets
- Multi-client architecture — run multiple clients from one install
- Command Centre — task board, Kanban view, GSD project management, and dashboard
- GSD framework integration — structured project execution with phases, plans, and verification
- Update system with safe self-updating (`update.sh`) and protected user data
- Cron dispatcher for scheduled jobs
- Skills: brand voice, positioning, ICP, skill creator, wrap-up, goal breakdown, AI SEO, Stitch design, interface design, Stitch fetch tool
- Changelog and version tracking with `/new-feature` and `/release` workflow
