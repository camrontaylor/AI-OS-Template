# ASSESSMENT: slide-deck

_Assessed by meta-skill-intake methodology · 2026-07-16 · awaiting sign-off._

## 1. Snapshot

- **Source:** coreyhaines31/makerskills (MIT) · vendored 2026-07-08 to `skills-library/backlog/maker/skills/slide-deck/`
- **Shape:** one ~290-line `SKILL.md` + 5 `references/` files (system, narrative-and-voice, template, ppt-conversion, export). No live AI-OS skill covers slide decks or presentations.

## 2. Inferred intent and potential

Client delivery regularly ends in a presentation: prior sitemap work already flagged
"convert the FigJam board into a client-ready deck" (client memory, 2026-06-25), and
the 2026-07-08 session offered "de-tailor + promote slide-deck... say go" - the go never
came. The methodology is strong and portable: structured brief capture, three narrative
angles (safe / bold / wildcard), density modes (speaker-led vs reading-first), speaker-note
structure, and overflow guards on edits.

## 3. Dispositions

| Piece | Disposition |
|-------|-------------|
| Brief -> angles -> outline -> expand -> notes methodology | NEW - the core value, fully portable |
| React/Next.js `Slide[]` output, primitives, dev-server preview, Playwright export | DE-TAILOR - hard-tied to the author's personal slide repo (`SLIDE_DECK_REPO`); replace with Marp markdown (default) or standalone HTML output |
| PPTX conversion mode (python-pptx) | NEW - portable as-is |
| Voice rules ("write for the ear") | SYNERGY -> mkt-brand-voice context + tool-humanizer gate |

## 4. Recommendation

**Promote as `viz-slide-deck` on the first real deck request; hold until then.** The de-tailor
is a rewrite of the output layer (Marp default - no install, renders anywhere; HTML export
optional), which is only worth doing against a real deck so the format decision is tested,
not guessed. No demonstrated past use yet, and the 26-of-39-zero-use cleanup says do not
promote ahead of demand.

### Open question for sign-off

Output format default: **Marp markdown** (recommended - plain files, no dependencies) vs
standalone HTML (heavier but pixel-controlled). Reply "go, Marp" (or name the format) and
promotion is mechanical.
