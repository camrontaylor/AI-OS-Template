# Resource: ai-job-search

## Snapshot
- Source: `MadsLorentzen/ai-job-search` (https://github.com/MadsLorentzen/ai-job-search)
- License: MIT
- Commit evaluated: HEAD as of 2026-07-23 (not pinned - re-clone for a fresh SHA if revisited)
- Size: 180 files, 146 text-bearing
- Vendored: **NOT vendored.** Metadata-only record - reclone from the source URL if the content
  itself is ever needed again. See `skills-library/README.md` (or `INDEX.md`) for why resources/
  never carries full source.
- Evaluated: 2026-07-23
- Evaluated by: `meta-skill-intake` (assess) -> `meta-bake-it-in` (absorb)

## What it is
A Claude Code job-application framework: `/scrape`, `/apply`, `/interview`, CV/cover-letter
tailoring, salary lookup. Well-engineered (drafter-reviewer pipeline, portal-CLI plugin
architecture, its own CI + pytest suite). The capability itself is irrelevant to an agency
operator who is not job hunting.

## Security scan
- Tool: `scripts/lib/absorb-scan.py`
- Grade: **REVIEW** (not HIGH; no injection, no real secrets, no invisible unicode)
- Coverage: 146 text files scanned, 0 binaries/archives
- Findings: 1 supply-chain flag (`curl -fsSL https://bun.sh/install | bash` in `SETUP.md`, their
  documented bun installer - not something AI-OS runs) + 14 agent-config-write references (`.claude/`
  paths - expected, it's a Claude Code framework)
- Verdict: benign. Do not run its installer or `/setup` flow.

## Disposition
**PARTIALLY-ABSORBED.** The capability stays parked; two patterns were kept.

## What was kept
- `tools/security_guards.py` allowlist-as-tripwire pattern -> built as
  [`.claude/skills/meta-systems-check/scripts/check.sh`](../../../.claude/skills/meta-systems-check/scripts/check.sh)
  check 13b (permission-widening + gitignore-integrity drift), 2026-07-23.
- `job-scraper` SKILL.md Step 4.75 "silent-rot" principle (0 rows / garbled output at exit 0 is the
  real scraper failure mode) -> folded into
  [`AGENTS.md`](../../../AGENTS.md) "Web Data & Scraping Routing", tagged
  `(absorbed from MadsLorentzen/ai-job-search + Panniantong/Agent-Reach, 2026-07-23)`.

## Why parked
Job scraping, CV tailoring, interview prep, salary lookup all solve a problem the operator does
not have. Everything else genuinely novel (drafter-reviewer critique, untrusted-input handling,
verify-the-rendered-artifact) AI-OS's own Agency/Evidence Discipline already covers as well or
better.

## If revisited
No installer risk beyond the documented bun `curl|bash` line - safe to re-read directly from
GitHub if the framework itself is ever wanted for an unrelated job search.

## Full record
[`projects/meta-bake-it-in/2026-07-23_ai-job-search-codebase-memory-agent-reach.md`](../../../projects/meta-bake-it-in/2026-07-23_ai-job-search-codebase-memory-agent-reach.md)
