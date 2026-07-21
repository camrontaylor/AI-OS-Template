# Adapter Specs

Each adapter should have its own folder with:

- `README.md` - what it connects to and why
- `permissions.md` - required scopes and environment variable names
- `run.sh` or equivalent - the actual fetch command
- `fallback.md` - what to do when the connector is unavailable

Do not commit tokens or raw secrets.
