# Optional Capability: shared-clients

## Purpose

`shared-clients` is the future collaboration layer for client work that multiple
teammates intentionally share. It is separate from `team-system` because client
collaboration needs stronger permissions and merge rules than system sharing.

## What It Creates

Enabling copies a starter folder:

```text
shared_clients/
  README.md
```

This is only a scaffold. It does not make existing `clients/` folders shared.

## Boundary

- Root `clients/` remains private by default and is stripped from clean team
  system exports.
- Shared client work should be explicitly promoted into `shared_clients/` or a
  future per-client shared repo.
- Do not symlink or copy private client memory into this layer without a
  deliberate sharing decision.

## Activation

```bash
bash scripts/optional-enable.sh shared-clients
```
