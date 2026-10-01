# neutral-identity (default fallback)

The visual identity the skill copies into `{brand_context}/visual-identity/` when the user has nothing to start from.

## Contents

```
neutral-identity/
├── tokens.json                     # Geist + near-black + coral accent, 1080×1350
├── identity.md                     # one-paragraph narrative (uses {{ brand_name }})
├── moves.md                        # 3 universal moves (margins, page indicator, accent bar)
└── logos/
    └── placeholder-hexagons.svg    # generic mark, replace when the brand has its own
```

## How it's used

Mode E enhancement (when the user has nothing):

```
if {brand_context}/visual-identity/tokens.json missing
   AND user has no reference materials:
       prompt "I have no references from you yet. Want me to copy a neutral
               default identity to get started? You can refine it any time
               by dropping references in {brand_context}/_inbox/."
       on yes:
           copy this folder → {brand_context}/visual-identity/
           replace {{ brand_name }} in identity.md with user-provided handle or empty string
           tokens.json `is_default: true` flag stays set so downstream skills
               can warn the user that the brand is on default
```

## When to refine

The default works for first-draft posts, but anything published should have at least:
- A real logo (replace `logos/placeholder-hexagons.svg`)
- A brand-specific accent color (override `tokens.json → colors.accent`)
- A real display font if the brand has one (override `tokens.json → fonts.display`)

Once the user provides any reference, Mode E reruns with `is_default: true` as the merge base — the extracted tokens overwrite the defaults but `locked_fields` (if the user typed any values) are preserved.
