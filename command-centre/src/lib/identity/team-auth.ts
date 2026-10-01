import crypto from "node:crypto";

import { isAPIError } from "better-auth/api";

import { ensureAuthSchema, getAuth } from "../auth-runtime";
import {
  PermissionError,
  resolveEffectiveTeamAccess,
  resolvePrincipal,
  type Principal,
} from "./permissions";
import type { IdentityStore } from "./store";
import type {
  CompanyMembershipRow,
  EffectiveTeamAccess,
  MembershipRow,
  TeamApiAuthSource,
  TeamRow,
  UserRow,
} from "./types";

const LEGACY_PASSWORD_METADATA_KEY = "teamOsPassword";
const LEGACY_PASSWORD_ALGO = "scrypt-sha256";
const LEGACY_TOKEN_PREFIX = "aios_";
const BETTER_AUTH_API_KEY_PREFIX = "aos_";

interface LegacyPasswordRecord {
  algo: typeof LEGACY_PASSWORD_ALGO;
  salt: string;
  hash: string;
}

export interface BetterAuthTeamSessionRow {
  type: "better-auth-session";
  id?: string | null;
  token: string;
  userId: string;
  teamId: string | null;
  expiresAt: string;
}

export interface AuthenticatedTeamSession {
  token: string;
  expiresAt: string;
  authSource: TeamApiAuthSource;
  session: BetterAuthTeamSessionRow;
  user: UserRow;
  team: TeamRow | null;
  membership: MembershipRow | null;
  companyMembership: CompanyMembershipRow | null;
  access: EffectiveTeamAccess | null;
}

export interface BlockedTeamApiTokenResolution {
  status: "blocked";
  statusCode?: 400 | 403;
  code: "forbidden" | "invalid_team_scope" | "credential_team_mismatch";
  message: string;
}

export type TeamApiTokenResolution = Principal | BlockedTeamApiTokenResolution;

export type TeamApiCredentialKind =
  | "better-auth-session"
  | "user-api-key"
  | "legacy-team-token";

export interface TeamApiUserPrincipal {
  userId: string;
  authSource: TeamApiAuthSource;
  credentialKind: TeamApiCredentialKind;
  legacyTeamId: string | null;
}

export interface ResolveTeamApiTokenOptions {
  requestedTeamId?: string | null;
}

export class TeamAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: "invalid_credentials" | "membership_required" | "invalid_request" | "existing_account" | "forbidden" | "internal",
    message: string,
  ) {
    super(message);
    this.name = "TeamAuthError";
  }
}

const RESET_PASSWORD_TOKEN_ERROR_CODES = new Set(["INVALID_TOKEN", "TOKEN_EXPIRED"]);
const RESET_PASSWORD_VALIDATION_ERROR_CODES = new Set(["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG"]);

function resetPasswordClientError(
  error: unknown,
): { error: TeamAuthError; retryable: boolean } | null {
  if (!isAPIError(error)) return null;
  const body = error.body && typeof error.body === "object"
    ? error.body as Record<string, unknown>
    : null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (RESET_PASSWORD_TOKEN_ERROR_CODES.has(code)) {
    return {
      error: new TeamAuthError(400, "invalid_request", "reset link is invalid or expired"),
      retryable: false,
    };
  }
  if (RESET_PASSWORD_VALIDATION_ERROR_CODES.has(code)) {
    const message = typeof body?.message === "string" && body.message.trim()
      ? body.message
      : "password does not meet the required length";
    return {
      error: new TeamAuthError(400, "invalid_request", message),
      retryable: true,
    };
  }
  return null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function getBetterAuthContext() {
  await ensureAuthSchema();
  return getAuth().$context;
}

export async function ensureTeamAuthSchema(): Promise<void> {
  await ensureAuthSchema();
}

function dateToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function readLegacyPasswordRecord(user: UserRow): LegacyPasswordRecord | null {
  const value = user.metadata[LEGACY_PASSWORD_METADATA_KEY];
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.algo !== LEGACY_PASSWORD_ALGO ||
    typeof record.salt !== "string" ||
    typeof record.hash !== "string"
  ) {
    return null;
  }
  return {
    algo: LEGACY_PASSWORD_ALGO,
    salt: record.salt,
    hash: record.hash,
  };
}

function hashLegacyPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("base64url");
}

function timingSafeTextEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyLegacyPassword(user: UserRow, password: string): boolean {
  const record = readLegacyPasswordRecord(user);
  if (!record) return false;
  return timingSafeTextEqual(hashLegacyPassword(password, record.salt), record.hash);
}

function existingPlatformPasswordError(): TeamAuthError {
  return new TeamAuthError(
    409,
    "existing_account",
    "an existing platform password cannot be changed through an invitation",
  );
}

async function findBetterAuthUserByEmail(email: string, includeAccounts = false): Promise<any | null> {
  const context = await getBetterAuthContext();
  return context.internalAdapter.findUserByEmail(normalizeEmail(email), { includeAccounts });
}

async function requireBetterAuthUserByEmail(email: string): Promise<any> {
  const found = await findBetterAuthUserByEmail(email, false);
  const user = found?.user ?? found;
  if (!user) {
    throw new TeamAuthError(401, "invalid_credentials", "Better Auth user is not initialized");
  }
  return user;
}

async function ensureBetterAuthUser(
  user: UserRow,
  password?: string,
  options: { allowCredentialUpdate?: boolean } = {},
): Promise<any> {
  const email = normalizeEmail(user.email);
  const trimmedPassword = password?.trim();
  if (trimmedPassword !== undefined && trimmedPassword.length < 8) {
    throw new TeamAuthError(400, "invalid_request", "password must be at least 8 characters");
  }

  const auth = getAuth();
  const context = await getBetterAuthContext();
  let found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  let createdWithPassword = false;
  if (!found?.user) {
    if (!trimmedPassword) {
      throw new TeamAuthError(401, "invalid_credentials", "Better Auth user is not initialized");
    }
    try {
      await auth.api.signUpEmail({
        body: {
          email,
          password: trimmedPassword,
          name: user.displayName || email,
        },
      });
      createdWithPassword = true;
    } catch (error) {
      found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
      if (!found?.user) throw error;
    }
    found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  }

  if (!found?.user) {
    throw new TeamAuthError(401, "invalid_credentials", "Better Auth user is not initialized");
  }

  if (user.displayName && found.user.name !== user.displayName) {
    await context.internalAdapter.updateUser(found.user.id, { name: user.displayName });
  }

  if (trimmedPassword) {
    const passwordHash = await context.password.hash(trimmedPassword);
    const credentialAccount = (found.accounts || []).find((account: any) => account.providerId === "credential");
    if (credentialAccount && !createdWithPassword) {
      if (!options.allowCredentialUpdate) {
        throw existingPlatformPasswordError();
      } else {
        await context.internalAdapter.updatePassword(found.user.id, passwordHash);
      }
    } else if (!credentialAccount) {
      await context.internalAdapter.linkAccount({
        userId: found.user.id,
        providerId: "credential",
        accountId: found.user.id,
        password: passwordHash,
      });
    }
  }

  const refreshed = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  return refreshed?.user ?? found.user;
}

export async function setUserPassword(
  _store: IdentityStore,
  user: UserRow,
  password: string,
): Promise<UserRow> {
  // Invitation onboarding may create a credential, but it must never replace
  // one. Password changes for existing accounts use the dedicated reset flow.
  if (readLegacyPasswordRecord(user)) {
    throw existingPlatformPasswordError();
  }
  await ensureBetterAuthUser(user, password);
  return user;
}

type ExistingPasswordState = "absent" | "matching" | "conflicting";

async function inspectExistingPassword(
  user: UserRow,
  rawPassword: string,
  betterAuthPassword: string,
): Promise<ExistingPasswordState> {
  const context = await getBetterAuthContext();
  const found = await context.internalAdapter.findUserByEmail(normalizeEmail(user.email), {
    includeAccounts: true,
  });
  const credentialAccount = (found?.accounts || []).find(
    (account: any) => account.providerId === "credential",
  );
  if (credentialAccount) {
    if (typeof credentialAccount.password !== "string" || !credentialAccount.password) {
      return "conflicting";
    }
    return await context.password.verify({
      hash: credentialAccount.password,
      password: betterAuthPassword,
    })
      ? "matching"
      : "conflicting";
  }

  const legacyRecord = readLegacyPasswordRecord(user);
  if (legacyRecord) {
    return verifyLegacyPassword(user, rawPassword) ? "matching" : "conflicting";
  }
  if (Object.prototype.hasOwnProperty.call(user.metadata, LEGACY_PASSWORD_METADATA_KEY)) {
    return "conflicting";
  }
  return "absent";
}

/**
 * Provision a deployment-test credential once, then verify it on later runs.
 * Existing credentials are never changed. Invitation flows must continue to
 * use setUserPassword so an invite cannot reuse an existing platform account.
 */
export async function ensureUserPassword(
  store: IdentityStore,
  user: UserRow,
  password: string,
): Promise<UserRow> {
  const trimmedPassword = password.trim();
  if (trimmedPassword.length < 8) {
    throw new TeamAuthError(400, "invalid_request", "password must be at least 8 characters");
  }

  const existingState = await inspectExistingPassword(user, password, trimmedPassword);
  if (existingState === "matching") return user;
  if (existingState === "conflicting") throw existingPlatformPasswordError();

  try {
    return await setUserPassword(store, user, trimmedPassword);
  } catch (error) {
    if (!(error instanceof TeamAuthError) || error.code !== "existing_account") throw error;

    // Another bootstrap may have created the credential after our first read.
    // Re-read both identity stores once and accept only the same password.
    const refreshedUser = await store.getUserByEmail(normalizeEmail(user.email));
    if (!refreshedUser) throw error;
    const refreshedState = await inspectExistingPassword(refreshedUser, password, trimmedPassword);
    if (refreshedState === "matching") return refreshedUser;
    throw error;
  }
}

async function clearLegacyPasswordMetadata(
  store: IdentityStore,
  user: UserRow,
): Promise<UserRow> {
  if (!Object.prototype.hasOwnProperty.call(user.metadata, LEGACY_PASSWORD_METADATA_KEY)) return user;
  const metadata = { ...user.metadata };
  delete metadata[LEGACY_PASSWORD_METADATA_KEY];
  return store.upsertUser({
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    metadata,
  });
}

async function ensureBetterAuthUserForReset(user: UserRow): Promise<any> {
  const email = normalizeEmail(user.email);
  const context = await getBetterAuthContext();
  const found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  if (found?.user) {
    if (user.displayName && found.user.name !== user.displayName) {
      await context.internalAdapter.updateUser(found.user.id, { name: user.displayName });
    }
    return found.user;
  }

  const temporaryPassword = crypto.randomBytes(24).toString("base64url");
  return ensureBetterAuthUser(user, temporaryPassword);
}

export async function createPasswordResetTokenForUser(
  _store: IdentityStore,
  user: UserRow,
  options: {
    teamId: string;
    expiresInSeconds?: number;
    allowProtectedAuthority?: boolean;
  },
): Promise<{ token: string; expiresAt: string }> {
  await ensureAuthSchema();
  const context = await getBetterAuthContext();
  const token = crypto.randomBytes(24).toString("base64url");
  const resetToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + (options.expiresInSeconds ?? 3600) * 1000);
  const authorityIdentifier = `team-os-reset:${token}`;
  await context.internalAdapter.createVerificationValue({
    identifier: authorityIdentifier,
    value: JSON.stringify({
      userId: user.id,
      teamId: options.teamId,
      resetToken,
      allowProtectedAuthority: options.allowProtectedAuthority === true,
    }),
    expiresAt,
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function resetPasswordWithToken(
  store: IdentityStore,
  token: string,
  newPassword: string,
): Promise<void> {
  await ensureAuthSchema();
  const normalizedToken = token.trim();
  if (newPassword.trim().length < 8) {
    throw new TeamAuthError(400, "invalid_request", "password must be at least 8 characters");
  }
  const context = await getBetterAuthContext();
  const authorityIdentifier = `team-os-reset:${normalizedToken}`;
  // Read first and claim only after all identity/authority checks and Better
  // Auth preparation succeed. A transient failure before the claim therefore
  // does not destroy an otherwise valid public reset link.
  const authority = await context.internalAdapter.findVerificationValue(authorityIdentifier);
  if (!authority) {
    throw new TeamAuthError(400, "invalid_request", "reset link is invalid or expired");
  }
  let resetScope: {
    userId: string;
    teamId: string;
    resetToken: string;
    allowProtectedAuthority?: boolean;
  } | null = null;
  try {
    const parsed = JSON.parse(String(authority.value)) as Record<string, unknown>;
    if (
      typeof parsed.userId === "string" &&
      typeof parsed.teamId === "string" &&
      typeof parsed.resetToken === "string"
    ) {
      resetScope = {
        userId: parsed.userId,
        teamId: parsed.teamId,
        resetToken: parsed.resetToken,
        allowProtectedAuthority: parsed.allowProtectedAuthority === true,
      };
    }
  } catch {
    // Legacy reset tokens did not carry a Team/user binding and are invalid.
  }
  if (!resetScope || authority.expiresAt < new Date()) {
    await context.internalAdapter.consumeVerificationValue(authorityIdentifier);
    await context.internalAdapter.deleteVerificationByIdentifier(
      `reset-password:${resetScope?.resetToken ?? normalizedToken}`,
    );
    throw new TeamAuthError(400, "invalid_request", "reset link is invalid or expired");
  }
  const user = resetScope ? await store.getUserById(resetScope.userId) : null;
  const [companyMembership, memberships, issuingMembership] = user && resetScope
    ? await Promise.all([
        store.getCompanyMembership(user.id),
        store.listMembershipsForUser(user.id),
        store.getMembership(resetScope.teamId, user.id),
      ])
    : [null, [], null];
  const protectedAuthority = companyMembership?.status === "active" || memberships.some(
    (membership) => membership.status === "active" && membership.role === "owner",
  );
  if (
    !user ||
    user.status !== "active" ||
    !issuingMembership ||
    issuingMembership.status !== "active" ||
    (protectedAuthority && resetScope?.allowProtectedAuthority !== true)
  ) {
    await context.internalAdapter.consumeVerificationValue(authorityIdentifier);
    await context.internalAdapter.deleteVerificationByIdentifier(`reset-password:${resetScope.resetToken}`);
    throw new TeamAuthError(
      403,
      "forbidden",
      "password reset is no longer allowed for this account",
    );
  }

  const betterAuthUser = await ensureBetterAuthUserForReset(user);
  const claimedAuthority = await context.internalAdapter.consumeVerificationValue(authorityIdentifier);
  if (
    !claimedAuthority ||
    String(claimedAuthority.value) !== String(authority.value) ||
    claimedAuthority.expiresAt < new Date()
  ) {
    throw new TeamAuthError(400, "invalid_request", "reset link is invalid or expired");
  }

  const restorePublicToken = async (): Promise<void> => {
    if (claimedAuthority.expiresAt < new Date()) return;
    await context.internalAdapter.createVerificationValue({
      identifier: authorityIdentifier,
      value: claimedAuthority.value,
      expiresAt: claimedAuthority.expiresAt,
    });
  };

  try {
    await context.internalAdapter.createVerificationValue({
      identifier: `reset-password:${resetScope.resetToken}`,
      value: betterAuthUser.id,
      expiresAt: authority.expiresAt,
    });
  } catch (error) {
    try {
      await restorePublicToken();
    } catch {
      // The original failure is already internal; keep it as the 5xx cause.
    }
    throw error;
  }

  try {
    await getAuth().api.resetPassword({
      body: {
        token: resetScope.resetToken,
        newPassword,
      },
    });
  } catch (error) {
    await context.internalAdapter.deleteVerificationByIdentifier(`reset-password:${resetScope.resetToken}`);
    const clientFailure = resetPasswordClientError(error);
    if (!clientFailure) throw error;
    if (clientFailure.retryable) {
      // Better Auth validates password length before consuming its internal
      // token, so this public link can safely be retried with another password.
      await restorePublicToken();
    }
    throw clientFailure.error;
  }
  try {
    await clearLegacyPasswordMetadata(store, user);
  } catch {
    throw new TeamAuthError(500, "internal", "password changed but legacy credential cleanup failed");
  }
}

export function createTeamApiToken(): string {
  return `${LEGACY_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashTeamApiToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

async function resolveLoginAccess(
  store: IdentityStore,
  userId: string,
  teamRef: string | null,
): Promise<{
  team: TeamRow | null;
  membership: MembershipRow | null;
  companyMembership: CompanyMembershipRow | null;
  access: EffectiveTeamAccess | null;
}> {
  const companyMembership = await store.getCompanyMembership(userId);
  const activeCompanyMembership = companyMembership?.status === "active"
    ? companyMembership
    : null;

  if (teamRef) {
    const team = isUuid(teamRef)
      ? await store.getTeam(teamRef)
      : await store.getTeamBySlug(teamRef);
    if (!team || team.status !== "active") {
      throw new TeamAuthError(403, "membership_required", "team membership is required");
    }
    const access = await resolveEffectiveTeamAccess(store, team.id, userId);
    if (!access) {
      throw new TeamAuthError(403, "membership_required", "team access is required");
    }
    return {
      team,
      membership: access.membership,
      companyMembership: activeCompanyMembership,
      access,
    };
  }

  // Preserve the existing default for members: their oldest active membership
  // wins before company-wide access is considered.
  const memberships = await store.listMembershipsForUser(userId);
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const team = await store.getTeam(membership.teamId);
    if (team?.status !== "active") continue;
    const access = await resolveEffectiveTeamAccess(store, team.id, userId);
    if (access) {
      return {
        team,
        membership: access.membership,
        companyMembership: activeCompanyMembership,
        access,
      };
    }
  }

  // A Company Owner, or a Company Admin with a grant but no normal membership,
  // can still receive a useful default Team.
  const teams = await store.listTeams();
  for (const team of teams) {
    const access = await resolveEffectiveTeamAccess(store, team.id, userId);
    if (access) {
      return {
        team,
        membership: access.membership,
        companyMembership: activeCompanyMembership,
        access,
      };
    }
  }

  // Company Admins are allowed to sign in before any Team access is granted.
  if (activeCompanyMembership) {
    return {
      team: null,
      membership: null,
      companyMembership: activeCompanyMembership,
      access: null,
    };
  }
  throw new TeamAuthError(403, "membership_required", "active team membership is required");
}

async function markSessionTeam(token: string, teamId: string | null): Promise<any> {
  const context = await getBetterAuthContext();
  return context.internalAdapter.updateSession(token, {
    activeOrganizationId: teamId,
    activeTeamId: teamId,
    updatedAt: new Date(),
  });
}

function shapeBetterAuthSession(
  session: any,
  teamId: string | null,
): BetterAuthTeamSessionRow {
  return {
    type: "better-auth-session",
    id: session?.id ?? null,
    token: session.token,
    userId: session.userId,
    teamId,
    expiresAt: dateToIso(session.expiresAt),
  };
}

export async function createTeamSessionForUser(
  _store: IdentityStore,
  input: {
    user: UserRow;
    team: TeamRow;
    membership: MembershipRow;
    authSource: TeamApiAuthSource;
    expiresInDays?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<AuthenticatedTeamSession> {
  const context = await getBetterAuthContext();
  const betterAuthUser = await requireBetterAuthUserByEmail(input.user.email);
  const session = await context.internalAdapter.createSession(betterAuthUser.id, false, {
    activeOrganizationId: input.team.id,
    activeTeamId: input.team.id,
  });
  return {
    token: session.token,
    expiresAt: dateToIso(session.expiresAt),
    authSource: input.authSource,
    session: shapeBetterAuthSession(session, input.team.id),
    user: input.user,
    team: input.team,
    membership: input.membership,
    companyMembership: await _store.getCompanyMembership(input.user.id),
    access: await resolveEffectiveTeamAccess(_store, input.team.id, input.user.id),
  };
}

export async function createCompanySessionForUser(
  _store: IdentityStore,
  input: {
    user: UserRow;
    companyMembership: CompanyMembershipRow;
    authSource: TeamApiAuthSource;
  },
): Promise<AuthenticatedTeamSession> {
  const context = await getBetterAuthContext();
  const betterAuthUser = await requireBetterAuthUserByEmail(input.user.email);
  const session = await context.internalAdapter.createSession(betterAuthUser.id, false, {});
  return {
    token: session.token,
    expiresAt: dateToIso(session.expiresAt),
    authSource: input.authSource,
    session: shapeBetterAuthSession(session, null),
    user: input.user,
    team: null,
    membership: null,
    companyMembership: input.companyMembership,
    access: null,
  };
}

export async function hasUsableBetterAuthAccount(email: string): Promise<boolean> {
  const found = await findBetterAuthUserByEmail(email, true);
  if (!found?.user) return false;
  return (found.accounts ?? []).some((account: any) => account.providerId === "credential");
}

/** A platform credential may already live in Better Auth or the legacy hash. */
export async function hasUsablePlatformCredential(
  store: IdentityStore,
  email: string,
): Promise<boolean> {
  if (await hasUsableBetterAuthAccount(email)) return true;
  const user = await store.getUserByEmail(normalizeEmail(email));
  return Boolean(user && readLegacyPasswordRecord(user));
}

async function signInWithBetterAuth(email: string, password: string): Promise<{ token: string; user: any }> {
  try {
    const result = await getAuth().api.signInEmail({
      body: {
        email,
        password,
        rememberMe: true,
      },
    });
    if (!result?.token || !result.user) {
      throw new TeamAuthError(401, "invalid_credentials", "invalid email or password");
    }
    return { token: result.token, user: result.user };
  } catch (error) {
    if (error instanceof TeamAuthError) throw error;
    throw new TeamAuthError(401, "invalid_credentials", "invalid email or password");
  }
}

export async function authenticateTeamLogin(
  store: IdentityStore,
  input: {
    email: string;
    password: string;
    team?: string | null;
    authSource: TeamApiAuthSource;
    expiresInDays?: number;
  },
): Promise<AuthenticatedTeamSession> {
  await ensureAuthSchema();
  const email = normalizeEmail(input.email);
  const user = await store.getUserByEmail(email);
  if (!user || user.status !== "active") {
    throw new TeamAuthError(401, "invalid_credentials", "invalid email or password");
  }

  let signedIn: { token: string; user: any };
  try {
    signedIn = await signInWithBetterAuth(email, input.password);
  } catch (error) {
    if (await hasUsableBetterAuthAccount(email) || !verifyLegacyPassword(user, input.password)) {
      throw error;
    }
    // This is the one migration path allowed to replace a credential: the
    // supplied password has already matched the user's legacy password hash.
    await ensureBetterAuthUser(user, input.password, { allowCredentialUpdate: true });
    signedIn = await signInWithBetterAuth(email, input.password);
  }
  let identityUser = user;
  if (readLegacyPasswordRecord(identityUser)) {
    try {
      identityUser = await clearLegacyPasswordMetadata(store, identityUser);
    } catch (error) {
      try {
        await (await getBetterAuthContext()).internalAdapter.deleteSession(signedIn.token);
      } catch {
        // The token is never returned if legacy cleanup cannot be made durable.
      }
      throw error;
    }
  }

  // Validate credentials before resolving Team/Company access. Otherwise an
  // unauthenticated caller could distinguish inaccessible Teams from bad login
  // details by comparing 403 and 401 responses.
  let resolved: Awaited<ReturnType<typeof resolveLoginAccess>>;
  try {
    resolved = await resolveLoginAccess(store, identityUser.id, input.team ?? null);
  } catch (error) {
    // signInEmail creates a Better Auth session. Do not leave that session
    // behind when valid credentials belong to a user without requested access.
    try {
      await (await getBetterAuthContext()).internalAdapter.deleteSession(signedIn.token);
    } catch {
      // The inaccessible token is never returned. Preserve the authorization
      // error even if cleanup itself is temporarily unavailable.
    }
    throw error;
  }
  const updatedSession = await markSessionTeam(signedIn.token, resolved.team?.id ?? null);
  return {
    token: signedIn.token,
    expiresAt: dateToIso(updatedSession?.expiresAt),
    authSource: input.authSource,
    session: shapeBetterAuthSession(updatedSession, resolved.team?.id ?? null),
    user: identityUser,
    team: resolved.team,
    membership: resolved.membership,
    companyMembership: resolved.companyMembership,
    access: resolved.access,
  };
}

function blockedMembershipResolution(): BlockedTeamApiTokenResolution {
  return {
    status: "blocked",
    code: "forbidden",
    message: "active team membership is required",
  };
}

function invalidTeamScopeResolution(): BlockedTeamApiTokenResolution {
  return {
    status: "blocked",
    statusCode: 400,
    code: "invalid_team_scope",
    message: "X-AI-Team-Id must contain one team UUID",
  };
}

function credentialTeamMismatchResolution(): BlockedTeamApiTokenResolution {
  return {
    status: "blocked",
    statusCode: 403,
    code: "credential_team_mismatch",
    message: "this credential is locked to a different team",
  };
}

async function resolvePrincipalForKnownTeam(
  store: IdentityStore,
  input: {
    teamId: string;
    userId: string;
    authSource: TeamApiAuthSource;
    teamScopeSource?: Principal["teamScopeSource"];
  },
): Promise<TeamApiTokenResolution | null> {
  try {
    const principal = await resolvePrincipal(store, input);
    return { ...principal, teamScopeSource: input.teamScopeSource };
  } catch (error) {
    if (error instanceof PermissionError) return null;
    throw error;
  }
}

async function resolveTeamReference(
  store: IdentityStore,
  teamRef: string | null,
): Promise<string | null> {
  if (!teamRef) return null;
  const team = isUuid(teamRef)
    ? await store.getTeam(teamRef)
    : await store.getTeamBySlug(teamRef);
  return team?.status === "active" ? team.id : null;
}

async function resolveBetterAuthSessionUser(
  store: IdentityStore,
  token: string,
): Promise<TeamApiUserPrincipal | null> {
  const context = await getBetterAuthContext();
  const session = await context.internalAdapter.findSession(token);
  if (!session?.session || !session.user) return null;
  if (new Date(session.session.expiresAt) <= new Date()) {
    await context.internalAdapter.deleteSession(token);
    return null;
  }
  const activeTeamId =
    typeof session.session.activeTeamId === "string" && session.session.activeTeamId.trim()
      ? session.session.activeTeamId.trim()
      : null;
  const user = await store.getUserByEmail(normalizeEmail(session.user.email));
  if (!user || user.status !== "active") return null;
  return {
    userId: user.id,
    authSource: "cli-device-token",
    credentialKind: "better-auth-session",
    legacyTeamId: await resolveTeamReference(store, activeTeamId),
  };
}

async function resolveBetterAuthApiKeyUser(
  store: IdentityStore,
  token: string,
): Promise<TeamApiUserPrincipal | null> {
  const auth = getAuth();
  const context = await getBetterAuthContext();
  const result = await (auth.api as any).verifyApiKey({ body: { key: token } });
  if (!result?.valid || !result.key?.referenceId) return null;
  const betterAuthUser = await context.internalAdapter.findUserById(result.key.referenceId);
  if (!betterAuthUser?.email) return null;
  const metadata = result.key.metadata && typeof result.key.metadata === "object"
    ? result.key.metadata as Record<string, unknown>
    : {};
  const teamRef = typeof metadata.teamId === "string"
    ? metadata.teamId
    : typeof metadata.team === "string"
      ? metadata.team
      : null;
  const user = await store.getUserByEmail(normalizeEmail(betterAuthUser.email));
  if (!user || user.status !== "active") return null;
  return {
    userId: user.id,
    authSource: "api-key",
    credentialKind: "user-api-key",
    legacyTeamId: await resolveTeamReference(store, teamRef),
  };
}

async function resolveLegacyTeamApiUser(
  store: IdentityStore,
  token: string,
): Promise<TeamApiUserPrincipal | null> {
  const session = await store.getActiveTeamApiSessionByHash(hashTeamApiToken(token));
  if (!session) return null;
  const user = await store.getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return {
    userId: session.userId,
    authSource: session.authSource,
    credentialKind: "legacy-team-token",
    legacyTeamId: session.teamId,
  };
}

export async function resolveTeamApiUserToken(
  store: IdentityStore,
  token: string,
): Promise<TeamApiUserPrincipal | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const sessionUser = await resolveBetterAuthSessionUser(store, trimmed);
  if (sessionUser) return sessionUser;

  if (trimmed.startsWith(BETTER_AUTH_API_KEY_PREFIX)) {
    const apiKeyUser = await resolveBetterAuthApiKeyUser(store, trimmed);
    if (apiKeyUser) return apiKeyUser;
  }

  if (isTeamApiToken(trimmed)) {
    return resolveLegacyTeamApiUser(store, trimmed);
  }
  return null;
}

async function firstActiveTeamId(store: IdentityStore, userId: string): Promise<string | null> {
  const memberships = await store.listMembershipsForUser(userId);
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const team = await store.getTeam(membership.teamId);
    if (
      team?.status === "active" &&
      await resolveEffectiveTeamAccess(store, team.id, userId)
    ) return team.id;
  }
  const teams = await store.listTeams();
  for (const team of teams) {
    if (await resolveEffectiveTeamAccess(store, team.id, userId)) return team.id;
  }
  return null;
}

export async function resolveTeamApiToken(
  store: IdentityStore,
  token: string,
  options: ResolveTeamApiTokenOptions = {},
): Promise<TeamApiTokenResolution | null> {
  const user = await resolveTeamApiUserToken(store, token);
  if (!user) return null;

  const requestedTeamId = options.requestedTeamId?.trim() || null;
  if (requestedTeamId && !isUuid(requestedTeamId)) return invalidTeamScopeResolution();

  if (
    user.credentialKind === "legacy-team-token" &&
    requestedTeamId &&
    requestedTeamId !== user.legacyTeamId
  ) {
    return credentialTeamMismatchResolution();
  }

  const teamId = requestedTeamId ?? user.legacyTeamId ?? await firstActiveTeamId(store, user.userId);
  if (!teamId) return blockedMembershipResolution();
  const team = await store.getTeam(teamId);
  if (!team || team.status !== "active") return blockedMembershipResolution();

  const teamScopeSource: Principal["teamScopeSource"] = requestedTeamId
    ? user.credentialKind === "legacy-team-token" ? "locked-token" : "explicit-header"
    : user.credentialKind === "better-auth-session" ? "legacy-session"
      : user.credentialKind === "user-api-key" ? "legacy-api-key"
        : "locked-token";

  const resolution = await resolvePrincipalForKnownTeam(store, {
    teamId,
    userId: user.userId,
    authSource: user.authSource,
    teamScopeSource,
  });
  return resolution ?? blockedMembershipResolution();
}

export async function revokeTeamAuthToken(
  store: IdentityStore,
  token: string,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;

  const context = await getBetterAuthContext();
  const session = await context.internalAdapter.findSession(trimmed);
  if (session?.session) {
    await context.internalAdapter.deleteSession(trimmed);
    return true;
  }

  const legacy = await store.revokeTeamApiSessionByHash(hashTeamApiToken(trimmed));
  return Boolean(legacy);
}

export function isTeamApiToken(value: string): boolean {
  return value.trim().startsWith(LEGACY_TOKEN_PREFIX);
}
