# Live Skills - Third-Party Attribution

Most skills in this folder are original AI-OS work. The ones below are derived from
third-party packs vendored through `skills-library/backlog/`. Their upstream licence
text ships with this repo at the path in the last column, which is what the licence
requires when the code is redistributed.

Provenance and redistribution status for every vendored pack (including the ones that
are deliberately NOT published) live in `skills-library/LICENSES.md`.

| Skills | Upstream source | Licence | Licence text in this repo |
|---|---|---|---|
| `coreyhaines-marketing-*` | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT | `skills-library/backlog/marketing/LICENSE` |
| `coreyhaines-skills-*` | [coreyhaines31/makerskills](https://github.com/coreyhaines31/makerskills) | MIT | `skills-library/backlog/maker/LICENSE` |

The AI-OS copies are modified: kept under the author's own `coreyhaines-` namespace
rather than an AI-OS category prefix, re-described for the skill picker, and given an
explicit `## Context Needs` contract. Keeping the author's namespace shows provenance
in the picker and keeps this methodology visibly separate from AI-OS's own `mkt-*` and
`str-*` skills. MIT permits modification provided the copyright and permission notice
travel with the code, which the licence files above satisfy.

## Adding another vendored pack

When a pack is promoted from `skills-library/backlog/` into this folder:

1. Add a row here naming the upstream source and licence.
2. Confirm the upstream `LICENSE` file is committed under `skills-library/backlog/<pack>/`.
3. Add or update the matching row in `skills-library/LICENSES.md`.
4. If the pack is proprietary or its licence is unverified, do NOT promote it. Add its
   path to `never_publish` in `config/update-manifest.json` so it can never reach the
   public template.
