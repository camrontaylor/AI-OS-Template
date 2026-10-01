## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/ops-project-management/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /ops-project-management — Project management across the portfolio

Methodology-first project management. Kanban + Eisenhower + async. One board per business. Tool-agnostic via adapters.

<a id="mental-model"></a>
## Mental model

Each business gets its own kanban with 5 columns:

```
Backlog  →  Ready  →  In Progress  →  Review/Blocked  →  Done/Archived
```

- **Backlog**: everything that *might* matter — not yet committed
- **Ready**: triaged, well-defined, can be picked up
- **In Progress**: actively being worked
- **Review/Blocked**: waiting on someone else, review, or external dependency
- **Done/Archived**: shipped or killed

**Eisenhower** sits on top of the board — used to triage Backlog → Ready (which items make the cut) and to pick next from Ready (which Ready item to pull).

```
                Urgent          Not Urgent
Important       Q1: Do          Q2: Schedule    ← Q2 is the high-leverage zone
Not Important   Q3: Delegate    Q4: Delete
```

**Async-first**: every status snapshot should read like a Loom you didn't have to record. Make work visible without requiring a meeting.

<a id="step-1--detect-mode-and-target"></a>
## Step 1 — Detect mode and target

Parse the invocation:

| Invocation | Mode | Target |
|---|---|---|
| `/ops-project-management setup [business]` | setup | the named business |
| `/ops-project-management triage [business]` | triage | the named business (or ask) |
| `/ops-project-management next [business]` | next | the named business |
| `/ops-project-management next` | next | **across all boards** (cross-portfolio) |
| `/ops-project-management status [business]` | status | the named business (or ask) |
| `/ops-project-management unblock [business]` | unblock | the named business (or ask) |
| `/ops-project-management weekly` | weekly | all boards (Friday pulse) |
| `/ops-project-management weekly [business]` | weekly | the named business |

<a id="step-2--load-board-config--personal-overlay"></a>
## Step 2 — Load board config + personal overlay

Read `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/boards.md` (personal — real business list + tool mapping per business). Falls back to `boards.md` in the repo if the local file doesn't exist yet — that's a template.

Also try to load `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/team.local.md` if present — this is where the user lists partners, active clients, and typical blocker phrasings. Use it to make status output specific ("Waiting on <partner>'s review") instead of generic.

| Field | Example |
|---|---|
| business | `<slug>` |
| tool | `notion` / `github` / `plane` / `linear` / `obsidian` / `manual` |
| board_id or URL | tool-specific |
| column overrides | only if this board doesn't use the default 5 columns |

If the business has no mapping yet, jump to **setup** automatically — ask which tool, save the mapping, return to the requested mode.

<a id="step-3--load-the-adapter"></a>
## Step 3 — Load the adapter

Read the relevant section of `adapters.md` for the tool. Each adapter section explains how to:
- List cards / issues / pages by column
- Read a single card's full content
- Create a card
- Move a card between columns
- Add a comment / note

Adapters use:
- **Notion** → `$NOTION_API_KEY` (check workspace environment). Database with `Status` select property.
- **GitHub Projects** → `gh` CLI (check authentication first). `gh project item-list`, `gh project item-edit`.
- **Plane** → Plane API (needs `$PLANE_API_KEY` and workspace slug).
- **Linear** → Linear MCP or API key.
- **Obsidian** → local kanban markdown files in the vault. Read/write directly.
- **Manual** → ask the user to paste the current board state; offer to write back to a local markdown file.

<a id="step-4--run-the-mode"></a>
## Step 4 — Run the mode

<a id="setup"></a>
### setup
- Ask which tool the business uses
- Walk through column setup (default 5 columns; offer custom)
- Save mapping to `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/boards.md` (NOT to `boards.md` in the repo — that's a template only). Create the parent directory if it doesn't exist yet.
- Optionally seed the board with starter cards from a conversation about what's on the user's mind for that business

<a id="triage"></a>
### triage
- Pull the Backlog column
- Apply Eisenhower (Q1/Q2/Q3/Q4) — show the user the matrix view
- Recommend moves:
  - Q1 (urgent + important) → move to Ready or In Progress now
  - Q2 (important, not urgent) → move to Ready, schedule when
  - Q3 (urgent, not important) → delegate (to whom?) or move to Ready if no one
  - Q4 (neither) → archive
- Apply moves via the adapter (or output text the user applies manually)

<a id="next"></a>
### next
- **Single board**: pull Ready, then In Progress. If WIP exceeded, surface what to finish first. If WIP available, recommend top Ready item by Eisenhower priority.
- **Cross-portfolio** (`/ops-project-management next` with no business): pull Ready from every board, Eisenhower-rank, recommend top 1–3 across all businesses. Bias toward Q1 then Q2.

<a id="status"></a>
### status
Generate an async-shareable snapshot:

```markdown
# [Business] — Status as of YYYY-MM-DD

**Shipped this week:** N cards
- <card title>
- <card title>

**In progress:** N cards
- <card title> — <who/what>

**Review/Blocked:** N cards
- <card title> — blocked on <reason>

**Up next:** top 2–3 from Ready
- <card title>
- <card title>

**Open question:** <one thing that would unblock progress if answered>
```

Output is paste-ready for Slack, Notion, email, partner DM.

<a id="unblock"></a>
### unblock
- Read everything in Review/Blocked
- For each card: surface the blocker, suggest an action (nudge X, escalate to Y, descope, kill, move back to In Progress if blocker is gone)
- Output a short list of moves

<a id="weekly"></a>
### weekly
**Friday pulse + planning**:
1. For each board: shipped this week, in progress, blocked
2. Cross-portfolio: where's momentum? where's drift?
3. Plan next week: 3–5 Q2 items to pull from Ready into In Progress on Monday
4. Output the combined snapshot — pasteable into Notion weekly log, partner update, or personal journal

<a id="wip-limits"></a>
## WIP limits

Default WIP per column (override in your local `boards.md` per business):

| Column | Default WIP |
|---|---|
| In Progress | 3 |
| Review/Blocked | (no limit — but flag if >5) |

If WIP exceeded in `next` mode, **don't pull more** — recommend finishing or moving something to Review/Blocked first.

<a id="async-first-writing-rules"></a>
## Async-first writing rules

When generating status / weekly outputs:

- **Lead with the headline** — what shipped this week, or what's at risk
- **Be specific** — "shipped X" not "made progress on Y"
- **No verbs without subjects** — write so the reader can pick up cold
- **Blockers name the blocker** — "waiting on designer's review" not "blocked"
- **Open questions are explicit** — one bolded line per status that asks for what would unblock momentum

<a id="composes-with"></a>
## Composes with

- `str-decide` — when a project hits a real decision, route to `/str-decide`
- `str-deep-research` — when a card needs research before it's actionable
- `str-business-brainstorm` — when an idea on the Backlog deserves pressure-testing before triage
- `mkt-jab-hook` — when status / shipped items become BIP-post material
- Memory (`project_*.md`) — for portfolio context per business

<a id="notes-on-quality"></a>
## Notes on quality

- **Limit WIP.** Multitasking is the most reliable way to ship nothing. Cap In Progress at 3 (override in your local `boards.md` per business if truly needed). If the cap is hit, don't pull more — recommend finishing or moving something to Review/Blocked.
- **Lead with the headline** in every status output — what shipped this week, or what's at risk. Not "made progress on X" — that's noise.
- **Be specific.** "Shipped the primary logo variant" beats "made progress on branding." Specificity signals real motion; vagueness signals none.
- **No verbs without subjects.** Write status so the reader can pick up cold — 3 weeks later or forwarded to a partner who missed the last update.
- **Blockers name the blocker.** "Waiting on designer's review of the homepage draft" — not "blocked." Blockers without names create no urgency.
- **Open questions are explicit** — one bolded line per status that asks for what would unblock momentum. Async momentum lives or dies on how well open questions are surfaced.
- **Tool-agnostic by design.** pm speaks Kanban + Eisenhower; the adapters (Notion / GitHub / Plane / Linear / Obsidian / manual) translate. Adding a new tool = one adapter file, not a rewrite.
