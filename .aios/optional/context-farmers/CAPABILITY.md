# Optional Capability: context-farmers

## Purpose

`context-farmers` is the future adapter layer for pulling useful context from
external systems such as Slack, Notion, Fireflies, Google Drive, or other MCP
sources.

The important boundary: source adapters feed an inbox. They do not write
directly into canonical AI-OS memory.

## What It Creates

Enabling copies:

```text
context_farmers/
  README.md
  adapters/
  automation/
  inbox/
```

The included automation file is only an example. No scheduled job runs until a
human copies or adapts it into `cron/jobs/` and adds real credentials.

## Rules

- Each adapter must declare its source, permission scope, write path, and
  fallback.
- Adapter output lands in `context_farmers/inbox/` or `team_context/inbox/`.
- A human or reviewing agent promotes only useful, safe summaries into shared
  docs.
- Never store secret values in the repo. Reference environment variable names
  only.

## Activation

```bash
bash scripts/optional-enable.sh context-farmers
```
