---
name: ops-client-dashboard
description: "Read your agency's shared client task dashboard, the board where subscribed clients' tasks live. Use to check, open, screenshot, or overview a client's board, kanban, backlog, or a deliverable's status. Not for other tools or for building the dashboard itself."
when_to_use: 'Invoke when the request sounds like: "check the client dashboard", "client task board", "what''s on the board", "read the kanban", "what''s on the client board", "what''s in the backlog"'
---

# ops-client-dashboard

Read a client's task board on your agency's shared client dashboard, headless. This is the board
where work for your subscribed clients lives. The backend is whatever per-agency SaaS you use, set as
`CLIENT_DASHBOARD_URL` in the root `.env`. The skill is named by FUNCTION, not by tool, so when you
change backend you swap it here (or hand off to the Notion connector) without renaming anything.

The agent signs in as ITSELF, using its own inbox (see `ops-agent-email`), as a Member scoped to its
assigned clients. The deterministic steps live in `scripts/`. This is a **root shared skill**: the same
copy runs from every client workspace, with ONE shared login stored OUTSIDE any client at
`~/.agent-browser/profiles/client-dashboard`. On invoke, also read `SKILL.local.md` here if it exists.

## Context Needs

| File | Load level | Why |
|---|---|---|
| Active client `context/current-state.md` | summary, when present | Identify the client and current work |
| Active client `context/learnings.md` | `## ops-client-dashboard` | Client-specific dashboard lessons |
| Root `context/learnings.md` | `## ops-client-dashboard` | Shared login and backend lessons |

## How it works (plain English)
- The board is read headless: no window pops up. You ask, the agent opens the board, screenshots it,
  reads the cards, and reports.
- The agent is its own team member. It never uses your login or a stored password.
- **The login is durable**: one shared session, survives restarts, lasts weeks. The account has no
  password. When it eventually lapses, re-auth is a quick admin step: re-invite the agent's own
  address (`AGENTMAIL_ADDRESS`) in the dashboard's Team settings, and the agent reads that invite from
  its own inbox and re-joins automatically (`relogin.sh`).

## View  ("check the client dashboard", "what's on the client board", "screenshot the board")
1. `bash scripts/view.sh` reads the default board. For another client, pass the
   id or full URL: `bash scripts/view.sh <customer-id>` (the id is in the board URL,
   `.../dashboard/customer/<id>`).
2. It writes `~/.agent-browser/client-dashboard-out/board.png` and `board.txt`. Read both and summarise.
3. Exit code 2 means it could not authenticate even after a re-auth attempt; run `relogin.sh`.

## Read the actual cards (MANDATORY before any card-level judgement)
The board view gives titles and comment counts only. The title is NOT the content. Any time the
job is to pick the right card, decide where a deliverable belongs, judge what has or has not been
delivered, or answer "is this already done / already sent", you MUST open and read the individual
cards and what was delivered inside them (messages, attached docs, linked Notion pages). Never
choose or rule out a card from its title. This is not optional and not a shortcut you skip when
short on time; a title-only call is wrong often enough that it burned a real recommendation.

Mechanism (headless, same shared session):
1. From the open board, pull each card's task link:
   `ab eval 'JSON.stringify(Array.from(document.querySelectorAll("a[href*=\"/dashboard/tasks/\"]")).map(a=>({t:(a.innerText||"").trim().slice(0,60),h:a.href})))'`
2. Open each card you care about and dump its full text:
   `cd_open "$CD_HOST/dashboard/tasks/<task-id>?from=sub"; ab wait 4500; ab get text body > out.txt`
   (source `scripts/_common.sh` first so `cd_open`/`ab`/`CD_HOST` are defined).
3. For the delivered content itself, follow the external links on the card (Notion, Loom, docs)
   and read those too. Notion pages read cleanly via the authenticated Notion connector
   (`notion-fetch`), not from the card text alone.
4. Only after reading the relevant cards and their delivered docs do you make the call.

## Status / Relogin
- `bash scripts/status.sh` reports valid or expired (and auto-renews if it can).
- `bash scripts/relogin.sh` re-establishes the session by reading the latest dashboard invite link from
  the agent inbox and completing the join. It needs a FRESH invite first (an admin re-invites the agent
  in Team settings), because the invited account has no password and no standard sign-in.

## Adding the agent to a new client board
The agent only sees clients it is assigned to (least privilege). To grant a new one, an admin opens the
dashboard's Team settings, finds the `AI Agent` member, and assigns that client (and ensure the role is
`Member`, not `Collaborator`, so it sees the full task board). Then `view.sh <new-id>` works.

## Rules
- ONE shared login at `~/.agent-browser/profiles/client-dashboard`; never copy session data into a
  client folder or git. Outputs go to `~/.agent-browser/client-dashboard-out/` (also outside git).
- Pass `--profile` to agent-browser ONLY on the daemon-booting open; later calls use the session alone.
  Always `close` before a fresh `open` (the scripts do this).
- No password anywhere; the invited account has none. Everyday access is the durable shared session.
  Re-auth on expiry needs a fresh admin invite, then the agent rejoins by reading it via
  `ops-agent-email` (needs `AGENTMAIL_API_KEY` reachable).
- Keep reads on-demand or daily; do not poll hard (paid SaaS).
- The backend is per-agency SaaS and may change. Keep this skill thin and tool-agnostic; on a move,
  repoint `CLIENT_DASHBOARD_URL` or hand off to the Notion connector.
- 2026-07-30: Never judge, pick, or rule out a task card from its title or comment count. Before any
  card-level call (which card to message, where a deliverable belongs, is this already delivered),
  open and read the individual cards and their delivered docs/links (see "Read the actual cards").
  A title-only recommendation was made and was wrong: the "Feasibility Check" card was actually the
  EXO API-access thread, and the deliverable in question turned out already delivered inside other
  cards' Notion docs. Read first, then call it.

## Dependencies
- `agent-browser` CLI (required, v0.27.0+).
- `ops-agent-email` skill + `AGENTMAIL_API_KEY` (required for re-auth).
- The agent must be a `Member` of the dashboard team, assigned to the client(s) being read.

## Eval

Run this manual eval before changing dashboard access or backend behavior:

1. Status check: pass if `bash scripts/status.sh` reports whether the shared
   dashboard session is valid without copying session data into the repo.
2. View check: pass if `bash scripts/view.sh` writes board output outside git
   under `~/.agent-browser/client-dashboard-out/` and the skill summarizes those
   outputs.
3. Reauth check: pass if expired sessions route through `ops-agent-email` and a
   fresh admin invite, not a stored password or human login.

The eval fails if client session data enters a client folder, dashboard polling
is aggressive, a password is requested, or the backend migration loses the
function-level skill boundary.

## Self-Update
After any login or read incident, append a dated line to `## Rules` above and to
`context/learnings.md` (`## ops-client-dashboard`).
