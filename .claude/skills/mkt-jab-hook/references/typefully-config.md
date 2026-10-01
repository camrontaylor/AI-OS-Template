> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only the authoritative snapshot; local context/config/knowledge examples apply only to Solo mode. Generated files use the dated project directory and dated filenames. User task authorization controls external writes.

# Typefully config

**Personal config lives at `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/typefully.yaml`** — not in this repo (gitignored, on disk only).

## Setup (one-time)

```bash
# Create your personal config
mkdir -p context/config/mkt-jab-hook
cp skills/mkt-jab-hook/references/typefully-config.example.yaml \
   context/config/mkt-jab-hook/typefully.yaml

# Edit context/config/mkt-jab-hook/typefully.yaml with your real Typefully social set ID.
# Find it via: mcp__typefully__typefully_list_social_sets
```

## Schema

See `typefully-config.example.yaml` in this directory for the full schema + comments.

## How the skill loads it

1. Read `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/typefully.yaml`
2. If the file doesn't exist, fall back to interactive setup:
   - Call `mcp__typefully__typefully_list_social_sets`
   - Ask which one is the user's personal workspace
   - Save the answer to the config file for next time

## Other social sets in the same Typefully team

If you're in a team workspace, the config file's `other_social_sets` list documents which sets to AVOID by default when drafting. The skill will not push to those without explicit override.
