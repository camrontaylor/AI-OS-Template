# Optional Capabilities

Optional capabilities are versioned but dormant. They ship with AI-OS so the
architecture is available when needed, but they do not load at startup, install
dependencies, change routing, or create active work folders until enabled.

## Current Packs

| Capability | Purpose | Default |
|------------|---------|---------|
| `team-system` | Safe two-repo system sharing for teams | Available, not required |
| `team-knowledge` | Curated shared team knowledge in `team_context/` | Off |
| `shared-clients` | Future shared client collaboration layer | Off |
| `context-farmers` | Future MCP-backed context source adapters | Off |

## Commands

```bash
bash scripts/optional-list.sh
bash scripts/optional-status.sh
bash scripts/optional-enable.sh team-knowledge
bash scripts/optional-disable.sh team-knowledge
```

Enabling writes `.aios/enabled/<capability>.json` and copies only that
capability's starter templates. Disabling removes the marker and preserves any
created work by default.
