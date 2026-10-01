# Building New Skills

Ask for reference skills before writing one, and never guess at methodology, so the new skill matches an established pattern instead of an invented one.

---

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

## Skill Dependencies

Declare dependencies in a `## Dependencies` section in `SKILL.md`.

| Skill | Required? | What it provides | Without it |
|-------|-----------|------------------|------------|
| `tool-youtube` | Optional | YouTube transcript fetching | Ask the user to paste content manually |

**Rules:**
- Required dependencies must be installed for the skill to function
- Optional dependencies must declare their fallback
- If a required dependency is missing, tell the user which skill to install
- Utility (`tool-`) skills never depend on execution skills

## Registration checklist

- [ ] Folder name matches `{category}-{skill-name}`
- [ ] Frontmatter `name` matches the folder name exactly
- [ ] Add the skill to `docs/skill-registry.md` and to the Skill Registry in `AGENTS.md`
- [ ] Add a row to `docs/context-matrix.md` and to the Context Matrix in `AGENTS.md`
- [ ] Run `python3 scripts/sync-agent-skills.py` from the root so Codex discovers the same canonical skill as Claude Code. Keep AGENTS.md's installed-name list concise; detailed trigger/context rows belong in the linked registry and matrix.
- [ ] Frontmatter stays under 1024 chars
- [ ] `SKILL.md` stays under 200 lines
- [ ] References are self-contained
- [ ] Dependencies are declared when needed
- [ ] Output folders use the same category prefix
- [ ] External services are registered in `AGENTS.md`, `.env.example`, and README.md
- [ ] Publishable text skills include the humanizer gate

## Folder naming

- Format: `{category}-{skill-name}` in kebab-case
- Cannot contain "claude" or "anthropic"

Category prefixes: `mkt` (marketing) · `str` (strategy) · `ops` (operations) ·
`viz` (visual) · `fin` (finance) · `meta` (system) · `tool` (utility). The YAML
`name` field matches the folder name exactly, and output folders reuse the same
prefix (`projects/{category}-{output-type}/`). Add a new category only when the
first skill in a new domain is built.

## Three-layer architecture

| Layer | Files | Purpose |
|-------|-------|---------|
| Agent Identity | `AGENTS.md`, `CLAUDE.md`, `context/SOUL.md`, `context/USER.md` | Operating rules + Claude runtime |
| Skills Pack | `.claude/skills/{category}-{skill-name}/` | Capabilities that grow over time |
| Brand Context | `brand_context/` | Client brand data |

## Skill & MCP Reconciliation

Compare what is on disk against what is registered. Fix additions silently; confirm removals with the user.

This section covers **shared root skills only**, meaning skills under the AI-OS root `.claude/skills/`. A skill under `clients/{slug}/.claude/skills/` exists for that client alone and must not be added to the root registry, context matrix, learnings, or README. Document it inside the client instead. See "Client-only skills" below.

- **New skill on disk, not registered?** Read its frontmatter + `SKILL.md`, add it to the Skill Registry (`docs/skill-registry.md`) and Context Matrix (`docs/context-matrix.md`), add a section to `context/learnings.md`, scan for external-service dependencies, and update `README.md`. Tell the user what was registered.
- **Skill registered but its folder is missing?** Ask before removing it from the registry, `README.md`, and `context/learnings.md`.
- **New MCP in `.claude/settings.json`, not in the README?** Add it under a Connected Tools section and tell the user.
- **Documented MCP removed from `settings.json`?** Ask before removing it from the README.
- **New external service detected?** Add it to `.env.example` and the README, and tell the user the fallback.

## Skill Local Overrides

Every skill can have a `SKILL.local.md` beside its `SKILL.md`:

- `SKILL.md` — the base definition, shipped by upstream, never modified by the user.
- `SKILL.local.md` — user-owned additions: extra `## Rules` entries, section overrides, context notes. Never overwritten by updates.

When invoking any skill, check for `SKILL.local.md` and, if present, read it alongside `SKILL.md`; local rules take precedence. Format mirrors `SKILL.md` — at minimum a `## Rules` section with dated entries:

```
## Rules
- 2026-05-03: always do X when Y
```

## Client-only skills

Shared skills live only at the AI-OS root and are never copied into `clients/`. Both Codex and Claude Code discover the root pack from a client session. A client's `.claude/skills/` holds only client-owned material. Run the root's `scripts/sync-agent-skills.py` after changes to generate client-local Codex links too. Shared startup checks client `skillOverrides` before invocation; client context and outputs stay local.

To build a skill for one client, create it at `clients/{slug}/.claude/skills/{skill-name}/SKILL.md`. Everything above about frontmatter, folder naming, and quality still applies. What does not apply is registration: a client-only skill is not part of the shared catalog, so leave `docs/skill-registry.md`, `docs/context-matrix.md`, `context/learnings.md`, and `README.md` alone. Reconciliation of those files is about root skills.

Two things to watch:

- **Do not reuse a root skill's folder name.** A client skill with the same name shadows the root one inside that client and stops receiving root updates, freezing it at the version you wrote. To extend a root skill for one client, add `SKILL.local.md` beside the root skill's entry in the client folder instead.
- **To hide a root skill from one client**, do not delete or copy anything. Add it to `skillOverrides` in that client's `.claude/settings.local.json`, merging into the existing JSON:

```json
{ "skillOverrides": { "skill-name": "off" } }
```

That file is user-owned and no update ever overwrites it. The setting is per client, so the root and every other client keep the skill. A client created later starts with the exclusions shared by every client that has overrides (`add-client.sh` seeds them and reports it); clients with no overrides abstain, and an exclusion made in only some of them is not inherited. Use `remove-skill.sh` at the root only when the skill should be gone everywhere.
