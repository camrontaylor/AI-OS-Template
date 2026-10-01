# Team OS chat memory testing

This guide prepares four local AI-OS instances and tests memory through the
real user flow: Command Centre chat with Claude, followed by Stop hook capture
and recall from another chat.

The shared memory store must be Postgres with pgvector. PGLite is useful for one
local instance, but it does not give a realistic multi-user shared store for
these chat tests.

Prerequisites:

- Claude Code/Claude CLI available and signed in locally.
- Docker available, or an existing Postgres with pgvector reachable through
  `MEMORY_DATABASE_URL`.
- Command Centre dependencies already installed in the repo root setup. The test
  instances install their own `command-centre/node_modules` by default.

## Quick setup

From the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\team-os-chat-memory-test.ps1 -StartApi
```

## Coolify setup

Use this when the Team OS chat memory test stack is running in Coolify. The
stack should be a single Docker Compose app with two containers: `postgres` and
`memory-api`. The local Command Centres talk only to the hosted API; the
Postgres database stays private inside Coolify and is not accessed directly
from the local machine.

On this Coolify server, use the service's generated `sslip.io` domain. The
compose labels route that host directly to the private API container port
`8787`:

```text
http://c11hje24xv848po75itttwej.168.75.81.193.sslip.io
```

Do not use the Coolify dashboard domain as the API URL for these tests.

The compose app expects `MEMORY_API_IMAGE` to point at the memory API image
available on the Coolify server. This avoids rebuilding the API image when the
test only changes compose wiring.

The Coolify stack bootstraps the matching teams, users, clients, and grants on
startup through:

```bash
npm run team:test-bootstrap -- --run-id "$TEAM_OS_TEST_RUN_ID"
```

Set the same run id locally before creating the local instances:

```powershell
$env:TEAM_OS_CHAT_TEST_API_URL="http://c11hje24xv848po75itttwej.168.75.81.193.sslip.io"
$env:TEAM_OS_TEST_RUN_ID="<same-run-id-used-in-coolify>"

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\team-os-chat-memory-coolify-test.ps1
```

The wrapper calls the main setup script with `-SkipDocker`,
`-HostedApiCapture`, `-SkipMigrate`, and `-SkipBootstrap`. It does not start a
local Team API because the API is already running in Coolify.

Do not commit database credentials or machine-specific service URLs. Pass the
public API URL as a temporary PowerShell environment variable.

If Docker is not installed, use an existing Postgres with pgvector:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\team-os-chat-memory-test.ps1 `
  -SkipDocker `
  -MemoryDatabaseUrl "postgres://postgres:postgres@localhost:5432/ai_memory" `
  -StartApi
```

The script creates one run folder:

```text
.instances/team-os-test/<RUN_ID>/
├── owner-team-a/
├── admin-team-a/
├── member-team-a/
├── admin-team-b/
├── manifest.json
├── test-prompts.md
├── start-team-api.ps1
├── login-all.ps1
└── diagnose-memory-token.ps1
```

The instance folders contain real private context files per user. The
`command-centre` source and dependencies are installed per instance so each dev
server has its own build cache and a real local `node_modules` folder. This
avoids Turbopack failures caused by `node_modules` junctions that point outside
the instance root. Shared folders such as `.claude`, `scripts`, and `docs` are
still reused by junction because they are not part of the Next.js dependency
tree.

By default the setup runs `npm ci` in each instance. For troubleshooting only,
the script also accepts `-DependencyMode copy` and `-DependencyMode junction`.
Use `junction` only if you are not starting the Command Centre UI with
Turbopack.

## What the script creates

- Team A: owner, admin, member.
- Team B: admin, plus a bootstrap owner used only to create Team B.
- Team A client: `acme-a-<RUN_ID>`.
- Team B client: `acme-b-<RUN_ID>`.
- Member A has `write` access to Team A client so client memory can be created
  through chat.
- Four Command Centre ports:
  - owner A: `3101`
  - admin A: `3102`
  - member A: `3103`
  - admin B: `3104`

The script writes all exact prompts into:

```text
.instances/team-os-test/<RUN_ID>/test-prompts.md
```

Use that file as the checklist while running the manual chat tests.

## Running Command Centre instances

Open separate terminals and run the launch script for the current test mode.
Examples:

```powershell
cd ".instances\team-os-test\<RUN_ID>"
.\start-member-team-a-private.ps1
.\start-admin-team-a-team.ps1
.\start-admin-team-a-system.ps1
.\start-member-team-a-client-a.ps1
.\start-admin-team-b-private.ps1
```

Use one mode at a time per user. For example, stop admin A private mode before
starting admin A team mode.

The default capture visibility while signed in to Team OS is `team` (staged
for consolidation/review) — private mode only applies when the launch script
explicitly sets `MEMORY_CAPTURE_VISIBILITY=private`, which is what the
`*-private.ps1` scripts do. A private-mode capture never enters team staging
or the admin review queue; it ingests directly and is recallable only by the
user who created it.

## Memory test rule

For every memory test:

1. Create the token by sending the provided prompt to Claude in Command Centre.
2. Ask Claude to repeat the token exactly.
3. Wait for the chat/task to finish.
4. Wait 10 to 30 seconds for the Stop hook to capture and index the turn.
5. Open a new chat as the recall user.
6. Ask the recall prompt from `test-prompts.md`.
7. Use direct API search only as diagnosis, not as the main pass/fail result.

## Context tests

After all users are logged in and the Team API is running, prepare context
fixtures:

```powershell
cd ".instances\team-os-test\<RUN_ID>"
.\prepare-context-fixtures.ps1
```

Then use the prompts in `test-prompts.md` for:

- Team context: member A sees Team A context, admin B does not.
- Private context: each user sees only their own private token.
- Client context: granted users see Team A client context; revoked member A does
  not see it on the next chat/request.

To revoke member A access to the Team A client:

```powershell
cd ".instances\team-os-test\<RUN_ID>"
.\revoke-member-a-client-a.ps1
```

## Diagnostics

If chat does not find a token, first search the Team API with the same user's
saved login:

```powershell
cd ".instances\team-os-test\<RUN_ID>"
.\diagnose-memory-token.ps1 -UserKey member-team-a -Query "PRIVATE_MEMBER_A_<RUN_ID>" -Include "private,team,client,system"
```

Interpretation:

- API finds it, chat does not: investigate the Command Centre recall path.
- API does not find it: investigate Stop hook capture, scope, permission, or
  indexing.
- Also inspect the creator instance under
  `context/memory/YYYY-MM-DD.aos.md` to confirm the Stop hook captured the chat.

## Acceptance checklist

- Private memory created by chat appears only for the same user.
- Team memory created by an admin appears for another user in the same team.
- Team memory does not appear for another team.
- System memory does not cross teams.
- Client memory appears only for users with client access.
- Revoking client access removes recall and client context on the next request.
- Team context syncs between members of the same team.
- Private context does not leak between users.
- Client context follows client access.
