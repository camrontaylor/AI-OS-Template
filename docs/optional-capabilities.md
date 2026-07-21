# Optional Capabilities

Optional capabilities let AI-OS carry extra architecture without forcing it into
daily use.

The rule is simple: a capability can ship with the template only if it is inert
by default. It must not load at startup, install dependencies, change task
routing, create active folders, or touch memory until someone enables it.

## Why This Exists

Some features are valuable for teams but too heavy for every user:

- shared team knowledge
- shared client collaboration
- MCP-backed source ingestion
- workflow packs that only some teams need

Putting these directly into the core runtime would create complexity creep.
Putting them in `.aios/optional/` keeps the architecture available without
making it mandatory.

## Folder Model

```text
.aios/
  optional/
    INDEX.md
    <capability>/
      CAPABILITY.md
      manifest.json
      templates/
  enabled/
    .gitkeep
```

`.aios/optional/` is versioned. `.aios/enabled/*.json` is local state and is
gitignored.

## Commands

List available capabilities:

```bash
bash scripts/optional-list.sh
```

Inspect all capabilities, or one capability:

```bash
bash scripts/optional-status.sh
bash scripts/optional-status.sh team-knowledge
```

Enable a capability:

```bash
bash scripts/optional-enable.sh team-knowledge
```

Preview enablement without writing:

```bash
bash scripts/optional-enable.sh team-knowledge --dry-run
```

Disable a capability:

```bash
bash scripts/optional-disable.sh team-knowledge
```

Disabling removes only the local marker. It does not delete folders that may now
contain work.

## Capability Contract

Every optional capability must include:

- `manifest.json` - machine-readable name, status, commands, created paths,
  services, permission surface, and rollback behavior
- `CAPABILITY.md` - human-readable purpose, boundaries, and activation notes
- `templates/` - starter files copied only when enabled

Every capability must answer:

- What does this create?
- What does this write?
- What external services or keys can it use?
- What privacy boundary does it create?
- How do you roll it back?

## Current Capabilities

| Capability | Status | What it does |
|------------|--------|--------------|
| `team-system` | Available | Publishes a clean AI-OS system copy to a private team repo |
| `team-knowledge` | Available | Creates curated shared team docs in `team_context/` |
| `shared-clients` | Scaffold | Reserves a future explicit shared-client collaboration layer |
| `context-farmers` | Scaffold | Reserves a future MCP/source-adapter ingestion layer |

## Team Boundary

`team-system` shares the AI-OS system safely. It does not create shared memory.

To add shared memory deliberately, enable `team-knowledge`. To add external
context sources later, enable `context-farmers` and keep adapters writing to an
inbox first.
