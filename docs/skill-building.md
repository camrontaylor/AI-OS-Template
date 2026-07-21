# Skill Building Reference

Companion to the "Building New Skills" section in `AGENTS.md`. The rule that stays there: always ask for reference skills first, never guess at methodology, and run the registration checklist before a skill goes live. Everything structural lives here and loads on demand.

## Skill structure

```text
.claude/skills/{category}-{skill-name}/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

## Auto-Setup Convention

Skills that need external binaries must include a `scripts/setup.sh` that:

- checks `command -v` first
- uses `brew` on macOS when available, with other fallbacks when needed
- reports clear success or failure
- runs only when dependencies are missing
- avoids user interaction unless absolutely necessary

## YAML frontmatter rules

- About 100 words, under 1024 characters
- Include trigger phrases and negative triggers
- Do not use XML angle brackets

### Description format (canonical)

The `description` is both the routing signal and the text the `/` skill picker shows in its popup. A long description overflows the popup and buries the trigger words, so keep it tight. Three parts, in this order:

1. **One plain sentence** - what the skill does and when to reach for it.
2. **`Triggers: "phrase", "phrase", ...`** - the real user phrases that should fire it. This is the part that fights under-triggering, so keep it comprehensive.
3. **One `Not for ...` line** - the sibling skills that own adjacent jobs, so routing does not cross wires.

Aim under 500 characters for the description (the whole frontmatter still has to fit under 1024). Cut restated mechanics, parentheticals, and prose - that detail belongs in the `SKILL.md` body, not the description. `scripts/skill-system-audit.sh` emits a warning when a description runs past the target.

**Before** (901 chars, overflows the popup):

> Owns the skills-library end to end - two folders (backlog inert, .claude/skills live), three actions (assess, promote, park). Use when the user brings in an outside skill, pack, or repo... [six more lines of restated mechanics]

**After** (~340 chars, scannable, same trigger coverage):

> Bring an outside skill, pack, or repo into AI-OS: assess it, then promote it live or park it. Triggers: "vendor this to backlog", "assess this candidate", "should I promote X", "park that skill", or pasting a skill repo. Not for finding an existing skill (meta-find-skills) or building one from scratch (meta-skill-creator).

## Skill Dependencies

Declare dependencies in a `## Dependencies` section in `SKILL.md`.

| Skill | Required? | What it provides | Without it |
|-------|-----------|------------------|------------|
| `tool-youtube` | Optional | YouTube transcript fetching | Ask the user to paste content manually |

Rules:

- Required dependencies must be installed for the skill to function
- Optional dependencies must declare their fallback
- If a required dependency is missing, tell the user which skill to install
- Utility (`tool-`) skills never depend on execution skills

## Folder naming

- Format: `{category}-{skill-name}` in kebab-case
- Cannot contain "claude" or "anthropic"

## Skill Publishing And Discovery (canonical detail; AGENTS.md points here)

AI-OS skills live in exactly one place, `.claude/skills/`, the single source of truth. Other tools reach them by symlink, never by copy.

- **Claude Code (inside the repo):** no publishing needed; it loads `.claude/skills/` as project skills. `.agents/skills/` is a symlink to the same set; `scripts/lib/skills-parity-check.sh` (SessionStart) verifies parity.
- **Do NOT publish AI-OS skills into `~/.claude/skills/` (personal scope).** Hard lesson, 2026-07-08: Claude Code does not cleanly dedupe a skill name that exists in both personal and project scope. When cwd is the AI-OS repo, the name collision aborts filesystem skill discovery and ALL local skills vanish from the picker (only plugin/MCP and bundled skills survive). Personal-scope publishing is only safe for a tool that never also loads `AI-OS/.claude/skills` as project skills.
- **Codex and compatible project agents:** `.agents/skills/` is the project adapter and resolves directly to `.claude/skills/`. `scripts/link-skills.sh` maintains and audits this one adapter; it does not publish AI-OS skills into home directories. Cursor has no separate skill runtime, so its `AGENTS.md` rule pointer is the whole story there.
- **Why symlinks, never copies:** an edit or a `context/learnings.md` write from any tool lands in the real AI-OS files, because the symlink target is the real path. Copies drift; symlinks cannot.
- **Verification rule (non-negotiable):** any change to skill loading MUST be verified in an actual fresh session of that tool. A resolving symlink and a passing audit prove topology, not runtime discovery.
- **Onboarding a new tool:** prefer a project-level adapter to `.claude/skills/`. Add a tool-home publication surface only when the tool cannot discover project skills; keep it symlink-only, guard against name collisions, and verify in a live session before trusting it.
