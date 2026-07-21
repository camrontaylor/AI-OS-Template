# Optional Capability: team-system

## Purpose

`team-system` is the safe sharing layer for the AI-OS system itself. It lets a
maintainer publish rules, scripts, docs, live skills, and the command centre to
a separate private team repo without exposing clients, projects, memory, local
rules, or secrets.

## Status

Available by default as system maintenance commands:

- `bash scripts/make-team-copy.sh`
- `bash scripts/team-status.sh`
- `bash scripts/team-publish.sh`
- `bash scripts/team-join.sh`

This pack is documented in `.aios/optional/` so optional team architecture has a
home, but the working scripts remain in `scripts/` because they are harmless
unless called.

## Boundary

This capability solves shared system distribution. It does not create shared
team memory or shared client collaboration. Those are separate optional packs
because they need different permissions and merge rules.

## Activation

No activation is required to use the scripts. Running
`bash scripts/optional-enable.sh team-system` only records a local marker that
the checkout is intentionally using this capability.
