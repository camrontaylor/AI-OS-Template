# ASSESSMENT: unstuck

_Assessed by meta-skill-intake methodology · 2026-07-21 · awaiting sign-off._

## 1. Snapshot

- **Source:** coreyhaines31/makerskills (MIT) · re-synced 2026-07-21 to `skills-library/backlog/maker/skills/unstuck/`
- **Upstream:** net-new skill added in maker commit `e4de32c` ("new skill - unstuck, the roadblock antidote"), landed between our 2026-07-08 vendor (`c6e5c3d`) and this sync (`d441370`).
- **Shape:** one ~157-line `SKILL.md` (router) + `references/techniques.md` (~118 lines, the 10-technique inventory). Bundled correctly - one skill, one entry, references loaded on demand. Version 0.1.0.
- **Status:** staged to review 2026-07-21.

## 2. Inferred intent and potential

`unstuck` is a lateral-thinking crowbar for "impossible." It classifies what kind of wall you
hit (assumption / framing / gatekeeper / tool-tech / resource / physics), then runs the
matched techniques - assumption autopsy, inversion, first principles, constraint toggling,
analogical transfer, SCAMPER - forcing a minimum of 10 different-in-kind angles before any
evaluation. Output is 1-3 viable angles with next actions, or an honest "the wall is
load-bearing, reroute the goal."

The differentiator vs a normal thinking skill is the **agent fast-path**: it tells the agent
to run the routine *on itself* before reporting a dead end - "when an API doesn't support
what you need, an approach has failed twice, or a 'that's not possible' sentence is forming,
run the fast path first; every dead-end report arrives with tried-angles receipts." That is
posture, not a tool the user has to remember to invoke. For AI-OS specifically, this attacks
the single most common low-quality agent outcome: the premature "that can't be done" reply.

## 3. Capability decomposition

| Piece | What it does | Novelty |
|-------|--------------|---------|
| Wall-type taxonomy (6 classes -> lead techniques) | Picks the right technique by "no" type; decompiles "impossible" into expensive/undocumented/refused/unknown | NEW - no live skill classifies blockers |
| 10-technique lateral-thinking inventory (`references/techniques.md`) | The crowbar set: autopsy, inversion, first principles, altitude shift, work-backwards, analogical transfer, constraint toggling, provocation, SCAMPER, interrogate-the-no | NEW - fuller/more operational than the thinking-partner catalog's problem-solving slice |
| Min-10-angles quantity gate + "different in kind" rule | Forces past the first mediocre workaround before judging | NEW - a concrete anti-satisficing mechanism |
| **Agent fast-path** | Agent runs it on itself before any dead-end report | NEW - core posture, the highest-value piece |
| Archive to `~/.config/makerskills/unstuck/archive/` | Wall pattern library over time | DE-TAILOR - reroute to AI-OS memory, not a hidden dotfolder |
| Compose hooks (decide / deep-research / pm / second-brain) | Hands forks to decide, research angles to deep-research | SYNERGY - maps onto q-question and the AGENTS.md thinking posture |

## 4. Dependency map

| Needs | Status |
|-------|--------|
| MCP / `.env` keys / external services | **none** - fully self-contained, no dependencies |
| `/decide` skill (for mutually-exclusive forks) | soft - not live; the AGENTS.md thinking-partner posture + q-question cover the fork-resolution role |
| `/deep-research` skill (for "needs research" angles) | **have** - `deep-research` skill is available |
| Archive location | DE-TAILOR needed - point at AI-OS memory/project notes, not `~/.config/makerskills/` |

No blocking dependencies. This is the cleanest-to-promote candidate in the backlog on the
dependency axis.

## 5. Grain-check

- **No-hard-delete:** clean, no deletion behavior.
- **Single USER/memory model:** minor conflict - it archives to `~/.config/makerskills/unstuck/archive/`. De-tailor to write archives into AI-OS memory/project notes so the single memory store holds them (rule 2026-06-24: AI-OS is the only memory store).
- **Tool-agnostic contract:** clean - no hardcoded tools.
- **Category system:** fits `q` (judgment/decision family, alongside q-question).
- **Voice rules / humanizer gate:** it produces analysis, not publishable client text, so no humanizer gate needed; its own prose uses no em/en dashes-adjacent style issues worth flagging.
- **Overlap with existing posture:** it neighbors the AGENTS.md "Thinking Discipline" (thinking-partner) posture and the parked `decide` skill. It does NOT duplicate them - thinking-partner surfaces hidden assumptions on *decisions*; unstuck breaks *blockers*. Complementary, not redundant.

## 6. Past-use-case examples

Direct user-trigger evidence ("I'm stuck / impossible / dead end") in `context/memory/`: **none found** (grep 2026-07-21). By the strict rule that is a park signal. But the relevant trigger for this skill is not user language - it is the **agent fast-path**, which fires whenever an agent is about to report a dead end. That is a routine event in this workspace's build/ops/integration work (e.g. MCP/tool limits, "the API doesn't support X" moments) and is exactly the failure mode the fast-path prevents. The likeliest near-term trigger: any client website/integration task where a tool or platform limit surfaces mid-build. The value is standing (every hard task), not tied to a past dated moment.

## 7. Per-piece disposition

- Wall taxonomy + technique inventory + quantity gate -> **NEW** (promote as the skill body).
- Agent fast-path -> **NEW + SYNERGY -> AGENTS.md** - promote inside the skill, and add a one-line pointer in the AGENTS.md thinking/quality posture so the fast-path is standing behavior, not opt-in (thinking-partner precedent).
- Archive-to-dotfolder -> **DE-TAILOR** - redirect to AI-OS memory/project notes.
- decide/deep-research/pm/second-brain compose hooks -> **SYNERGY** - rewire to q-question, deep-research (have), and AI-OS memory.

## 8. Recommendation + open questions

**Promote as live `q-unstuck`** - one router `SKILL.md` + `references/techniques.md` (the
bundled shape), with three de-tailors: (a) archive to AI-OS memory/project notes instead of
`~/.config/makerskills/`; (b) rewire compose hooks to q-question / deep-research / AI-OS
memory; (c) trim the frontmatter description (upstream is ~1,500 chars, over the 1,024 cap)
while keeping the agent-fast-path trigger language. Plus a one-line AGENTS.md posture pointer
so the fast-path runs as standing behavior.

Rationale for promoting despite zero dated past-use: the value is the agent-fast-path, which
is standing posture that improves nearly every hard task, has no dependencies, and is low
bloat (one skill). This is the strongest-fit net-new candidate to surface since slide-deck.

### Open questions for sign-off

1. **Category/name:** `q-unstuck` (judgment family, next to q-question) - confirm or rename.
2. **Fast-path as AGENTS.md posture:** add the one-line "run unstuck before any dead-end
   report" pointer to the thinking/quality section (recommended), or keep it skill-only?

Reply "go" (optionally naming the category) and promotion is mechanical.
