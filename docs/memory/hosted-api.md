# Hosted Memory API — ingest & search endpoints

The hosted memory API is a small HTTP service that runs **next to the hosted
Postgres** (Railway or a VPS) and exposes team memory through scoped endpoints:
**ingest/search**, admin **manual imports**, team/client context, and granted
workspace file sync.

Why it exists: without it, every consumer of hosted memory needs the raw
`MEMORY_DATABASE_URL` — full database credentials, no permission boundary. With
it, consumers get a **URL + user-scoped Better Auth session token** instead.
The client generates BGE-M3/1024 embeddings, then the server validates scope,
writes the audit trail, and keeps database credentials to itself. A shared dev
token can still be configured for internal smoke tests, but normal users should
sign in with email and password.

- Part 1 is for the **stakeholder / account owner**: set up Railway, pick a
  plan, invite the developer. No technical steps.
- Part 2 is for the **developer**: deploy the two services, configure env vars,
  verify, and consume the API.

---

## Part 1 — Stakeholder setup (Railway account, plan, access)

You do this once. It takes about 10 minutes and requires a credit card.

### 1. Create the Railway account

1. Go to [railway.com](https://railway.com) and sign up — use a company email
   (or the company GitHub account; GitHub sign-in keeps deploys simpler later).
2. Verify the account when prompted.

### 2. Pick a plan

Check current pricing at [railway.com/pricing](https://railway.com/pricing).
What matters for this deployment:

| Plan | Fits | Why |
|------|------|-----|
| **Hobby** (~$5/month, includes usage credit) | Solo pilot | One member only — you cannot invite the developer. Fine if the developer owns the account. |
| **Pro** (~$20/seat/month, includes usage credit) | **Team — recommended** | Required to invite team members (the developer) into a shared workspace. More resources and support. |

Expected monthly usage for this stack (one small Postgres + one small Node
service) is modest — typically inside the plan's included usage credit during a
pilot. Costs scale with memory volume and traffic; review Railway's usage page
after the first month.

**Recommendation:** Pro, so the developer works in the company workspace and
the company keeps ownership of the database and its data.

### 3. Add the developer

1. In Railway: **Workspace → Settings → Members → Invite**.
2. Enter the developer's email, role **Member** (or **Admin** if they should
   manage billing-adjacent settings too).
3. The developer accepts the invite — they can now create the services in
   Part 2.

### 4. What you hand over

Send the developer:

- Confirmation they are in the Railway workspace.
- A decision on the database password and API token storage (use a password
  manager; they will generate the values).

That's it — everything below is the developer's job.

---

## Part 2 — Developer setup

### What you will deploy

Two Railway services in one project:

```text
Railway project "ai-memory"
├── postgres      pgvector/pgvector:pg16 image + persistent volume
└── memory-api    this repo, command-centre/, `npm run memory:api`
```

The database is **never** exposed publicly; the API talks to it over Railway's
private network. Consumers talk to the API only.

### 1. Provision Postgres + pgvector

Follow [`hosted-postgres-setup.md`](hosted-postgres-setup.md) — Railway section.
Summary: **New → Deploy a Docker Image → `pgvector/pgvector:pg16`**, set
`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, and attach a persistent
volume at `/var/lib/postgresql/data`.

### 2. Deploy the API service

1. **New → GitHub Repo** → select this repository.
2. Service settings:
   - **Root directory:** `command-centre`
   - **Start command:** `npm run memory:api`
   - **Healthcheck path:** `/v1/health`
3. Variables on the **memory-api** service:

| Variable | Value | Notes |
|----------|-------|-------|
| `MEMORY_API_TOKEN` | `openssl rand -hex 32` | REQUIRED dev fallback token. The server refuses to start without it. Store it in the team password manager and do not give it to normal users. |
| `MEMORY_DATABASE_URL` | the Postgres service's **private** URL (`postgres://postgres:PASSWORD@postgres.railway.internal:5432/ai_memory`) | Use Railway's variable references to compose it from the database service. |
| `PGSSLMODE` | `disable` | Railway's private network does not offer SSL. |
| `MEMORY_EMBEDDER` | `bge-m3` (default) | Compatibility label only. The hosted API accepts client-provided BGE-M3/1024 vectors and refuses `hash`. |
| `MEMORY_API_TEAM_ID` + `MEMORY_API_USER_ID` | backend IDs for the API token principal | Required in hosted mode unless you use the slug/email alternatives below. |
| `MEMORY_API_TEAM_SLUG` + `MEMORY_API_USER_EMAIL` | team slug + user email | Docker/dev-friendly alternative to fixed IDs. The server resolves the real IDs at startup. |
| `MEMORY_API_BOOTSTRAP_TEAM_SLUG` + `MEMORY_API_BOOTSTRAP_OWNER_EMAIL` | e.g. `local-dev` + owner email | Optional first-start helper: creates/updates an owner membership, then uses it as the server principal when explicit principal env vars are not set. |
| `BETTER_AUTH_SECRET` | strong random secret | Recommended in hosted mode. Better Auth uses it for auth signing and session security. |
| `TEAM_OS_SECRETS_KEYS` + `TEAM_OS_SECRETS_ACTIVE_KEY_ID` | `v1:<base64url-32-byte-key>` + `v1` | Required for shared TeamOS secrets and encrypted `.mcp.json` backup. This encrypts secret/config values at rest and must be separate from `BETTER_AUTH_SECRET`. |
| `AI_OS_DIR` | `/workspace` on hosted Docker | Required for server-side workspace sync. Mount this path on persistent storage; do not leave it inside `/app`. |
| `MEMORY_MODEL_CACHE_DIR` | `/workspace/.command-centre/models` by default | Optional BGE-M3 model cache. The API sets this automatically from `AI_OS_DIR` when unset. |
| `MEMORY_API_SERVER_EMBEDDINGS` | `1` to enable | Optional. Lets `/v1/memory/search` accept `embeddingMode: "server"` so lightweight consumers can send query text only. When enabled, the API loads/downloads BGE-M3 at startup and fails fast if it is unavailable. Disabled by default; client-provided BGE-M3 embeddings remain supported. |
| `TEAM_OS_GITHUB_BACKUP_REMOTE` | `https://github.com/<owner>/<private-repo>.git` | Optional private GitHub repo for backing up server workspace files under `AI_OS_DIR`. |
| `TEAM_OS_GITHUB_BACKUP_TOKEN` | GitHub token with contents read/write on the backup repo | Required when `TEAM_OS_GITHUB_BACKUP_REMOTE` is set. The server uses it for HTTPS push and does not write it to Git config. |
| `TEAM_OS_GITHUB_BACKUP_BRANCH` | `main` | Optional backup branch. |
| `TEAM_OS_GITHUB_BACKUP_INTERVAL_SECONDS` | `900` | Optional backup interval. Set `0` to disable the periodic job. |

   `PORT` is injected by Railway automatically; the server picks it up
   (`MEMORY_API_PORT` overrides it if you ever need to).

4. Generate a public domain for the service (**Settings → Networking →
   Generate Domain**). This URL + the token is what consumers get.

### 3. Apply the schema and verify

The server runs memory migrations and Better Auth migrations automatically at
startup (idempotent). Verify from the deploy logs:

```text
memory-api → /workspace
  backend:  postgres
  embedder: client-provided bge-m3 (dim 1024); server search mode disabled
  backup:   GitHub workspace backup every 900s
  listening on :XXXX  (GET /v1/health)
```

With `MEMORY_API_SERVER_EMBEDDINGS=1`, startup waits for the BGE-M3 model before
the server listens, so the first user search does not pay the download/load cost.
If the model cannot be loaded or downloaded, startup fails; fix network/cache
access or disable `MEMORY_API_SERVER_EMBEDDINGS=1` to use client-provided
embeddings only.

Then from your machine:

```bash
curl https://<your-domain>/v1/health
# {"ok":true,"backend":"postgres","embedder":{"mode":"client-provided","model":"bge-m3","dim":1024,"serverModeEnabled":false}}
```

### 4. VPS instead of Railway

Run the same two pieces: the `docker compose` Postgres from
[`hosted-postgres-setup.md`](hosted-postgres-setup.md), plus
`MEMORY_API_TOKEN=... MEMORY_DATABASE_URL=... npm run memory:api` under a
process manager (systemd, pm2). Front it with a TLS reverse proxy (Caddy,
nginx) — the API itself serves plain HTTP.

### Private/local access without a public URL

A public HTTPS URL is convenient, but not required for local testing or a
private operator setup. You can reach the API through `localhost`, an SSH
tunnel, Tailscale, WireGuard, or another private network path.

On the server, set the public/auth URLs to the address the operator's browser
will use:

```bash
BETTER_AUTH_URL=http://localhost:8787 \
MEMORY_API_PUBLIC_URL=http://localhost:8787 \
MEMORY_API_TOKEN=... \
MEMORY_DATABASE_URL=... \
npm run memory:api
```

For an SSH tunnel, keep the API bound privately on the server and forward it
from the operator's machine:

```bash
ssh -N -L 8787:127.0.0.1:8787 user@server.example.com
```

Then connect the local client through the tunnel:

```bash
npm run team -- login --api-url http://localhost:8787 --email owner@example.com --password "owner-pass-123"
```

Owner reset links also need a base URL that the operator's browser can open.
For localhost or SSH tunnel setups, pass it explicitly:

```bash
npm run team:owner-reset -- --team demo --base-url http://localhost:8787 --ttl 4h
```

For Tailscale, WireGuard, or a private LAN, use the reachable private API URL
instead of `localhost` in `BETTER_AUTH_URL`, `MEMORY_API_PUBLIC_URL`,
`--api-url`, and `--base-url`.

Do not put `MEMORY_DATABASE_URL` on member machines. Only the server/container
gets the database URL. Members should connect through the Team OS API URL.

### Local development

No Postgres needed — the API serves the local PGLite store when no connection
string is set:

```bash
cd command-centre
MEMORY_API_TOKEN=dev npm run memory:api
# memory-api → ...
#   backend:  pglite
#   note: serving from LOCAL PGLite — set MEMORY_DATABASE_URL for hosted team memory.
```

To exercise the hosted path locally, start the repo's compose file
(`docker compose up -d`) and set
`MEMORY_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_memory`.

### Practical local server/client smoke test

This simulates the hosted shape on one machine: one terminal is the Team OS
memory API server, and a second terminal is the client using only a URL plus
email/password login. It uses a temporary local PGLite store, so it does not
need Postgres.

Terminal 1 — prepare the team and start the server:

```powershell
cd command-centre
$env:AI_OS_DIR="$env:TEMP\aios-team-local"
$env:MEMORY_STORE_BACKEND="pglite"
$env:MEMORY_EMBEDDER="bge-m3"

npm run team:create -- --slug local-demo --name "Local Demo Team" --owner-email owner@example.test --owner-name "Owner Example" --owner-password "owner-pass-123"

$env:MEMORY_API_TOKEN="dev-token"
$env:MEMORY_API_PORT="8787"
$env:MEMORY_API_BOOTSTRAP_TEAM_SLUG="local-demo"
$env:MEMORY_API_BOOTSTRAP_TEAM_NAME="Local Demo Team"
$env:MEMORY_API_BOOTSTRAP_OWNER_EMAIL="owner@example.test"
$env:MEMORY_API_BOOTSTRAP_OWNER_NAME="Owner Example"
npm run memory:api
```

Terminal 2 — act as the client:

```powershell
cd command-centre
$env:AI_OS_TEAM_CONFIG_DIR="$env:TEMP\aios-team-client-config"
npm run team -- login --api-url http://127.0.0.1:8787 --email owner@example.test --password "owner-pass-123"
npm run team -- whoami

$proof="$env:TEMP\team-proof.txt"
Set-Content $proof "Team OS local proof phrase: aubergine-927"
npm run team -- memory import --file $proof --visibility team --title "Local Proof"
npm run team -- memory imports --limit 5
```

Search through AI-OS clients for the normal path. Direct API callers either
send BGE-M3 embeddings locally or use `embeddingMode: "server"` when the server
has `MEMORY_API_SERVER_EMBEDDINGS=1`. This proves the practical server/client
boundary: the client has no database credentials, while the server still owns
identity and scope validation. For true live grant/revoke
testing, use hosted Postgres or stop the local PGLite server before running the
direct admin commands, because local PGLite is locked while the API process is
running.

---

## API reference

All bodies are JSON. Authenticated routes require
`Authorization: Bearer <team-session-token>`. The shared `MEMORY_API_TOKEN`
also works as a dev-only fallback when configured.

Errors always look like:

```json
{ "error": { "code": "invalid_scope", "message": "…" } }
```

| Status | Code | When |
|--------|------|------|
| 400 | `invalid_request` | Malformed body / missing or invalid fields |
| 400 | `invalid_scope` | Missing scope, or a scope that breaks the visibility invariants |
| 400 | `invalid_team_scope` | A present `X-AI-Team-Id` does not contain exactly one team UUID |
| 401 | `unauthorized` | Missing, invalid, revoked, or expired bearer token |
| 403 | `forbidden` | The bearer session is valid but its membership is suspended, or the authenticated principal lacks the required team role or authority |
| 403 | `credential_team_mismatch` | A legacy or dev credential tried to select a different team |
| 403 | `access_revoked` | The caller previously had a client grant, but that grant was revoked |
| 404 | `not_found` | Unknown route/client, a client never granted to the caller, or insufficient client access |
| 405 | `method_not_allowed` | Wrong HTTP method |
| 413 | `payload_too_large` | Body over 5 MB |
| 500 | `internal` | Unexpected server failure (logged server-side) |

### GET `/v1/health` (no auth)

```json
{ "ok": true, "backend": "postgres", "embedder": { "mode": "client-provided", "model": "bge-m3", "dim": 1024, "serverModeEnabled": false } }
```

Use it as the Railway healthcheck.

### POST `/v1/auth/login` (no auth)

Signs in with server URL, email, password, and optional team slug/id. The API
uses Better Auth for password verification and returns a user-scoped Better Auth
session token for Command Centre or the terminal.

```json
{
  "email": "owner@example.test",
  "password": "owner-pass-123",
  "team": "local-demo",
  "authSource": "cli-device-token"
}
```

Response:

```json
{
  "token": "team_...",
  "expiresAt": "2026-07-01T12:00:00.000Z",
  "user": { "email": "owner@example.test" },
  "team": { "slug": "local-demo", "name": "Local Demo Team" },
  "membership": { "role": "owner", "status": "active" },
  "server": { "id": "stable-server-uuid" },
  "defaultTeamId": "team-uuid"
}
```

The old `team` and `membership` fields remain during the compatibility period.
The session identifies the user; it is not permanently limited to
`defaultTeamId`.

The terminal wraps this as:

```bash
npm run team -- login --api-url http://localhost:8787 --email owner@example.test --password owner-pass-123
```

### POST `/v1/auth/join` (no auth)

Accepts an invite token for a specific email and can set the user's initial
password in the same request.

```json
{
  "team": "local-demo",
  "email": "member@example.test",
  "token": "invite-token",
  "password": "member-pass-123"
}
```

### POST `/v1/auth/logout`

Revokes the current Better Auth session token. The terminal and Command Centre
also remove the saved local context file. Older `aios_` Team API tokens are
still revoked through the legacy fallback table. A valid session whose team
membership was suspended may call this route even though every other protected
route returns `403 forbidden`; this lets the blocked user sign out cleanly.

### GET `/v1/auth/teams`

Returns the stable server identity, authenticated user, and every active team
membership. This user-scoped route does not require a team header and still
returns `teams: []` when the login is valid but no active membership remains.

### Request-specific team scope

Every `/v1/team/*`, `/v1/memory/*`, `/v1/context/*`, `/v1/workspace/*`, and
`/v1/user/config-file` request selects its team with:

```http
X-AI-Team-Id: <team-uuid>
```

The server reloads the membership on every request. Command Centre and the
terminal store `serverId`, the available teams, and `selectedTeamId` in version
3 of `team-context.json`. A caller may override the team for one request without
changing that saved default, so concurrent agents can safely use different
teams.

Older Better Auth sessions and user-owned API keys may temporarily omit the
header and use their saved team. This fallback is logged and never updates the
session. Legacy `aios_` tokens and the configured dev token remain locked to
their original team.

### Better Auth API keys

Better Auth API keys are accepted as bearer credentials when they use the
AI-OS `aos_` prefix. The Team API verifies the key with Better Auth, then
maps the Better Auth user email to the AI-OS membership and grants. API-key
permissions still cannot exceed the user's Team OS grants.

### GET `/v1/team/whoami`

Returns the server-resolved user, request-selected team and role, stable server
identity, and `teamScopeSource` for the bearer token.

```bash
npm run team -- login --api-url http://localhost:8787 --email owner@example.test --password owner-pass-123
npm run team -- whoami
```

### GET `/v1/team/clients`

Returns only the clients with an active backend grant for the resolved user.

```bash
npm run team -- clients
```

### GET `/v1/team/admin`

Owner/admin route used by Team Settings and the Team page. Returns members,
clients, client grants, skill grants, and recent audit events for the resolved
team. Non-admin members receive `403`.

### POST `/v1/team/admin`

Owner/admin route for team management actions. Supported actions:

| Action | Purpose |
|--------|---------|
| `invite-member` | Create a single-use invite token for one email. |
| `create-client` | Create a team client. |
| `grant-client` / `revoke-client` | Manage client read/write grants. |
| `grant-skill` / `revoke-skill` | Manage skill permissions. |
| `set-member-role` / `set-member-status` | Manage membership role/status. |

### Team secrets

TeamOS shared secrets use Better Auth only for identity and team membership.
The secret values are stored by TeamOS, encrypted with `TEAM_OS_SECRETS_KEYS`,
and delivered to local machines through managed `.env` blocks.

| Route | Access | Purpose |
|-------|--------|---------|
| `GET /v1/team/secrets` | Signed-in team member | Lists only metadata for secrets the user may sync. Values are never returned. |
| `POST /v1/team/secrets` | Owner/admin | Supports `create-secret`, `update-secret`, `grant-secret`, `revoke-secret`, and `archive-secret`. |
| `POST /v1/team/secrets/sync` | Signed-in team member | Returns values only for secrets the resolved user can use. Client secrets also require client access. |

The local Command Centre route writes sync results only inside:

```env
# BEGIN TEAMOS MANAGED SECRETS
KEY=value
# END TEAMOS MANAGED SECRETS
```

If a matching key already exists outside the managed block, sync returns a
conflict and leaves the file unchanged until the user confirms overwrite. Audit
events record counts, actors, and targets, but never secret values.

### Private encrypted config files

`.mcp.json` is backed up as a private per-user encrypted config file. It is not
context and is never included in snapshots, memory indexing, previews, or logs.

| Route | Access | Purpose |
|-------|--------|---------|
| `GET /v1/user/config-file?path=.mcp.json` | Signed-in team member | Restores the current user's encrypted `.mcp.json` backup. |
| `PUT /v1/user/config-file` | Signed-in team member | Saves `.mcp.json` with `path`, `content`, and `expectedSha256` when updating an existing backup. |

If `TEAM_OS_SECRETS_KEYS` or `TEAM_OS_SECRETS_ACTIVE_KEY_ID` is missing on the
server, this route returns `secret_crypto_unavailable`; local `.mcp.json` usage
continues, but remote backup is skipped.

### Admin Setup Commands

Use these from `command-centre/` to prepare local or hosted test data. They write
to local PGLite by default, or to hosted Postgres when `MEMORY_DATABASE_URL` is
set.

These are admin/server setup helpers. For normal hosted usage, an owner/admin
invites a user from the Team OS flow, the user follows the hosted invite/reset
page, and then signs in with `npm run team -- login`. Do not ask normal members
to run `npm run team:join` from a local clone; without `MEMORY_DATABASE_URL`, it
will look in that clone's local PGLite store.

```bash
npm run team:create -- --slug demo --name "Demo Team" --owner-email owner@example.com --owner-password "owner-pass-123"
npm run team:invite -- --team demo --email member@example.com --by owner@example.com
npm run team:join -- --team demo --email member@example.com --token <invite-token> --password "member-pass-123"
npm run team:members -- --team demo

npm run team:client -- create --team demo --slug acme --name "Acme" --by owner@example.com
npm run team:client -- grant --team demo --client acme --user member@example.com --access read --by owner@example.com
npm run team:client -- grants --team demo
npm run team:client -- revoke --team demo --client acme --user member@example.com --by owner@example.com
```

`team:client create` records `client.created`. Grant and revoke use the
Team OS grant flow and record the existing `grant.granted` / `grant.revoked`
audit events.

### Manual Shared Content Import Commands

After `npm run team -- login --api-url <url> --email <email> --password <password>`,
an admin or owner can publish shared team/client content through the hosted API:

```bash
npm run team -- memory import --file ./shared.md --visibility team
npm run team -- memory import --file ./acme.md --visibility client --client acme
npm run team -- memory imports --status failed
npm run team -- memory retry --id <import-id>
```

Manual imports create a durable `manual_imports` row before indexing. Successful
imports still go through the normal `memory_sources`, `memory_chunks`, and
`index_jobs` pipeline. Failed imports keep the original content, source path,
scope, error message, and attempt count so an admin can inspect and retry them.

### GET `/v1/workspace/manifest`

Returns a file manifest for granted client workspaces only. Without `client`,
the response includes every client the resolved user can access. With `client`,
the server first checks that client grant. Client-specific manifest, read,
write, and delete requests return `403 access_revoked` when the caller's grant
existed and was revoked. Unknown clients, never-granted clients, and active
grants without the required permission return `404 not_found` so those cases do
not reveal additional client or file information.

```bash
npm run team -- sync manifest
npm run team -- sync manifest --client acme
```

The manifest only includes text AI-OS files under `clients/{slug}/...`.
Secrets such as `.env`, `.mcp.json`, generated stores, backups, transcripts,
and build folders are not exposed.

### GET `/v1/workspace/file`

Reads one granted client file. A `read` or `write` client grant is enough.
Unknown clients and clients the user was never granted return `404`. A grant
that existed and was revoked returns `403 access_revoked` instead — this lets
the caller tell "access was taken away" apart from "this client doesn't
exist," without leaking existence for a client that truly has no grant
history. Successful file reads write a `sync.pull` audit event.

```bash
npm run team -- sync pull --client acme --dest ./team-os-local
```

That creates a local folder such as:

```text
team-os-local/
└── clients/
    └── acme/
        └── ...
```

### PUT `/v1/workspace/file`

Writes one granted client file. This requires a `write` client grant. The server
only writes under `clients/{slug}/...` and rejects path traversal.
Successful writes create `sync.push` audit events. Missing grants create
`sync.denied` events. Version conflicts create `sync.conflict` events and return
`409`.

```bash
npm run team -- sync push --client acme --src ./team-os-local
```

`--src` may point either at a folder containing `clients/acme` or directly at
the local `acme` folder.

`sync pull` stores the remote SHA in
`./team-os-local/.AI-OS/team-sync-state.json`. `sync push` sends that SHA as
the expected base version for existing files, so a remote change cannot be
silently overwritten. For existing files, pull before pushing.

### GET `/v1/memory/status`

Returns scoped store health, index job state, and source lifecycle state for the
resolved team. The Command Centre Team view uses this endpoint.

Important fields:

```json
{
  "sourcesByStatus": { "indexed": 12, "failed": 1 },
  "failedSources": [
    {
      "id": "…",
      "sourcePath": "manual/acme-onboarding.md",
      "visibility": "client",
      "clientId": "acme",
      "errorMessage": "…"
    }
  ],
  "jobsByStatus": { "succeeded": 20, "failed": 1 }
}
```

Failed manual imports can be retried with `POST /v1/memory/imports/retry`.

### Ingestion audit events

In Team OS mode, admin shared-content actions write `audit_events` rows that can
be queried by team and by source/import target:

| Action | Target | When |
|--------|--------|------|
| `memory.imported` | `manual_import` | Manual import request accepted and persisted |
| `memory.published` | `memory_source` | Imported content indexed as shared team/client memory |
| `memory.failed` | `manual_import` | Indexing failed, with error metadata |
| `memory.retry` | `manual_import` | Admin requested retry of a failed import |
| `memory.reindexed` | `memory_source` | Retry successfully re-indexed the source |

Each event includes actor, team, source path, scope, and relevant import/source
metadata.

### POST `/v1/memory/search`

Runs hybrid search (scope-filtered vector search plus scoped keyword search),
reranks (authority + recency), and records a `search_events` audit row.
Audit is mandatory on the hosted API — unlike the local CLI, there is no
`--no-events` equivalent. By default the audit row stores **neither** the query
text nor its embedding; `storeQueryText: true` opts the text in.

Default API mode: the client sends a BGE-M3 query embedding. The AI-OS CLI
uses `--embedding-mode auto` by default: it checks `/v1/health` and sends
`embeddingMode: "server"` when `serverModeEnabled` is true, otherwise it falls
back to this client-provided vector payload.

Request:

```json
{
  "query": "release process",
  "queryEmbedding": [0.0123, 0.0456],
  "embeddingModel": "bge-m3",
  "embeddingDim": 1024,
  "scope": { "teamId": "team-42", "clientId": null, "userId": null },
  "topK": 10,
  "storeQueryText": false
}
```

- `queryEmbedding`, `embeddingModel: "bge-m3"`, and `embeddingDim: 1024` are
  required. The client is responsible for producing the BGE-M3 vector.
- `scope` is **required**. Same semantics as the CLI's scope flags: identity
  fields set who is asking; the searched visibility layers derive from them
  with `system` always present (`teamId` adds `team`, `clientId` adds `client`,
  `userId` adds `private`). Pass `include` (e.g. `["system","team"]`) to pin
  the layers explicitly. `{ "scope": {} }` = system-baseline search. A request
  without `scope` is a 400, never an implicit search-everything.
- When the server has an identity store and principal, request body `teamId`,
  `clientId`, and `userId` cannot widen access. Search uses the server-resolved
  team/user. Client search requires active read or write access. A revoked
  client grant returns `403 access_revoked`; an unknown or never-granted client
  returns `404 not_found`.
- `topK`: 1–100, default 10.

Server-side embedding mode: set `MEMORY_API_SERVER_EMBEDDINGS=1` on the API
server, then lightweight consumers can send only the query text:

```json
{
  "query": "release process",
  "embeddingMode": "server",
  "scope": { "teamId": "team-42", "clientId": null, "userId": null },
  "topK": 10,
  "storeQueryText": false
}
```

The server still applies the same scope and permission checks. If server-side
embeddings are disabled, this request returns `server_embedding_disabled`; send
`queryEmbedding` instead or enable the server flag. When the flag is enabled,
the server verifies the model during startup before `/v1/health` is available.

CLI override:

```bash
npm run memory:recall -- "release process" --embedding-mode server # require server-side query embedding
npm run memory:recall -- "release process" --embedding-mode client # force client-provided queryEmbedding
```

Response:

```json
{
  "results": [
    {
      "chunkId": "…", "sourceId": "…",
      "sourcePath": "context/memory/2026-06-10.md",
      "sourceType": "memory", "contentDate": "2026-06-10",
      "heading": "Release", "content": "…",
      "score": 0.83, "distance": 0.17, "finalScore": 0.91, "reranked": true
    }
  ],
  "visibilitySet": ["system", "team"],
  "latencyMs": 12,
  "eventId": "…"
}
```

`results` carries everything a caller needs for citations (path, type, date,
heading); `eventId` is the audit row for traceability.

### POST `/v1/memory/ingest`

Upserts one source from chunks and BGE-M3 embeddings produced by the client.
The server validates scope/model/dimensions and stores the vectors; it does not
chunk or embed content itself. Idempotent: re-sending identical content is a
no-op.

Request:

```json
{
  "scope": { "teamId": "team-42", "clientId": null, "userId": null, "visibility": "team" },
  "sourcePath": "context/memory/2026-06-10.md",
  "sourceType": "memory",
  "title": "Daily log",
  "contentDate": "2026-06-10",
  "authorityWeight": 1.0,
  "content": "# Daily\n\n…markdown…",
  "contentSha256": "64-char-sha256-hex",
  "byteSize": 19,
  "embeddingModel": "bge-m3",
  "embeddingDim": 1024,
  "chunks": [
    {
      "index": 0,
      "content": "…chunk text…",
      "heading": "Daily",
      "headingLevel": 1,
      "startLine": 3,
      "endLine": 3,
      "contentHash": "64-char-sha256-hex",
      "tokenCount": 8,
      "embedding": [0.0123, 0.0456]
    }
  ],
  "force": false,
  "reason": "manual"
}
```

- `scope` (with `visibility`), `sourcePath`, `embeddingModel`, `embeddingDim`,
  and `chunks` with embeddings are required. `content` is recommended so the
  server can verify `contentSha256`; otherwise send `contentSha256` and
  `byteSize`. The scope is validated against the same invariants the database enforces
  (`private` needs `userId`, `client` needs `clientId`, `team` needs `teamId`).
- When the server has an identity store and principal, ingest uses the
  server-resolved team/user. Private ingest writes to the resolved user. Client
  ingest requires active write access. Shared `team` or `system` ingest requires
  an admin or owner. A revoked client grant returns `403 access_revoked`;
  unknown, never-granted, or read-only client access returns `404 not_found`.
- `sourceType`: `memory | learnings | brand | transcript | session | other`
  (default `other`). `contentDate`: `YYYY-MM-DD`. `reason`: an `index_jobs`
  reason tag (default `manual`).
- `force: true` re-indexes even when the content hash is unchanged. The client
  still sends the embeddings.

Response:

```json
{ "sourceId": "…", "skipped": false, "chunksInserted": 3, "chunksPruned": 0 }
```

### POST `/v1/memory/captures`

Normal Stop-hook path for TeamOS. This stores a raw capture event for later
consolidation; it does **not** write `memory_sources` or make the text visible to
recall. Active team members can stage team captures. Client captures require
write access to that client. Revoked client access returns `403 access_revoked`;
unknown, never-granted, or read-only client access returns `404 not_found`. The
server records the authenticated user as `actor_user_id`.

```json
{
  "scope": { "teamId": "server-resolved", "clientId": null, "userId": null, "visibility": "team" },
  "sessionId": "session-123",
  "sourceHash": "64-char-sha256-hex",
  "sourcePath": "context/memory/2026-06-30.aos.md#session-123",
  "sourceType": "session",
  "content": "summarized raw capture block",
  "contentSha256": "64-char-sha256-hex",
  "byteSize": 1234,
  "metadata": { "reason": "session_capture" }
}
```

Response:

```json
{ "capture": { "id": "…", "status": "pending", "syncStatus": "synced" } }
```

### POST `/v1/memory/consolidation/claim`

Claims a small eligible batch of pending captures for client-side
consolidation. A capture is eligible after 20 minutes without new activity in
the session, or when enough pending captures exist. Non-admin users only claim
their own raw captures; admins/owners can claim broader batches.

```json
{
  "scope": { "visibility": "team" },
  "limit": 12
}
```

Response includes a batch id, claim token, and the raw capture contents needed
by the consolidating client.

### POST `/v1/memory/consolidation/complete`

Completes a claimed batch. The consolidating client should first use an LLM
(`memory-consolidate` uses Claude Haiku by default) to extract durable memory
items from the raw captures. Embeddings are generated only for items with
`disposition: "publish"`.

Items with `disposition: "publish"` must include the same prepared
chunk/embedding payload as `/v1/memory/ingest`; they become final `team` or
`client` memory and receive provenance links back to the source captures. Items
with `disposition: "review"` or `disposition: "discard"` stay out of recall.

```json
{
  "batchId": "…",
  "claimToken": "…",
  "items": [
    {
      "disposition": "publish",
      "captureIds": ["…"],
      "scope": { "visibility": "team" },
      "sourcePath": "consolidated/team/preference.md",
      "content": "# Preference\n\n…",
      "contentSha256": "64-char-sha256-hex",
      "byteSize": 20,
      "embeddingModel": "bge-m3",
      "embeddingDim": 1024,
      "chunks": []
    }
  ]
}
```

`discard` is used when a capture has no durable memory value:

```json
{
  "batchId": "…",
  "claimToken": "…",
  "items": [
    {
      "disposition": "discard",
      "captureIds": ["…"],
      "discardReason": "no_durable_memory"
    }
  ]
}
```

Raw processed capture content is redacted after 30 days. Minimal provenance
remains in `memory_source_provenance` so final memories can show where they came
from without exposing raw turn text by default.

### POST `/v1/memory/imports`

Admin-facing manual publish/import for shared content. The request shape is
intentionally close to `/v1/memory/ingest`, but it first records a durable
import row so failures can be listed and retried.

Manual import is also the first implementation of the connector boundary. A
connector fetches or receives external content, then hands the memory API a
normalized content item: `scope`, stable `sourcePath`, `sourceType`, optional
title/date/weight, raw markdown/text `content`, client-provided chunks with
embeddings, and connector metadata. The core memory store remains
connector-agnostic; Google Drive, Notion, GitHub, and later tools should adapt
into this shape instead of adding service-specific storage logic.

```json
{
  "scope": { "teamId": "server-resolved", "clientId": "acme", "userId": null, "visibility": "client" },
  "sourcePath": "manual/acme-onboarding.md",
  "sourceType": "other",
  "title": "Acme onboarding notes",
  "connector": { "id": "manual", "itemId": "acme-onboarding.md" },
  "content": "# Acme\n\n…markdown…",
  "contentSha256": "64-char-sha256-hex",
  "byteSize": 20,
  "embeddingModel": "bge-m3",
  "embeddingDim": 1024,
  "chunks": [{ "index": 0, "content": "…", "startLine": 1, "endLine": 1, "contentHash": "64-char-sha256-hex", "tokenCount": 1, "embedding": [0.0123, 0.0456] }],
  "force": false
}
```

- `connector` is optional for manual imports and defaults to `{ "id": "manual" }`.
  Future adapters can send ids such as `google_drive`, `notion`, `github`, or a
  new safe lowercase connector id. If `sourcePath` is omitted, connector items
  are assigned a stable path under `connectors/{id}/...`.
- Requires admin or owner when the server has Team OS identity enabled.
- Publishes only shared `team` or `client` memory. Private memory still uses the
  normal private ingest/capture path, not this admin publish route.
- Client imports require an existing active client. Search visibility is still
  controlled by client grants; importing content does not grant access by itself.
- Non-admin attempts write an `access.denied_ingest` audit event.

Response:

```json
{
  "import": { "id": "…", "status": "indexed", "sourcePath": "manual/acme-onboarding.md" },
  "sourceId": "…",
  "skipped": false,
  "chunksInserted": 2,
  "chunksPruned": 0
}
```

If indexing fails, the API returns `500` with `error.code = "import_failed"` and
the failed import row, including `errorMessage`.

### GET `/v1/memory/imports`

Lists recent manual imports for the resolved team. Admin or owner only.

```bash
curl -H "Authorization: Bearer $MEMORY_API_TOKEN" \
  "https://<domain>/v1/memory/imports?status=failed&limit=20"
```

Response:

```json
{
  "imports": [
    {
      "id": "…",
      "status": "failed",
      "attempts": 1,
      "sourcePath": "manual/acme-onboarding.md",
      "errorMessage": "…"
    }
  ]
}
```

### POST `/v1/memory/imports/retry`

Retries a manual import using the stored content, scope, and client-provided
embedding payload saved with the import. Retries default to `force: true` so a
partial failed source is re-indexed instead of being skipped.

```json
{ "importId": "…", "force": true }
```

---

## Consuming the API

- **AI-OS CLI auto mode** — `npm run memory:recall` and Stop-hook capture
  use the hosted API automatically when a valid Team OS login is saved. Recall
  calls search; Stop-hook capture calls staging. Use `--local` or
  `TEAM_OS_MEMORY_MODE=local` only for offline PGLite work.
- **Search from anywhere** — direct callers can compute BGE-M3/1024 locally and
  send `queryEmbedding`, or send `embeddingMode: "server"` when the API has
  `MEMORY_API_SERVER_EMBEDDINGS=1`. The AI-OS CLI chooses automatically in
  Team OS mode, with `--embedding-mode server|client` available when you need to
  force one path.
- **Scope is server-resolved in Team OS mode.** Clients should still send the
  narrowest scope they want, but the backend uses its resolved principal as the
  final authority. Body identity fields cannot grant broader access.
- **Ingest from agents/services** — curated/final memory can POST chunks plus
  embeddings to `/v1/memory/ingest`. Normal session capture should use
  `/v1/memory/captures` first, then consolidation publishes only durable items.
- **Hosted capture is staged by default.** Root TeamOS sessions stage team
  captures; `clients/{slug}` sessions stage client captures. Local solo capture
  defaults to private local memory. Shared system capture requires an explicit
  admin/service path.
- Re-indexing existing local memory into hosted Postgres can target this
  endpoint or go direct-to-DB with `MEMORY_DATABASE_URL`.

### Embedder consistency (important)

Vectors from different embedders live in different spaces — searching with one
against chunks embedded with another silently returns garbage. The hosted API
therefore accepts only client-provided `bge-m3` vectors with 1024 dimensions.
If an older database was built with hash or a 384-dim model, clear/rebuild the
memory tables and reindex with current AI-OS clients before serving recall.

## Security notes

- The server is **fail-closed**: it refuses to start without `MEMORY_API_TOKEN`,
  and shared-token comparison is constant-time. That token is for internal dev
  and smoke tests only.
- `/v1/health` is unauthenticated by design (healthchecks) and exposes no data.
- Keep Postgres off the public internet; only the API needs to reach it.
- Normal users authenticate with Better Auth email/password and receive a
  scoped Better Auth session token. Passwords are not written to `.env`,
  `team-context.json`, or the repository.
- When `MEMORY_API_TEAM_ID` and `MEMORY_API_USER_ID` are configured, the API
  resolves a backend principal and checks team membership plus client grants on
  every memory request.
- Rotate the token by updating the service variable and redeploying; hand the
  new value only to developers who need the dev fallback.

## Related

- Database provisioning: [`hosted-postgres-setup.md`](hosted-postgres-setup.md)
- Schema & scope model: [`memory-schema.md`](memory-schema.md)
- Backend selection (PGLite ↔ Postgres): [`hosted-postgres-setup.md`](hosted-postgres-setup.md#backend-selection)
- Re-index existing memory into hosted Postgres: [`hosted-postgres-setup.md`](hosted-postgres-setup.md#seed-the-store-with-existing-memory)
- Backup & restore: [`backup-restore.md`](backup-restore.md)
- Permissions / per-user grants: implemented for hosted memory and skill access foundation
