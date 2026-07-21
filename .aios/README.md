# AI-OS Internal Registry

`.aios/` holds AI-OS system metadata that should be versioned with the
template but should not become live runtime behavior by existing.

- `optional/` contains dormant capability packs.
- `enabled/` contains local activation markers. The marker JSON files are
  gitignored so enabling a capability in one checkout does not force it on for
  everyone else.
