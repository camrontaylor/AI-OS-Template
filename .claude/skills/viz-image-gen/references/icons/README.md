# Icons library

Curated SVG icons for use in social content compositions (carousels, slides,
thumbnails, ad creatives). All assets are vector and recolorable.

## Folder layout

```
icons/
└── commons/
    ├── ai/             AI tools, models, generic AI icons
    ├── creator/        Content production (pen, video, voice, brainstorm…)
    ├── decoration/     Hand-drawn arrows and ornaments
    ├── dev/            Dev tools, IDEs, cloud platforms
    ├── editorial/      Editorial / publishing marks and ornaments
    ├── engagement/     Likes, comments, shares, notifications
    ├── media/          Broadcast / audio (radio, TV, Spotify)
    ├── productivity/   Apps, checklists, targets
    └── social/         Social network logos
```

Each category mixes **generic icons** (e.g. `social/instagram.svg`,
`creator/pen-01.svg`) with **brand logos**. They live together so a designer
browses one tree, not two.

## Standard source order for brand logos

When adding a new brand logo, try these sources **in this order** and stop at
the first hit:

| Order | Source                                                       | License | Best for                       |
| ----- | ------------------------------------------------------------ | ------- | ------------------------------ |
| 1     | [Simple Icons](https://simpleicons.org)                      | CC0     | Most brands (~3,300)           |
| 2     | [Lobehub Icons](https://lobehub.com/icons)                   | MIT     | AI tools (OpenAI, Midjourney…) |
| 3     | [Devicon](https://devicon.dev)                               | MIT     | Dev tools / IDEs (VS Code…)    |
| 4     | Official brand/press page                                    | varies  | Anything missing above         |

### URL patterns

```
Simple Icons (brand color):
  https://cdn.simpleicons.org/{slug}

Simple Icons (custom hex, no #):
  https://cdn.simpleicons.org/{slug}/000000

Lobehub (monochrome):
  https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/{slug}.svg

Lobehub (color, when available):
  https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/{slug}-color.svg

Devicon:
  https://cdn.jsdelivr.net/gh/devicons/devicon/icons/{name}/{name}-{variant}.svg
  variants: original | plain | plain-wordmark | original-wordmark
```

### Naming convention

- File names use **kebab-case**, drop vendor IDs and version suffixes.
  - `instagram_1400829.svg` → `instagram.svg`
  - `visualstudiocode-original.svg` → `vscode.svg`
- For duplicates of the same concept, suffix with `-01`, `-02` (e.g. `pen-01.svg`).
- Use the **common short name**, not the legal name:
  `aws.svg` (not `amazonwebservices.svg`), `vscode.svg`, `gemini.svg`.

## Recoloring

Simple Icons SVGs use `fill="currentColor"` after the brand-color path — drop
the hardcoded fill or wrap in CSS to recolor. Lobehub monochrome icons behave
the same. Color variants (e.g. `aws-color.svg`, `claude-color.svg`) retain the
official multi-color palette and should not be recolored.

## Brands not available in any free source

Some brands (e.g. **Suno color**, **Midjourney color**, certain proprietary
logos) are only available in monochrome from the sources above. If a multi-color
version is required, fetch from the brand's official press kit and document the
license in commit history.
