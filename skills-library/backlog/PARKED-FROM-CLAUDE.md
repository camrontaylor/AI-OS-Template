# Parked / disabled from the Claude Code menu - updated 2026-06-23

Records what was removed from the Claude Code `/` menu, where it went, and how
to restore it. Nothing was deleted. AI-OS is the source of truth for this.

(This file was lost once to shared-checkout churn from parallel sessions and
recreated. If it goes missing again, regenerate from this content.)

## Kept ON (you use these - confirmed by usage data)

- AI-OS's 26 native skills (in the repo, `.claude/skills/`).
- `impeccable` (used 43x) and `agent-browser` (8x) - restored to the menu.
- Plugins: `vercel`, `memsearch`, `telegram`, `figma@inline` - all real tools
  you use. `figma@inline` is pinned `true` so the inline default cannot drop it.
- 5 dev skills restored to the menu on request: `brainstorming`,
  `subagent-driven-development`, `find-skills`, `agent-browser`, `mcp-builder`.

## 1. GSD command set (68) - in the repo backlog

- 67 `gsd-*` folders in `skills-library/backlog/gsd/`; the `gsd` link in
  `~/.claude/skills-parked/`.
- Restore: move the folders back to `~/.claude/skills/`, or reinstall GSD.

## 2. Dev / tooling skills - parked locally

In `~/.claude/skills-parked/` (real copies remain in `~/.agents/skills`):
changelog-generator, composio-cli, connect-apps, dispatching-parallel-agents,
executing-plans, finishing-a-development-branch, github-mcp-server, mcp-cli,
receiving-code-review, remotion-best-practices, requesting-code-review,
systematic-debugging, test-driven-development, using-git-worktrees,
using-superpowers, verification-before-completion, writing-plans, writing-skills.

- Restore one: move it from `~/.claude/skills-parked/` back to `~/.claude/skills/`.

## 3. Inline plugin packs switched OFF (in ~/.claude/settings.json enabledPlugins)

All had ~zero real usage and/or duplicate AI-OS skills:
anthropic-skills, brand-voice, data, design, intercom, operations, pdf-viewer,
productivity, sales, webflow (both inline + marketplace), paper (both), and
**marketing** (its own skills duplicate `mkt-copywriting`,
`mkt-content-repurposing`, `mkt-brand-voice`, `mkt-positioning`).

- Restore: flip the value back to `true` in that file.

## 4. Skill tier system (new)

- `scripts/skill-tiers.py` ranks every used skill A/B/C by real usage and flags
  graduation candidates. Doc: `docs/skill-tiers.md`. Run: `python3 scripts/skill-tiers.py`.

## Graduation candidates found (used a lot, real AI-OS gap)

Build these into AI-OS as proper skills when ready (each needs reference
methodology, per AGENTS.md - do not guess):
`seo-audit` (8x), `site-architecture` (12x), `programmatic-seo` (11x),
`cro` (5x), `content-strategy` (7x). `copywriting` (15x) is already covered by
`mkt-copywriting`.

## Still later (you flagged hooks + cross-tool for later)

- GSD hooks still wired in `~/.claude/settings.json`.
- `~/.agents/skills` (70 packs) still feeds Cursor. Your used
  marketing/SEO skills live there. Re-pointing that to AI-OS is the cross-tool pass.
