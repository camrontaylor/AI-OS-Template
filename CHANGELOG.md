# Changelog

All notable changes to AI-OS will be documented in this file. Written for humans, not machines.

## Unreleased

No unreleased changes documented yet.

## v0.2.3 - 2026-06-24

### Added

- **Recommended Memory Setup** - install and update now offer searchable memory through `scripts/setup-memory.sh` and `scripts/setup-memory.ps1`, with Claude Code as the default.
- **Version visibility** — install and update now show the current AI-OS version, and update confirms the version received.

### Changed

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
