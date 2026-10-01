---
name: meta-synthesize-locals
description: >
  Synthesizes verbose SKILL.local.md files after migration from the old
  single-file pattern. For each skill that has a SKILL.local.md that looks
  like a full copy of SKILL.md, reads both files and rewrites SKILL.local.md
  to contain only the user's actual customizations (rules, overrides, additions).
  Triggered by: "synthesize skills", "sync local overrides", "clean up local
  files", "/synthesize-skills".
---

# Synthesize Local Skill Overrides

Cleans up `SKILL.local.md` files created during migration. Keeps only what
the user actually customized — removes content identical to the base.

## Steps

1. Scan `.claude/skills/` for all `SKILL.local.md` files
2. For each one, read the base `SKILL.md` alongside it
3. Determine if the local file is a verbose migration artifact:
   - Has YAML frontmatter → full copy, needs synthesis
   - Has section headings that are identical to the base → full copy
   - Already lean (only `## Rules` or small additions) → skip, already clean
4. For verbose files: synthesize
   - Extract what is unique to the local file vs the base
   - Keep: dated `## Rules` entries, modified sections, added content
   - Discard: content identical to the base
   - Rewrite `SKILL.local.md` with only the delta
5. Report what was synthesized and what was skipped

## Output format for SKILL.local.md

Keep it minimal — only what differs from the base:

```markdown
## Rules

- YYYY-MM-DD: user rule here

## Section Name (only if user modified it)

User's version of the section.
```

If the user made no customizations at all, write a minimal stub:

```markdown
## Rules

<!-- No local rules yet. Add dated entries here. -->
```

## Rules

*Updated when users flag issues with the synthesis process.*
