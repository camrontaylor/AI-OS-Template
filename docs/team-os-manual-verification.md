# Team OS Manual Verification

Use this runbook to verify Team OS from a terminal and the Command Centre UI.
It covers hosted and local smoke tests, multi-Team navigation, sequential users,
access changes, profile recovery, and Solo compatibility.

For the normal user workflow, read the
[Team OS user guide](team-os-user-guide.md). For focused multi-user memory
testing, use
[Team OS chat memory testing](team-os-chat-memory-testing.md).

The examples use PowerShell. The **npm run** commands work on macOS, Linux, and
Windows; replace PowerShell environment assignments with the equivalent for
your shell.

## Test Prerequisites

Run repository commands from **command-centre**:

~~~powershell
cd command-centre
~~~

Prepare test-only accounts and data:

- a Team OS server URL stored as **TEAM_OS_API_URL**;
- user A with active membership in Team A and Team B;
- user B with at least one active Team membership;
- one client grant for each Team and one grant that can be revoked;
- owner/admin access for membership and grant changes;
- a private, disposable profile configuration directory; and
- a separate Solo chat or task created while signed out.

Use placeholder accounts and passwords. Never commit a real URL, password,
session token, local profile key, or private machine path.

## Hosted Server Smoke Test

Set the hosted URL outside the repository:

~~~powershell
$env:TEAM_OS_API_URL="<TEAM_OS_API_URL>"
$env:AI_OS_TEAM_CONFIG_DIR="$env:TEMP\aios-hosted-test-profile"

Invoke-RestMethod -Uri "$env:TEAM_OS_API_URL/v1/health" -Method Get
npm run team -- login --api-url $env:TEAM_OS_API_URL --email <EMAIL> --password "<PASSWORD>"
npm run team -- status
npm run team -- whoami
npm run team -- clients
npm run team -- logout
~~~

Expected:

- the health endpoint reports a healthy server;
- **whoami** returns the server-resolved account and selected Team;
- **clients** returns only currently granted clients; and
- logout removes the active saved login without deleting durable profile
  history.

The **login-dev** token path is for an isolated development server only. It is
not a normal user login and must not be used as production evidence.

## Optional Local Server Fixture

Use this section when a hosted test environment is unavailable. Keep the test
store outside the repository.

~~~powershell
$env:AI_OS_DIR="$env:TEMP\aios-team-manual"
$env:MEMORY_STORE_BACKEND="pglite"
$env:MEMORY_EMBEDDER="bge-m3"

npm run team:create -- --slug team-a --name "Team A" --owner-email owner@example.test --owner-name "Owner" --owner-password "owner-pass-123"
npm run team:create -- --slug team-b --name "Team B" --owner-email owner@example.test --owner-name "Owner" --owner-password "owner-pass-123"
~~~

Create invites, join the test users, then create clients and grants with the
repository's Team admin commands:

~~~powershell
npm run team:invite -- --team team-a --email user-a@example.test --by owner@example.test
npm run team:join -- --team team-a --email user-a@example.test --token <INVITE_TOKEN> --password "user-a-pass-123"
npm run team:client -- create --team team-a --slug client-a --name "Client A" --by owner@example.test
npm run team:client -- grant --team team-a --client client-a --user user-a@example.test --access read --by owner@example.test
npm run team:skill -- grant --team team-a --skill <SKILL_NAME> --user user-a@example.test --permission skill.use --by owner@example.test
~~~

Repeat the invite and grant setup for Team B and user B as needed. Start the
local API in a separate terminal:

~~~powershell
$env:MEMORY_API_TOKEN="<DEV_FALLBACK_TOKEN>"
$env:MEMORY_API_PORT="8787"
$env:MEMORY_API_TEAM_SLUG="team-a"
$env:MEMORY_API_USER_EMAIL="owner@example.test"
npm run memory:api
~~~

Use **http://127.0.0.1:8787** as **TEAM_OS_API_URL** for the local fixture.
Only one process can hold the local PGLite store at a time, so stop the API
before running direct admin commands. Hosted Postgres does not have this local
locking limitation.

## Command Centre Setup

Use a disposable configuration directory so the test cannot replace a normal
profile:

~~~powershell
$env:AI_OS_TEAM_CONFIG_DIR="$env:TEMP\aios-multi-team-ui"
npm run dev
~~~

Open the local URL shown by Command Centre. The terminal and UI share the same
Team OS login when this configuration directory matches.

## Multi-Team and Sequential-User Journeys

Record pass/fail evidence for every journey. Do not copy tokens, private paths,
or user data into the report.

### M-01 — First login with multiple Teams

1. Confirm the top-right Team control shows **Disconnected**.
2. Select **Sign in** and enter user A's server URL, email, password, and
   optional Team slug.
3. Confirm the control shows **Connected**.
4. Open the Team control and confirm **Switch team** lists Team A and Team B.
5. Check **Dashboard**, **Members**, **Clients**, **Memories**, **Secrets**, and
   **Skills** for the selected Team and role.

Expected: the server resolves the user and Team memberships. Only granted
clients, Team-provided skills, secrets, and actions are available. The local
installation skill pack remains available independently. **Members** and
**Memories** management remains limited to owner/admin roles.

### M-01A — Local and Team skill origins

1. Use the same skill name in the installation, Team A, and Team B, with a
   visibly different test instruction in each copy.
2. Open one Team A chat and one Team B chat at the same time.
3. In each chat, run `/skill-name`, `/team:skill-name`, and
   `/local:skill-name`.
4. Remove the Team grant, reconnect, and answer once more in the existing chat.

Expected: the default and `/team:` commands use only the matching Team copy;
`/local:` uses the installation copy; neither Team leaks into the other; after
reconnection the revoked Team copy disappears while the local skill remains.

### M-02 — Team A to Team B and new work

1. Select Team A and create a chat or task.
2. Start an agent or terminal attached to that work if the test environment
   permits it.
3. Use **Switch team** to select Team B.
4. Create another chat or task.

Expected: the dashboard and client choices change to Team B. New work uses Team
B, while the Team A work, agent, and terminal keep Team A and their original
client.

### M-03 — Open old work without changing its scope

1. Keep Team B selected.
2. Open Feed and use **Search chats**, **All Teams**, and **All clients** to find
   the Team A chat.
3. Open and continue the Team A chat.
4. Return to the dashboard.

Expected: the old chat remains Team A and uses only Team A permissions and
context. Team B stays selected as the default for other new work. A Team badge
identifies the different scope when needed.

### M-04 — Access revocation and outage

1. While user A is active, revoke one client grant or suspend the selected Team
   membership from the owner/admin test account.
2. Repeat a protected request and refresh Command Centre.
3. Restore access, then stop or isolate the test server and refresh again.

Expected:

- revoked or suspended access shows **Access blocked** and protected data is not
  returned;
- a valid saved login during a network or server outage shows **Unavailable**;
- the client list does not fall back to local folders; and
- neither state silently uses Solo or another Team's context.

### M-05 — User A to user B

1. Restore the test server and user A's access.
2. Open the Team control and select **Sign out**.
3. Wait for **Disconnected** or the secure-cleanup refresh instruction.
4. Sign in as user B.
5. Refresh an older tab that was open for user A.

Expected: user A's runtimes and temporary data are stopped or cleared. User B
cannot see user A's profile history. The old tab is rejected as stale and
follows only the current account after refresh.

### M-06 — User A returns

1. Sign user B out from the UI.
2. Sign user A back in to the same Team OS server.
3. Open Feed and search for the Team A and Team B work created earlier.

Expected: user A's durable history and sent attachments return with their
original Team/client scope. Old drafts, unsent attachments, runtimes, and the
previous browser session do not return.

### M-07 — Reconnect required

1. Use the test server to expire or revoke user A's saved authentication
   session without deleting local profile data.
2. Restart or refresh Command Centre.
3. Confirm **Reconnect required** appears and select **Reconnect**.
4. Sign in to the same server and account.

Expected: identity is revalidated before local Team history opens. Reconnect
does not change the profile or work scope.

### M-08 — Profile repair and pending cleanup

Use the committed automated tests or a disposable profile fixture to simulate
a missing profile database, migration failure, and interrupted cleanup. Do not
damage a real profile.

Expected:

- a missing database or failed migration shows **Profile repair required**;
- normal re-login is not presented as a way to recreate missing history;
- the user is told to preserve **.command-centre**, restore a private machine
  backup, or contact support; and
- startup or the next login finishes pending secure cleanup before the profile
  can reopen.

### M-09 — Solo and older data

1. Sign out and confirm the pre-existing Solo chat or task is still available
   only in Solo mode.
2. Sign user A in and confirm the Solo work is not assigned to user A or a Team.
3. Trigger an unavailable Team server and confirm the app does not open stale
   Team data through Solo.
4. Sign out again and confirm Team history is not copied into Solo.

Expected: Solo behavior remains unchanged and legacy unscoped rows remain
separate.

## Company and Team Manager Checks

Use a disposable Company Owner account and, where possible, a separate Company
Admin account. In the **Teams** section, verify:

- the Company Owner can list active and archived Teams;
- a Company Admin sees only the Teams granted to them unless broader access was
  explicitly assigned;
- creating, editing, archiving, and restoring a Team updates the list without
  changing existing work scope;
- Company Admin invitations, promotion, removal, and ownership transfer require
  the expected confirmation and preserve direct Team roles;
- access requests can be approved, denied, and cancelled; and
- archived Teams cannot be selected for new work, while their existing history
  remains available to authorized users.

Test the recovery command only against a disposable store with no active Company
Owner:

~~~powershell
npm run company:owner-recover -- --user <RECOVERY_EMAIL_OR_ID>
~~~

Expected: the command refuses to replace an active Company Owner and restores
ownership only when the Company has no active Owner.

## Permissions and Manager Checks

Use a test owner/admin account to verify:

- invitations are single-use and expire;
- owners/admins can manage members and shared Team memory;
- client grants control visibility and read/write actions;
- skill grants distinguish **skill.use** from **skill.edit**;
- a member without a grant cannot use cached local files to widen access;
- secrets are available only to granted work; and
- revocation takes effect on the next protected request.

For a client revoke test:

~~~powershell
npm run team:client -- revoke --team <TEAM> --client <CLIENT> --user <EMAIL> --by <ADMIN_EMAIL>
npm run team:client -- grants --team <TEAM>
~~~

Expected: the client disappears from the member's current list and protected
client requests fail. Unknown clients must not reveal extra information.

## File Sync Check

Create disposable source and destination folders outside the repository:

~~~powershell
$source="$env:TEMP\team-os-sync-source"
$destination="$env:TEMP\team-os-sync-destination"
New-Item -ItemType Directory -Force "$source\clients\<CLIENT>\context" | Out-Null
Set-Content "$source\clients\<CLIENT>\context\notes.md" "Team OS sync proof"

npm run team -- sync push --client <CLIENT> --src $source
npm run team -- sync manifest --client <CLIENT>
npm run team -- sync pull --client <CLIENT> --dest $destination
~~~

Expected:

- the manifest and pull contain only granted client files;
- revoked users cannot list or pull that client; and
- secrets, **.mcp.json**, transcripts, **.command-centre**, and build folders
  are not exposed.

## Automated Validation

Run the isolation suite and production build:

~~~powershell
cd command-centre
npm run test:isolation
npm run build
~~~

From the repository root, also run:

~~~powershell
git diff --check
~~~

The isolation suite is the main regression gate for multi-Team and
sequential-user behavior. The broader identity and memory suites remain useful
when their subsystems change:

~~~powershell
npm run test:identity
npm run test:memory
~~~

Record local results in the issue and pull request. If the pull request has no
remote checks, state that clearly instead of claiming CI passed.
