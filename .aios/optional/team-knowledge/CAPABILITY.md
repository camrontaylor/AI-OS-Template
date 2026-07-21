# Optional Capability: team-knowledge

## Purpose

`team-knowledge` creates a curated shared knowledge layer for teams. It is not a
shared personal memory system. It is a place to intentionally promote reusable
team decisions, operating notes, methods, and source summaries into versioned
files.

## What It Creates

Enabling copies starter files into:

```text
team_context/
  README.md
  decisions.md
  operating-notes.md
  inbox/
  sources/
```

## Rules

- Personal memory stays in `context/` and remains private.
- Client work stays in `clients/` unless `shared-clients` is enabled later.
- Raw Slack, meeting, or transcript captures go to `team_context/inbox/` first.
- Only curated, reusable knowledge should be promoted into canonical files like
  `decisions.md` and `operating-notes.md`.
- Do not store secrets or private client details here.

## Activation

```bash
bash scripts/optional-enable.sh team-knowledge
```

This creates the starter structure and a local marker at
`.aios/enabled/team-knowledge.json`. Disabling removes only the marker by
default and leaves `team_context/` intact.
