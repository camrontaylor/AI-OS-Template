> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only authenticated services made available by the authoritative snapshot; local .env setup applies only to Solo mode.

# Optional social-source authentication

## Optional service names

| Environment variable | Provider | Role |
|---|---|---|
| `SCRAPECREATORS_API_KEY` | ScrapeCreators | Supported public social-source API endpoints |
| `APIFY_API_TOKEN` | Apify | Explicitly selected social scraping actors |

These services are optional. Check current official coverage and pricing before use; a configured key does not authorize unrequested paid calls.

## Solo setup

1. Use an existing authenticated connector when available. Otherwise obtain the selected provider credential through its own dashboard.
2. Store the real value privately in the active workspace's gitignored `.env`. For a root-scoped integration use the AI-OS root `.env`; for a client integration use that client's `.env`.
3. Keep only empty placeholders such as `SCRAPECREATORS_API_KEY=` and `APIFY_API_TOKEN=` in tracked `.env.example`. Do not put real values in commands, copied guides, generated artifacts, or chat output.
4. Run Node tools with a supported Node 22 runtime and `--env-file-if-exists`. Load the root file first and the active client file last so client values override root defaults. Do not shell-source a prose description or print any key prefix.

## Presence-only check

Run from the AI-OS root. This prints variable names and presence flags only, never credential values:

```bash
node --env-file-if-exists=.env -e 'for (const name of ["SCRAPECREATORS_API_KEY", "APIFY_API_TOKEN"]) console.log(name + ": " + (process.env[name] ? "configured" : "missing"));'
```

For an explicitly active client, replace `{client-slug}` with its actual folder and use:

```bash
node --env-file-if-exists=.env --env-file-if-exists=clients/{client-slug}/.env -e 'for (const name of ["SCRAPECREATORS_API_KEY", "APIFY_API_TOKEN"]) console.log(name + ": " + (process.env[name] ? "configured" : "missing"));'
```

A presence flag does not prove valid authentication. Confirm through an available authenticated connector or an explicitly authorized non-destructive provider request.

## Request handling

Use an available authenticated connector, a verified shared CLI, or an in-process HTTP client that reads credentials from the runtime environment.
Construct auth headers or provider-required credential parameters only inside that process. Never place secret values in shell arguments, URLs rendered to the user, logs, snapshots, cache data, or output reports.
Log request identity and sanitized status only. Honor the runtime's access and media restrictions.

## Free and manual fallback

When neither service is configured, try accessible public APIs and permitted browser reads; return available content with clear coverage limits.
If free access fails, accept user-pasted post text or an exported file. Never claim a preview contains replies or a complete thread.

## Cost and cache discipline

Use the 24-hour scoped cache for successful single-post fetches; bypass when refreshing or fetching replies/threads.
Do not enable optional depth, paid providers, or bulk actors automatically. Identify requested coverage and authorized spend before a paid call.
