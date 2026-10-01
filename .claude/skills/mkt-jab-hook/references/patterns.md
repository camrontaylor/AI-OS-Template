> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only the authoritative snapshot; local context/config/knowledge examples apply only to Solo mode. Generated files use the dated project directory and dated filenames. User task authorization controls external writes.

# Patterns library

**Your extracted patterns live at `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/patterns.local.md`** — not in this repo (gitignored, on disk only). The patterns you've mined from inspiration accounts are your taste — keep them private.

## How the library works

Each entry has: source account, archetype, anatomy (hook + structure + close), when-to-use, sample lift to your voice.

The skill appends new patterns here as you scan more inspiration accounts. Over time it becomes a personal playbook of "things that work" for your audience.

## Schema (for reference — your real file will look like this)

```markdown
## N. <Pattern name>

**Source**: <Account name> (<Platform>, post on <topic>, <date>)

**Hook archetype**: <Description of the opening move>
> *"<verbatim example from the source post>"*

**Anatomy**:
1. <First structural beat>
2. <Second beat>
3. <Third beat>

**When to use**:
- <Property type or content type this fits>
- <Audience signal this works for>

**Lift to your voice**:
- <What to drop from the source>
- <What to keep>
- <Adaptations specific to your voice rules>
```

## When the skill writes to this file

After running `/mkt-jab-hook` with an inspiration scan, the extracted patterns are appended to `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/patterns.local.md`. The skill numbers them sequentially.

## Notes

- Patterns compound — the more you scan, the sharper your draft suggestions
- Periodic cleanup: every 30–50 patterns, deduplicate similar ones
- Reference your own voice rules (`voice.md` + `voice.local.md`) when deciding what to lift vs drop
