# Command Centre Startup

Command Centre launches from `command-centre`, and its explicit Next.js root stays scoped to that directory so Turbopack and output tracing don't wander outside the app.

## Supported commands

- `npm run dev`
- `npm run build`
- `npm run start`

These commands all run through `scripts/next-run.cjs`.

## Startup contract

- The launcher always uses the app-local Next CLI from `command-centre/node_modules`.
- `dev` and `build` always run with Turbopack.
- `start` runs from the same launcher so runtime env and paths stay aligned with `dev` and `build`.
- The launcher `cwd` is `command-centre`.
- The explicit Next.js root for Turbopack and output tracing is the `command-centre` directory itself.
- The AI-OS workspace root is the repository root containing `AGENTS.md` or, on the current `dev` branch, `CLAUDE.md`.
- `AI_OS_DIR` is optional. If it is unset, the launcher and runtime auto-detect the workspace root.
- Hosted Docker deployments should set `AI_OS_DIR` to a persistent mount such as `/workspace`.
- Server workspace GitHub backup is configured with `TEAM_OS_GITHUB_BACKUP_REMOTE`, `TEAM_OS_GITHUB_BACKUP_TOKEN`, and optional branch/user/interval vars.

## Unsupported paths

- `npm run dev -- --webpack`
- `npm run build -- --webpack`
- invoking a global `next` binary instead of the app-local one

## Direct launcher usage

```powershell
node scripts/next-run.cjs dev
node scripts/next-run.cjs build
node scripts/next-run.cjs start
```

You can also run from outside the app directory:

```powershell
npm --prefix command-centre run dev
```
