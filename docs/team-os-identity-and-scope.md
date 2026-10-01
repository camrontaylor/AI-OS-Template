# Team OS Identity and Work Scope Contract

This document is the architecture contract approved in AIOS-378. Later multi-team and local-profile work must use these identities and boundaries instead of defining alternatives.

The shared TypeScript contract lives in `command-centre/src/lib/identity/session-scope.ts`.

## Core Rules

1. A Better Auth session identifies one human user. It does not permanently select one team.
2. A local Team OS profile is identified by immutable `serverId + userId`.
3. Team and optional client scope are selected for each server request and captured immutably for each unit of work.
4. The UI team selector is only the default for new work.
5. Server authorization and local profile routing are separate required boundaries.
6. Existing records without Team OS scope remain Solo records.
7. Logout or account switching stops the departing profile's active processes and clears volatile state without deleting durable history.
8. Local encryption is outside this contract; application-level isolation is not.

## Version-One Types

```ts
interface ProfileIdentityV1 {
  readonly version: 1;
  readonly serverId: string;
  readonly userId: string;
}

interface SessionScopeV1 extends ProfileIdentityV1 {
  readonly teamId: string;
  readonly clientId: string | null;
}

type StoredWorkScopeV1 =
  | { readonly mode: "solo"; readonly version: 1; readonly clientId: string | null }
  | { readonly mode: "team"; readonly scope: SessionScopeV1 };
```

Company authority is resolved separately from the saved work scope:

```ts
interface EffectiveTeamAccess {
  companyRole: "owner" | "admin" | null;
  source: "membership" | "company_owner" | "company_grant";
  effectiveRole: "owner" | "admin" | "member";
  fullAccess: boolean;
  protected: boolean;
  membership?: MembershipRow | null;
}
```

The server resolves this value again for every protected request. Company Owner
access takes precedence, followed by Team Owner/Admin membership, an active
Company grant, and normal Team membership. Company roles never become part of a
stored work scope and do not make revoked access durable.

`serverId`, `userId`, `teamId`, and `clientId` are opaque server-issued identifiers. Email, display name, team name, client slug, server URL, and current UI selection are not substitutes.

## Local Profile Identity

The profile key is a filesystem-safe digest of this canonical payload:

```text
sha256("team-os-profile:v1\n" + serverId + "\n" + userId)
```

AIOS-380 owns the profile registry, path layout, digest implementation, DB handle lifecycle, browser namespace, and migration behavior. The key does not include team or client identity, so one manager has one local history across every authorized team on the same server.

The digest hides raw IDs from path names but is not encryption. Non-secret profile metadata must be retained for diagnosis and recovery.

### Stable server ID

The server must expose an immutable ID that survives a URL or deployment-address change. AIOS-379 owns the response contract. Older servers may temporarily use a normalized URL-derived legacy key, but adopting a later stable ID requires an explicit, auditable migration. A URL returning a different stable server ID is a different authority and must not open the previous profile automatically.

## Request Authorization

The bearer session proves `userId`. Each team-scoped request separately supplies `teamId`, proposed as `x-ai-team-id` by AIOS-379.

For every request, the server must:

1. validate the user session;
2. resolve the requested team;
3. revalidate active membership;
4. resolve an optional client inside that team;
5. revalidate the required client grant;
6. prevent request body/query IDs from widening access.

Company-management routes are different: they authenticate the user without a
Team header, then require an active Company Owner or Company Admin role. A
Company Admin without Team access can therefore sign in, list Teams, and request
access. Any Team-specific action still resolves current Full access and rejects
an archived Team.

Immutable work scope does not preserve revoked permission. A revoked membership or grant must fail on the next request.

That failure applies to new Team OS data access, not to the user's private local
transcript. An existing Team-origin chat may continue in `conversation_only`
mode with its stored Claude session or local transcript. In that mode it keeps
its immutable Team label but cannot fetch Team context, search or capture Team
memory, refresh Team skills or secrets, or fall back to another Team or Solo
context. New Team chats still require a currently active membership.

The temporary single-team fallback may read the old session `activeTeamId` only when explicit request scope is absent. It must not mutate the session to serve concurrent teams.

## Immutable Work Scope

Team OS chats, tasks, branches, terminals, and agents capture `SessionScopeV1` when created. Replies, resume, retry, attachment, output, context, and memory operations use that stored scope.

- Selecting another team affects only new work.
- A scope change creates a new unit of work; it does not update an existing scope.
- Derived tasks copy the parent's scope.
- The stored `serverId + userId` must match the active local profile before local data is returned.
- Every server request still performs current membership and grant checks.
- If those checks fail for an existing chat, local continuation may proceed
  only with Team enrichment and Team memory capture disabled.

TypeScript `readonly` fields and frozen values created by the shared helpers protect accidental mutation. Persistence and route ownership remain follow-up work.

## Legacy and Corrupt Data

Only a missing persisted scope (`null` or `undefined`) is interpreted as legacy Solo data. A present but malformed scope throws `SessionScopeContractError`; it never falls back to Solo because that could expose Team OS data through less restrictive routes.

Existing `.command-centre/data.db` rows and workspace `.tmp` files remain in Solo storage. They are not assigned to the next person who signs in. Any future import must show the destination profile/team/client and require confirmation.

## Logout Boundary

Changing the selected team does not stop work. Logging out or switching human accounts does.

The logout sequence implemented by AIOS-385 must:

1. block new access to the departing profile;
2. revoke the session when the server is reachable;
3. stop that profile's agents and terminals gracefully, then force-stop after a bound;
4. cancel outstanding profile requests and clear memory-only stores;
5. remove session context overlays and temporary files;
6. close profile DB handles after owned processes stop;
7. retain durable profile history for a later successful login.

Server unavailability is not logout. It preserves the known profile identity while blocking operations that require fresh authorization.

## Component Ownership

| Component | Required contract | Implementation issue |
|---|---|---|
| Auth and Team API | Stable server ID, membership list, request team scope | AIOS-379 |
| Local database and caches | Profile key, registry, DB handles, browser namespace, Solo preservation | AIOS-380 |
| Team navigation | Selector as new-work default, stale-response protection | AIOS-381 |
| Chat history | Existing Feed history across the active profile, immutable scope labels, detached local continuation | AIOS-382 |
| Work and processes | Persist and propagate `SessionScopeV1` | AIOS-383 |
| Agent context | Per-session immutable runtime overlay | AIOS-384 |
| Logout and local routes | Profile guards, shutdown, cleanup, recovery | AIOS-385 |
| Verification | Automated and manual no-leak matrix | AIOS-386 |
| User documentation | Login, navigation, recovery, compatibility | AIOS-387 |

No component may infer Team OS ownership from the current selector, email address, server URL, client slug, or absence of scope.

## Security Boundary

The application must prevent one sequential Command Centre user from reading or controlling another user's profile through UI, local APIs, caches, files served by the app, or live processes. UI filtering alone is never sufficient.

This contract does not protect local files from malware, an administrator, or another process running as the same operating-system user. Encryption at rest can be added by a separate project without changing the identity and scope model.

---

## Context Import & Sync

<!-- Migrated from AGENTS.md when the always-on context was slimmed. -->

To migrate existing local context into Team OS after signing in, run `npm run context:import` from `command-centre/`. This imports approved private files (`context/USER.md`, `context/MEMORY.md`, `context/learnings.md`, prompt tags, and local overrides), root `team_context/*` and `brand_context/*` as team context, and approved client context as client context. `.mcp.json` is not imported as context; it uses encrypted backup sync.

To refresh a connected workspace, run `npm run context:sync` from `command-centre/`. This pulls server-owned base files, syncs private user files, pulls team context, and restores `.mcp.json` from encrypted backup when available.

## Snapshot Resolution & Chat-UI Skill Scoping

Snapshot resolution: the injected session-scoped runtime snapshot is the only runtime authority for team, client and private-user context (see `AGENTS.md` → Team OS Context Snapshot for the safety invariants that stay always-on).

### Skill origins in Chat UI

- `.claude/skills/` in the installation is the permanent local source and does
  not require Team OS `skill.*` permissions.
- Client skill folders are scoped to their client and override the root version
  when that client is active.
- Team skill copies live under the current local profile in a Team-ID-hashed
  cache. `skill.use/read/edit/admin` applies only to these Team copies.
- On a name collision, `/skill-name` uses Team by default, `/team:skill-name`
  forces Team, and `/local:skill-name` forces the local/client version.
- A connected response refreshes authorized Team copies. Conversation-only
  continuation may use the last authorized Team copy, while local and client
  skills remain available. Revocation is applied on the first response after
