/**
 * AIOS Team Platform — invite & join flow.
 *
 * Lets a team admin invite someone by email and lets that person join. An invite
 * is a membership held in the `invited` state plus a hashed, expiring, single-use
 * token kept in the membership's metadata. Only the hash is stored: the raw token
 * is returned once, to be handed to the invitee, and is verified on join. An
 * invite that is unknown, already used, tampered with, or past its expiry never
 * grants access.
 *
 * Builds entirely on the identity store's primitives — membership upsert/status,
 * the audit log, and the role gate in ./permissions — so there is no new storage
 * or SQL beyond the metadata bag the membership already carries.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  PermissionError,
  requireEffectiveTeamRole,
} from "./permissions";
import type { IdentityStore } from "./store";
import type { MembershipRow, Role, UserRow } from "./types";

/** Roles an invite may carry. Ownership is a transfer concern, not an invite. */
const INVITABLE_ROLES: readonly Role[] = ["admin", "member"];

const DEFAULT_EXPIRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InviteMemberInput {
  teamId: string;
  /** The admin or owner issuing the invite. Must hold an active admin+ role. */
  actorUserId: string;
  /** Who to invite. A user is created if none exists for this email yet. */
  email: string;
  /** Role to grant on join. Defaults to `member`; `owner` is not invitable. */
  role?: Role;
  /** Days until the invite expires. Defaults to 7. */
  expiresInDays?: number;
  /** Injectable clock for deterministic tests. Defaults to the current time. */
  now?: Date;
}

export interface InviteMemberResult {
  membership: MembershipRow;
  user: UserRow;
  /** The raw invite token — returned ONCE; only its hash is stored. */
  token: string;
  /** ISO timestamp after which the invite is no longer valid. */
  expiresAt: string;
}

export interface AcceptInviteInput {
  teamId: string;
  email: string;
  token: string;
  /** Injectable clock for deterministic tests. Defaults to the current time. */
  now?: Date;
}

type CreateInviteCredential = (user: UserRow) => Promise<void>;

const INVITE_CLAIM_ID = "_inviteClaimId";
const INVITE_CLAIMED_AT = "_inviteClaimedAt";
const INVITE_CREDENTIAL_READY = "_inviteCredentialReady";

/** Raised when an invite is missing, already used, mismatched, or expired. */
export class InvalidInviteError extends Error {
  readonly code = "invalid_invite";
  constructor(message = "invite is invalid or has expired") {
    super(message);
    this.name = "InvalidInviteError";
  }
}

interface InviteSecret {
  inviteTokenHash: string;
  inviteExpiresAt: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of two equal-length hex digests. */
function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function readInviteSecret(metadata: Record<string, unknown>): InviteSecret | null {
  const inviteTokenHash = metadata.inviteTokenHash;
  const inviteExpiresAt = metadata.inviteExpiresAt;
  if (typeof inviteTokenHash !== "string" || typeof inviteExpiresAt !== "string") {
    return null;
  }
  return { inviteTokenHash, inviteExpiresAt };
}

async function recordInviteDenied(
  store: IdentityStore,
  input: InviteMemberInput,
  reason: string,
): Promise<void> {
  await store.recordAuditEvent({
    teamId: input.teamId,
    actorUserId: input.actorUserId,
    action: "membership.invite_denied",
    targetType: "team",
    targetId: input.teamId,
    summary: `denied invite for ${input.email}`,
    metadata: { email: input.email, role: input.role ?? "member", reason },
  });
}

async function recordJoinDenied(
  store: IdentityStore,
  input: AcceptInviteInput,
  reason: string,
  userId?: string | null,
): Promise<void> {
  await store.recordAuditEvent({
    teamId: input.teamId,
    actorUserId: userId ?? null,
    action: "membership.join_denied",
    targetType: "team",
    targetId: input.teamId,
    summary: `denied join for ${input.email}`,
    metadata: { email: input.email, reason },
  });
}

/**
 * Invite a member to a team. The caller must hold an active admin (or owner)
 * role. Creates or reuses the invitee's user, records the membership in the
 * `invited` state with a hashed, expiring token, and writes a `membership.invited`
 * audit event. Returns the raw token (shown once) for delivery to the invitee.
 */
export async function inviteMember(
  store: IdentityStore,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const role = input.role ?? "member";
  if (!INVITABLE_ROLES.includes(role)) {
    await recordInviteDenied(store, input, "invalid_role");
    throw new PermissionError(`cannot invite with role "${role}"`);
  }

  // Authorize the inviter before creating or touching anything.
  try {
    await requireEffectiveTeamRole(store, input.teamId, input.actorUserId, "admin");
  } catch (error) {
    if (error instanceof PermissionError) {
      await recordInviteDenied(store, input, "insufficient_role");
    }
    throw error;
  }

  const user = await store.getUserByEmail(input.email) ?? await store.upsertUser({ email: input.email });
  if (user.status !== "active") {
    await recordInviteDenied(store, input, "inactive_user");
    throw new InvalidInviteError("inactive users cannot receive a Team invitation");
  }

  const [existing, companyMembership, memberships] = await Promise.all([
    store.getMembership(input.teamId, user.id),
    store.getCompanyMembership(user.id),
    store.listMembershipsForUser(user.id),
  ]);
  // Company authority and Team Ownership have dedicated management flows. A
  // normal Team invitation must never become a password-setting path for them,
  // even when there is no ordinary active membership on this Team.
  if (
    companyMembership?.status === "active" ||
    memberships.some((membership) => membership.status === "active" && membership.role === "owner")
  ) {
    await recordInviteDenied(store, input, "protected_credential_authority");
    throw new InvalidInviteError("protected authority cannot use a Team invitation");
  }

  if (existing && existing.status === "active") {
    await recordInviteDenied(store, input, "already_active_member");
    throw new InvalidInviteError("user is already an active member of this team");
  }

  const now = input.now ?? new Date();
  const expiresInDays = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(now.getTime() + expiresInDays * DAY_MS).toISOString();
  const token = randomBytes(32).toString("base64url");

  const inviteMetadata: InviteSecret = {
    inviteTokenHash: hashToken(token),
    inviteExpiresAt: expiresAt,
  };

  const membership = await store.upsertMembership({
    teamId: input.teamId,
    userId: user.id,
    role,
    status: "invited",
    invitedBy: input.actorUserId,
    metadata: { ...inviteMetadata },
  });

  await store.recordAuditEvent({
    teamId: input.teamId,
    actorUserId: input.actorUserId,
    action: "membership.invited",
    targetType: "membership",
    targetId: membership.id,
    summary: `invited ${user.email} as ${role}`,
    metadata: { email: user.email, role, expiresAt },
  });

  return { membership, user, token, expiresAt };
}

/**
 * Accept an invite and join the team. Verifies the token against the stored hash
 * in constant time and checks expiry, then flips the membership to `active` and
 * clears the now-spent token (single use). Writes a `membership.joined` audit
 * event. Throws {@link InvalidInviteError} for any unknown, used, mismatched, or
 * expired invite.
 */
async function claimInvite(
  store: IdentityStore,
  input: AcceptInviteInput,
): Promise<{
  user: UserRow;
  membership: MembershipRow;
  claimId: string;
  credentialReady: boolean;
}> {
  const user = await store.getUserByEmail(input.email);
  if (!user) {
    await recordJoinDenied(store, input, "unknown_user");
    throw new InvalidInviteError();
  }
  if (user.status !== "active") {
    await recordJoinDenied(store, input, "inactive_user", user.id);
    throw new InvalidInviteError();
  }

  const membership = await store.getMembership(input.teamId, user.id);
  if (!membership || membership.status !== "invited") {
    await recordJoinDenied(store, input, "no_pending_invite", user.id);
    throw new InvalidInviteError();
  }

  const secret = readInviteSecret(membership.metadata);
  if (!secret) {
    await recordJoinDenied(store, input, "missing_invite_secret", user.id);
    throw new InvalidInviteError();
  }

  if (!hashesEqual(hashToken(input.token), secret.inviteTokenHash)) {
    await recordJoinDenied(store, input, "token_mismatch", user.id);
    throw new InvalidInviteError();
  }

  const now = input.now ?? new Date();
  if (new Date(secret.inviteExpiresAt).getTime() <= now.getTime()) {
    await recordJoinDenied(store, input, "expired", user.id);
    throw new InvalidInviteError("invite has expired");
  }

  // Re-check at acceptance time. Company authority may have been granted after
  // a legitimate invite was issued, so creation-time validation alone is not
  // sufficient for old or concurrently changed invites.
  const [companyMembership, memberships] = await Promise.all([
    store.getCompanyMembership(user.id),
    store.listMembershipsForUser(user.id),
  ]);
  if (
    companyMembership?.status === "active" ||
    memberships.some((row) => row.status === "active" && row.role === "owner") ||
    membership.role === "owner"
  ) {
    await recordJoinDenied(store, input, "protected_credential_authority", user.id);
    throw new InvalidInviteError("protected authority cannot use a Team invitation");
  }

  const claimId = randomBytes(24).toString("base64url");
  const claimedAt = now.toISOString();
  const { rows } = await store.client.query<Record<string, unknown>>(
    `UPDATE memberships
     SET metadata = metadata || jsonb_build_object(
           '${INVITE_CLAIM_ID}', $2::text,
           '${INVITE_CLAIMED_AT}', $3::text
         ),
         updated_at = now()
     WHERE id = $1
       AND status = 'invited'
       AND role IN ('admin', 'member')
       AND metadata->>'inviteTokenHash' = $4
       AND (metadata->>'inviteExpiresAt')::timestamptz > $3::timestamptz
       AND (
         metadata->>'${INVITE_CLAIM_ID}' IS NULL
         OR NULLIF(metadata->>'${INVITE_CLAIMED_AT}', '')::timestamptz
              <= $3::timestamptz - interval '5 minutes'
       )
     RETURNING id`,
    [membership.id, claimId, claimedAt, secret.inviteTokenHash],
  );
  if (!rows.length) {
    await recordJoinDenied(store, input, "invite_already_claimed", user.id);
    throw new InvalidInviteError("invite is already being accepted");
  }
  const claimed = await store.getMembership(input.teamId, user.id);
  if (!claimed) throw new InvalidInviteError();
  return {
    user,
    membership: claimed,
    claimId,
    credentialReady: claimed.metadata[INVITE_CREDENTIAL_READY] === true,
  };
}

async function releaseInviteClaim(
  store: IdentityStore,
  membershipId: string,
  claimId: string,
): Promise<void> {
  await store.client.query(
    `UPDATE memberships
     SET metadata = metadata - '${INVITE_CLAIM_ID}' - '${INVITE_CLAIMED_AT}' - '${INVITE_CREDENTIAL_READY}',
         updated_at = now()
     WHERE id = $1 AND status = 'invited' AND metadata->>'${INVITE_CLAIM_ID}' = $2`,
    [membershipId, claimId],
  );
}

/**
 * Reserve an invite, create its credential, then activate the membership. The
 * reservation is released if credential creation fails, so no active
 * membership can be left behind without a usable account.
 */
export async function acceptInviteWithCredential(
  store: IdentityStore,
  input: AcceptInviteInput,
  createCredential: CreateInviteCredential,
): Promise<MembershipRow> {
  const claimed = await claimInvite(store, input);
  const [freshUser, freshTeam, companyMembership, memberships] = await Promise.all([
    store.getUserById(claimed.user.id),
    store.getTeam(input.teamId),
    store.getCompanyMembership(claimed.user.id),
    store.listMembershipsForUser(claimed.user.id),
  ]);
  if (
    !freshUser ||
    freshUser.status !== "active" ||
    !freshTeam ||
    freshTeam.status !== "active" ||
    companyMembership?.status === "active" ||
    memberships.some((membership) => membership.status === "active" && membership.role === "owner")
  ) {
    await releaseInviteClaim(store, claimed.membership.id, claimed.claimId);
    throw new InvalidInviteError("protected or inactive accounts cannot accept this invitation");
  }
  if (!claimed.credentialReady) {
    try {
      await createCredential(claimed.user);
    } catch (error) {
      await releaseInviteClaim(store, claimed.membership.id, claimed.claimId);
      throw error;
    }
    const { rows: readyRows } = await store.client.query<Record<string, unknown>>(
      `UPDATE memberships
       SET metadata = metadata || jsonb_build_object('${INVITE_CREDENTIAL_READY}', true),
           updated_at = now()
       WHERE id = $1 AND status = 'invited' AND metadata->>'${INVITE_CLAIM_ID}' = $2
       RETURNING id`,
      [claimed.membership.id, claimed.claimId],
    );
    if (!readyRows.length) {
      await releaseInviteClaim(store, claimed.membership.id, claimed.claimId);
      throw new InvalidInviteError("invite credential could not be finalized");
    }
  }

  const { rows: finalizedRows } = await store.client.query<Record<string, unknown>>(
    `UPDATE memberships AS target
     SET status = 'active', metadata = '{}'::jsonb, updated_at = now()
     WHERE target.id = $1
       AND target.status = 'invited'
       AND target.role IN ('admin', 'member')
       AND target.metadata->>'${INVITE_CLAIM_ID}' = $2
       AND target.metadata->>'${INVITE_CREDENTIAL_READY}' = 'true'
       AND EXISTS (
         SELECT 1 FROM users
         WHERE users.id = target.user_id AND users.status = 'active'
       )
       AND EXISTS (
         SELECT 1 FROM teams
         WHERE teams.id = target.team_id AND teams.status = 'active'
       )
       AND NOT EXISTS (
         SELECT 1 FROM company_memberships
         WHERE company_memberships.user_id = target.user_id
           AND company_memberships.status = 'active'
       )
       AND NOT EXISTS (
         SELECT 1 FROM memberships AS owner_memberships
         WHERE owner_memberships.user_id = target.user_id
           AND owner_memberships.status = 'active'
           AND owner_memberships.role = 'owner'
       )
     RETURNING id`,
    [claimed.membership.id, claimed.claimId],
  );
  if (!finalizedRows.length) {
    await releaseInviteClaim(store, claimed.membership.id, claimed.claimId);
    throw new InvalidInviteError("invite could not be finalized");
  }
  const joined = await store.getMembership(input.teamId, claimed.user.id);
  if (!joined) throw new InvalidInviteError("invite could not be finalized");

  await store.recordAuditEvent({
    teamId: input.teamId,
    actorUserId: claimed.user.id,
    action: "membership.joined",
    targetType: "membership",
    targetId: joined.id,
    summary: `${claimed.user.email} joined as ${joined.role}`,
    metadata: { email: claimed.user.email, role: joined.role },
  });

  return joined;
}

// Intentionally no token-only acceptance helper: every caller must provide the
// credential-creation step explicitly through acceptInviteWithCredential.
