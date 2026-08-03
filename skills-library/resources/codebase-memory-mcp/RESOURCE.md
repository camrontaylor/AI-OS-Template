# Resource: codebase-memory-mcp

## Snapshot
- Source: `DeusData/codebase-memory-mcp` (https://github.com/DeusData/codebase-memory-mcp)
- License: MIT
- Commit evaluated: HEAD as of 2026-07-23 (not pinned - re-clone for a fresh SHA if revisited)
- Size: 1,944 files, 1,941 text-bearing (mostly vendored tree-sitter C grammars), 2 opaque binaries
- Vendored: **NOT vendored.** Metadata-only record. A repo this size would meaningfully bloat the
  AI-OS tree if copied - the whole point of `resources/` is to never do that.
- Evaluated: 2026-07-23
- Evaluated by: `meta-skill-intake` (assess) -> `meta-bake-it-in` (absorb)

## What it is
A pure-C MCP server: full-indexes a codebase into a persistent knowledge graph (tree-sitter across
158 languages + Hybrid LSP for ~12), exposing 15 MCP tools (structural search, call-chain trace,
architecture overview, impact analysis, dead-code detection, Cypher queries, ADR management).
Genuinely impressive engineering. Ships as a downloaded prebuilt binary, not a source build.

## Security scan
- Tool: `scripts/lib/absorb-scan.py`
- Grade: **HIGH on the raw scan** - but every driver was verified benign at the source (a human
  must always confirm a HIGH before trusting it; the scanner fails closed).
  - 7 "leaked secrets" = 6 test fixtures in `tests/test_pipeline.c` + the project's own
    `scripts/security-strings.sh` (patterns-as-data, same shape as AI-OS's `secret-scan.py`)
  - 1 "invisible unicode" = a single stray U+200B in `internal/cbm/lsp/php_lsp.c`, not a tag-block
    instruction channel
  - "obfuscation + supply-chain together" = generated tree-sitter `parser.c` lookup tables (819
    `.c` files) matching the base64-blob heuristic, plus the documented installer + an npm
    `postinstall` + a security test that asserts a malicious shell arg is REJECTED
- True remaining risk is REVIEW-level, not HIGH: 2 unauditable binaries
  (`vendored/mimalloc/.../etw.man`, `vendored/nomic/code_vectors.bin`), and an `install.sh` that by
  default writes into `~/.claude.json`, a global skill, three global subagents, and
  `~/.claude/settings.json` hooks across 43 detected agent surfaces.

## Disposition
**PARKED.** Not a bake-in candidate; not run.

## Why parked
The default installer directly conflicts with AI-OS rules: writing into `~/.claude/skills/` is the
exact personal-scope skill install AGENTS.md's Skill Home Rule forbids, and is the precise setup
behind the 2026-07-08 "personal/project name collision aborts skill discovery and all local skills
vanish" incident. It also mutates `~/.claude/settings.json` hooks, which AI-OS denies writing to and
manages itself. Value is real but narrow for a repo AI-OS's own size (a medium `command-centre/` app
+ hooks + scripts) - plain grep/glob/read covers most navigation; the graph's payoff
(`detect_changes` blast-radius, `trace_path` call chains) is occasional, not everyday.

## If revisited
Only ever via `install.sh --skip-config` (binary only, no config writes) plus a project-scoped
`.mcp.json` entry `{"command": "<path>", "args": []}` in the AI-OS repo - never the default
`install` subcommand. Would be worth it only for a heavy `command-centre/` refactor.

## Full record
[`projects/meta-bake-it-in/2026-07-23_ai-job-search-codebase-memory-agent-reach.md`](../../../projects/meta-bake-it-in/2026-07-23_ai-job-search-codebase-memory-agent-reach.md)
