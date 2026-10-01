const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const { APIError } = require("better-auth/api");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_TEAM_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EMAIL = "member@example.com";

let sessionResult = null;
let apiKeyResult = { valid: false };
let signInError = new Error("invalid credentials");
const deletedSessionTokens = [];
let foundUserByEmail = null;
let signUpCalls = 0;
let updatePasswordCalls = 0;
let linkAccountCalls = 0;
let resetPasswordCalls = 0;
let resetPasswordError = null;
let credentialProvisionEnablesSignIn = false;
let signUpRacePassword = null;
const verificationValues = new Map();

const authContext = {
  password: {
    hash: async (password) => `hashed:${password}`,
    verify: async ({ hash, password }) => hash === `hashed:${password}`,
  },
  internalAdapter: {
    findSession: async () => sessionResult,
    findUserById: async () => ({ id: "better-auth-user", email: EMAIL }),
    deleteSession: async (token) => {
      deletedSessionTokens.push(token);
    },
    updateSession: async (token, updates) => ({
      token,
      userId: "better-auth-user",
      expiresAt: new Date(Date.now() + 60_000),
      ...updates,
    }),
    findUserByEmail: async () => foundUserByEmail,
    updateUser: async () => {},
    updatePassword: async () => {
      updatePasswordCalls += 1;
    },
    linkAccount: async () => {
      linkAccountCalls += 1;
    },
    createVerificationValue: async (value) => {
      verificationValues.set(value.identifier, { ...value });
    },
    findVerificationValue: async (identifier) => verificationValues.get(identifier) ?? null,
    consumeVerificationValue: async (identifier) => {
      const value = verificationValues.get(identifier) ?? null;
      verificationValues.delete(identifier);
      return value;
    },
    deleteVerificationByIdentifier: async (identifier) => {
      verificationValues.delete(identifier);
    },
  },
};

class PermissionError extends Error {}

const teamAuth = loadTsModule(path.resolve(__dirname, "team-auth.ts"), {
  stubs: {
    "../auth-runtime": {
      ensureAuthSchema: async () => {},
      getAuth: () => ({
        $context: Promise.resolve(authContext),
        api: {
          verifyApiKey: async () => apiKeyResult,
          signInEmail: async () => {
            if (signInError) throw signInError;
            return { token: "signed-in-token", user: { email: EMAIL } };
          },
          signUpEmail: async ({ body }) => {
            signUpCalls += 1;
            const storedPassword = signUpRacePassword ?? body.password;
            foundUserByEmail = {
              user: { id: "new-better-auth-user", email: body.email, name: body.name },
              accounts: [{ providerId: "credential", password: `hashed:${storedPassword}` }],
            };
            if (signUpRacePassword !== null) {
              signUpRacePassword = null;
              throw new Error("credential was created concurrently");
            }
            if (credentialProvisionEnablesSignIn) signInError = null;
          },
          resetPassword: async ({ body }) => {
            const identifier = `reset-password:${body.token}`;
            if (!verificationValues.has(identifier)) throw new Error("invalid token");
            if (resetPasswordError) throw resetPasswordError;
            verificationValues.delete(identifier);
            resetPasswordCalls += 1;
          },
        },
      }),
    },
    "./permissions": {
      PermissionError,
      resolvePrincipal: async (store, input) => {
        const membership = await store.getMembership(input.teamId, input.userId);
        if (!membership || membership.status !== "active") {
          throw new PermissionError("active team membership is required");
        }
        return { ...input, membership };
      },
      resolveEffectiveTeamAccess: async (store, teamId, userId) => {
        const membership = await store.getMembership(teamId, userId);
        return membership?.status === "active" ? { membership, source: "membership" } : null;
      },
    },
  },
});

function futureSession() {
  return {
    session: {
      activeTeamId: TEAM_ID,
      expiresAt: new Date(Date.now() + 60_000),
    },
    user: { email: EMAIL },
  };
}

function identityStore(status = "active") {
  const membership = {
    id: "membership-1",
    teamId: TEAM_ID,
    userId: USER_ID,
    role: "member",
    status,
  };
  const team = { id: TEAM_ID, slug: "demo", name: "Demo", status: "active" };
  return {
    getUserByEmail: async () => ({ id: USER_ID, email: EMAIL, status: "active", metadata: {} }),
    getUserById: async () => ({ id: USER_ID, email: EMAIL, status: "active", metadata: {} }),
    getTeam: async () => team,
    getTeamBySlug: async () => team,
    getMembership: async () => membership,
    listMembershipsForUser: async () => [membership],
    getCompanyMembership: async () => null,
    getActiveTeamApiSessionByHash: async () => null,
    revokeTeamApiSessionByHash: async () => null,
  };
}

function multiTeamStore(statuses = {}) {
  const memberships = [TEAM_ID, SECOND_TEAM_ID].map((teamId, index) => ({
    id: `membership-${index + 1}`,
    teamId,
    userId: USER_ID,
    role: "member",
    status: statuses[teamId] ?? "active",
    createdAt: `2026-07-11T00:00:0${index}.000Z`,
  }));
  return {
    getUserByEmail: async () => ({ id: USER_ID, email: EMAIL, status: "active" }),
    getUserById: async () => ({ id: USER_ID, email: EMAIL, status: "active" }),
    getTeam: async (id) => ({ id, slug: id === TEAM_ID ? "alpha" : "beta", name: id, status: "active" }),
    getTeamBySlug: async () => null,
    getMembership: async (teamId) => {
      const membership = memberships.find((item) => item.teamId === teamId);
      return membership ? { ...membership, status: statuses[teamId] ?? membership.status } : null;
    },
    listMembershipsForUser: async () => memberships.map((membership) => ({
      ...membership,
      status: statuses[membership.teamId] ?? membership.status,
    })),
    getActiveTeamApiSessionByHash: async () => null,
    revokeTeamApiSessionByHash: async () => null,
  };
}

test.beforeEach(() => {
  sessionResult = null;
  apiKeyResult = { valid: false };
  signInError = new Error("invalid credentials");
  deletedSessionTokens.length = 0;
  foundUserByEmail = null;
  signUpCalls = 0;
  updatePasswordCalls = 0;
  linkAccountCalls = 0;
  resetPasswordCalls = 0;
  resetPasswordError = null;
  credentialProvisionEnablesSignIn = false;
  signUpRacePassword = null;
  verificationValues.clear();
});

test("invitation password setup creates a credential but never replaces one", async () => {
  const user = { id: USER_ID, email: EMAIL, displayName: "Member", status: "active", metadata: {} };
  await teamAuth.setUserPassword(identityStore(), user, "new-password-123");
  assert.equal(signUpCalls, 1);
  assert.equal(updatePasswordCalls, 0);

  foundUserByEmail = {
    user: { id: "existing-better-auth-user", email: EMAIL, name: "Member" },
    accounts: [{ providerId: "credential", password: "hashed:new-password-123" }],
  };
  await assert.rejects(
    teamAuth.setUserPassword(identityStore(), user, "new-password-123"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);

  foundUserByEmail = null;
  const legacyUser = {
    ...user,
    metadata: { teamOsPassword: { algo: "scrypt-sha256", salt: "legacy", hash: "legacy-hash" } },
  };
  await assert.rejects(
    teamAuth.setUserPassword(identityStore(), legacyUser, "replacement-password-789"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );
  assert.equal(signUpCalls, 1);
});

test("deployment password setup creates once and verifies later runs without replacing credentials", async () => {
  const user = { id: USER_ID, email: EMAIL, displayName: "Member", status: "active", metadata: {} };
  const store = identityStore();

  await teamAuth.ensureUserPassword(store, user, "bootstrap-password-123");
  await teamAuth.ensureUserPassword(store, user, "bootstrap-password-123");

  assert.equal(signUpCalls, 1);
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);
  await assert.rejects(
    teamAuth.ensureUserPassword(store, user, "different-password-456"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );
  assert.equal(signUpCalls, 1);
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);
});

test("deployment password setup verifies legacy credentials without migrating or replacing them", async () => {
  const password = "legacy-bootstrap-password";
  const salt = "legacy-bootstrap-salt";
  const user = {
    id: USER_ID,
    email: EMAIL,
    displayName: "Member",
    status: "active",
    metadata: {
      teamOsPassword: {
        algo: "scrypt-sha256",
        salt,
        hash: crypto.scryptSync(password, salt, 64).toString("base64url"),
      },
    },
  };

  await teamAuth.ensureUserPassword(identityStore(), user, password);
  await assert.rejects(
    teamAuth.ensureUserPassword(identityStore(), user, "different-legacy-password"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );
  assert.equal(signUpCalls, 0);
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);
});

test("deployment password setup accepts a matching concurrent creation and rejects a different one", async () => {
  const user = { id: USER_ID, email: EMAIL, displayName: "Member", status: "active", metadata: {} };
  const store = identityStore();

  signUpRacePassword = "bootstrap-password-123";
  await teamAuth.ensureUserPassword(store, user, "bootstrap-password-123");
  assert.equal(signUpCalls, 1);
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);

  foundUserByEmail = null;
  signUpRacePassword = "competing-password-456";
  await assert.rejects(
    teamAuth.ensureUserPassword(store, user, "bootstrap-password-123"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );
  assert.equal(signUpCalls, 2);
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);
});

test("deployment password setup fails closed for malformed credentials and honors Better Auth precedence", async () => {
  const password = "legacy-bootstrap-password";
  const salt = "legacy-bootstrap-salt";
  const legacyUser = {
    id: USER_ID,
    email: EMAIL,
    displayName: "Member",
    status: "active",
    metadata: {
      teamOsPassword: {
        algo: "scrypt-sha256",
        salt,
        hash: crypto.scryptSync(password, salt, 64).toString("base64url"),
      },
    },
  };
  foundUserByEmail = {
    user: { id: "existing-better-auth-user", email: EMAIL, name: "Member" },
    accounts: [{ providerId: "credential", password: "hashed:different-password-456" }],
  };
  await assert.rejects(
    teamAuth.ensureUserPassword(identityStore(), legacyUser, password),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );

  foundUserByEmail.accounts = [{ providerId: "credential", password: null }];
  await assert.rejects(
    teamAuth.ensureUserPassword(identityStore(), { ...legacyUser, metadata: {} }, password),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );

  foundUserByEmail = null;
  await assert.rejects(
    teamAuth.ensureUserPassword(
      identityStore(),
      { ...legacyUser, metadata: { teamOsPassword: { algo: "unknown" } } },
      password,
    ),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "existing_account",
  );
  assert.equal(signUpCalls, 0);
  assert.equal(updatePasswordCalls, 0);
  assert.equal(linkAccountCalls, 0);
});

test("Better Auth credential always wins over a divergent legacy password hash", async () => {
  const legacyPassword = "old-legacy-password";
  const salt = "legacy-precedence-salt";
  const base = identityStore();
  const user = {
    id: USER_ID,
    email: EMAIL,
    status: "active",
    metadata: {
      teamOsPassword: {
        algo: "scrypt-sha256",
        salt,
        hash: crypto.scryptSync(legacyPassword, salt, 64).toString("base64url"),
      },
    },
  };
  const s = {
    ...base,
    getUserByEmail: async () => user,
    getUserById: async () => user,
  };
  foundUserByEmail = {
    user: { id: "better-auth-user", email: EMAIL, name: "Member" },
    accounts: [{ providerId: "credential" }],
  };
  signInError = new Error("Better Auth rejected old password");

  await assert.rejects(
    teamAuth.authenticateTeamLogin(s, {
      email: EMAIL,
      password: legacyPassword,
      team: "demo",
      authSource: "browser-session",
    }),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "invalid_credentials",
  );
  assert.equal(updatePasswordCalls, 0);
});

test("a successful legacy login migrates to Better Auth and removes only the old hash", async () => {
  const password = "legacy-migration-password";
  const salt = "legacy-migration-salt";
  let user = {
    id: USER_ID,
    email: EMAIL,
    displayName: "Member",
    status: "active",
    metadata: {
      teamOsPassword: {
        algo: "scrypt-sha256",
        salt,
        hash: crypto.scryptSync(password, salt, 64).toString("base64url"),
      },
      note: "keep-this",
    },
  };
  const base = identityStore();
  const s = {
    ...base,
    getUserByEmail: async () => user,
    getUserById: async () => user,
    upsertUser: async (input) => {
      user = { ...user, displayName: input.displayName, status: input.status, metadata: input.metadata };
      return user;
    },
  };
  credentialProvisionEnablesSignIn = true;

  const result = await teamAuth.authenticateTeamLogin(s, {
    email: EMAIL,
    password,
    team: "demo",
    authSource: "browser-session",
  });

  assert.equal(signUpCalls, 1);
  assert.equal(result.user.metadata.teamOsPassword, undefined);
  assert.equal(result.user.metadata.note, "keep-this");
  assert.equal(user.metadata.teamOsPassword, undefined);
  assert.equal(user.metadata.note, "keep-this");
});

function passwordResetStore(state) {
  return {
    getUserByEmail: async () => state.user,
    getUserById: async () => state.user,
    getMembership: async (teamId) => state.memberships.find((item) => item.teamId === teamId) ?? null,
    listMembershipsForUser: async () => state.memberships,
    getCompanyMembership: async () => state.companyMembership ?? null,
    upsertUser: async (input) => {
      state.user = { ...state.user, displayName: input.displayName, metadata: input.metadata };
      return state.user;
    },
  };
}

test("password reset revalidates Team membership and authority when the token is consumed", async () => {
  foundUserByEmail = {
    user: { id: "better-auth-user", email: EMAIL, name: "Member" },
    accounts: [{ providerId: "credential" }],
  };
  const state = {
    user: {
      id: USER_ID,
      email: EMAIL,
      status: "active",
      metadata: {
        teamOsPassword: { algo: "scrypt-sha256", salt: "old-salt", hash: "old-hash" },
        note: "preserve",
      },
    },
    memberships: [{ id: "member-a", teamId: TEAM_ID, userId: USER_ID, role: "member", status: "active" }],
    companyMembership: null,
  };
  const s = passwordResetStore(state);

  const promotedToken = await teamAuth.createPasswordResetTokenForUser(s, state.user, { teamId: TEAM_ID });
  const authority = JSON.parse(verificationValues.get(`team-os-reset:${promotedToken.token}`).value);
  assert.notEqual(authority.resetToken, promotedToken.token);
  assert.equal(verificationValues.has(`reset-password:${promotedToken.token}`), false);
  assert.equal(verificationValues.has(`reset-password:${authority.resetToken}`), false);
  state.memberships.push({
    id: "owner-b",
    teamId: SECOND_TEAM_ID,
    userId: USER_ID,
    role: "owner",
    status: "active",
  });
  await assert.rejects(
    teamAuth.resetPasswordWithToken(s, promotedToken.token, "new-password-123"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "forbidden",
  );
  assert.equal(resetPasswordCalls, 0);

  state.memberships = state.memberships.filter((item) => item.teamId === TEAM_ID);
  const revokedToken = await teamAuth.createPasswordResetTokenForUser(s, state.user, { teamId: TEAM_ID });
  state.memberships[0].status = "suspended";
  await assert.rejects(
    teamAuth.resetPasswordWithToken(s, revokedToken.token, "new-password-123"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "forbidden",
  );
  assert.equal(resetPasswordCalls, 0);
  assert.equal(verificationValues.has("reset-password:legacy-public-token"), false);
});

test("legacy public reset tokens without an internal Better Auth token are invalid", async () => {
  const state = {
    user: { id: USER_ID, email: EMAIL, status: "active", metadata: {} },
    memberships: [{ id: "member-a", teamId: TEAM_ID, userId: USER_ID, role: "member", status: "active" }],
    companyMembership: null,
  };
  verificationValues.set("team-os-reset:legacy-public-token", {
    identifier: "team-os-reset:legacy-public-token",
    value: JSON.stringify({ userId: USER_ID, teamId: TEAM_ID }),
    expiresAt: new Date(Date.now() + 60_000),
  });
  verificationValues.set("reset-password:legacy-public-token", {
    identifier: "reset-password:legacy-public-token",
    value: "better-auth-user",
    expiresAt: new Date(Date.now() + 60_000),
  });

  await assert.rejects(
    teamAuth.resetPasswordWithToken(passwordResetStore(state), "legacy-public-token", "new-password-123"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "invalid_request",
  );
  assert.equal(resetPasswordCalls, 0);
});

test("password reset blocks later Company authority but preserves explicit local Owner recovery", async () => {
  foundUserByEmail = {
    user: { id: "better-auth-user", email: EMAIL, name: "Member" },
    accounts: [{ providerId: "credential" }],
  };
  const state = {
    user: {
      id: USER_ID,
      email: EMAIL,
      status: "active",
      metadata: {
        teamOsPassword: { algo: "scrypt-sha256", salt: "old-salt", hash: "old-hash" },
        note: "preserve",
      },
    },
    memberships: [{ id: "owner-a", teamId: TEAM_ID, userId: USER_ID, role: "owner", status: "active" }],
    companyMembership: null,
  };
  const s = passwordResetStore(state);

  const recovery = await teamAuth.createPasswordResetTokenForUser(s, state.user, {
    teamId: TEAM_ID,
    allowProtectedAuthority: true,
  });
  await teamAuth.resetPasswordWithToken(s, recovery.token, "owner-recovery-123");
  assert.equal(resetPasswordCalls, 1);
  assert.equal(state.user.metadata.teamOsPassword, undefined);
  assert.equal(state.user.metadata.note, "preserve");

  state.memberships[0].role = "member";
  const stale = await teamAuth.createPasswordResetTokenForUser(s, state.user, { teamId: TEAM_ID });
  state.companyMembership = { userId: USER_ID, role: "admin", status: "active" };
  await assert.rejects(
    teamAuth.resetPasswordWithToken(s, stale.token, "company-reset-123"),
    (error) => error instanceof teamAuth.TeamAuthError && error.code === "forbidden",
  );
  assert.equal(resetPasswordCalls, 1);
});

test("password reset maps only known Better Auth errors to 4xx and propagates internal failures", async () => {
  foundUserByEmail = {
    user: { id: "better-auth-user", email: EMAIL, name: "Member" },
    accounts: [{ providerId: "credential" }],
  };
  const state = {
    user: { id: USER_ID, email: EMAIL, status: "active", metadata: {} },
    memberships: [{ id: "member-a", teamId: TEAM_ID, userId: USER_ID, role: "member", status: "active" }],
    companyMembership: null,
  };
  const s = passwordResetStore(state);

  const retryable = await teamAuth.createPasswordResetTokenForUser(s, state.user, { teamId: TEAM_ID });
  resetPasswordError = APIError.from("BAD_REQUEST", {
    code: "PASSWORD_TOO_LONG",
    message: "Password too long",
  });
  await assert.rejects(
    teamAuth.resetPasswordWithToken(s, retryable.token, "password-that-is-rejected"),
    (error) => error instanceof teamAuth.TeamAuthError && error.status === 400 && error.code === "invalid_request",
  );
  assert.equal(
    verificationValues.has(`team-os-reset:${retryable.token}`),
    true,
    "password validation must leave the public link retryable",
  );

  resetPasswordError = null;
  await teamAuth.resetPasswordWithToken(s, retryable.token, "accepted-password-123");
  assert.equal(resetPasswordCalls, 1);

  const internalFailureToken = await teamAuth.createPasswordResetTokenForUser(s, state.user, { teamId: TEAM_ID });
  const internalFailure = new Error("Better Auth database unavailable");
  resetPasswordError = internalFailure;
  await assert.rejects(
    teamAuth.resetPasswordWithToken(s, internalFailureToken.token, "another-password-123"),
    (error) => error === internalFailure,
  );
  assert.equal(resetPasswordCalls, 1);
});

test("password reset keeps the public link when an internal check fails before it is claimed", async () => {
  const state = {
    user: { id: USER_ID, email: EMAIL, status: "active", metadata: {} },
    memberships: [{ id: "member-a", teamId: TEAM_ID, userId: USER_ID, role: "member", status: "active" }],
    companyMembership: null,
  };
  const baseStore = passwordResetStore(state);
  const reset = await teamAuth.createPasswordResetTokenForUser(baseStore, state.user, { teamId: TEAM_ID });
  const internalFailure = new Error("identity store unavailable");
  const failingStore = {
    ...baseStore,
    getUserById: async () => { throw internalFailure; },
  };

  await assert.rejects(
    teamAuth.resetPasswordWithToken(failingStore, reset.token, "new-password-123"),
    (error) => error === internalFailure,
  );
  assert.equal(verificationValues.has(`team-os-reset:${reset.token}`), true);
});

test("resolveTeamApiToken returns an authorized principal for an active member", async () => {
  sessionResult = futureSession();

  const result = await teamAuth.resolveTeamApiToken(identityStore("active"), "active-session");

  assert.equal(result.teamId, TEAM_ID);
  assert.equal(result.userId, USER_ID);
  assert.equal(result.membership.status, "active");
  assert.equal(result.authSource, "cli-device-token");
});

test("login validates credentials before revealing Team access", async () => {
  let teamLookups = 0;
  const store = identityStore("active");
  store.getTeam = async () => {
    teamLookups += 1;
    return null;
  };

  await assert.rejects(
    teamAuth.authenticateTeamLogin(store, {
      email: EMAIL,
      password: "wrong-password",
      team: TEAM_ID,
      authSource: "browser-session",
    }),
    (error) => error?.status === 401 && error?.code === "invalid_credentials",
  );
  assert.equal(teamLookups, 0);
});

test("one Better Auth session resolves two teams concurrently without mutating its default", async () => {
  sessionResult = futureSession();
  const store = multiTeamStore();

  const [alpha, beta] = await Promise.all([
    teamAuth.resolveTeamApiToken(store, "shared-session", { requestedTeamId: TEAM_ID }),
    teamAuth.resolveTeamApiToken(store, "shared-session", { requestedTeamId: SECOND_TEAM_ID }),
  ]);

  assert.equal(alpha.teamId, TEAM_ID);
  assert.equal(beta.teamId, SECOND_TEAM_ID);
  assert.equal(alpha.teamScopeSource, "explicit-header");
  assert.equal(beta.teamScopeSource, "explicit-header");
  assert.equal(sessionResult.session.activeTeamId, TEAM_ID);
});

test("membership revocation blocks the next request for only that team", async () => {
  sessionResult = futureSession();
  const statuses = { [TEAM_ID]: "active", [SECOND_TEAM_ID]: "active" };
  const store = multiTeamStore(statuses);

  assert.equal(
    (await teamAuth.resolveTeamApiToken(store, "shared-session", { requestedTeamId: SECOND_TEAM_ID })).teamId,
    SECOND_TEAM_ID,
  );
  statuses[SECOND_TEAM_ID] = "suspended";
  assert.equal(
    (await teamAuth.resolveTeamApiToken(store, "shared-session", { requestedTeamId: SECOND_TEAM_ID })).status,
    "blocked",
  );
  assert.equal(
    (await teamAuth.resolveTeamApiToken(store, "shared-session", { requestedTeamId: TEAM_ID })).teamId,
    TEAM_ID,
  );
});

test("missing header uses the saved session team without changing it", async () => {
  sessionResult = futureSession();
  const result = await teamAuth.resolveTeamApiToken(multiTeamStore(), "shared-session");
  assert.equal(result.teamId, TEAM_ID);
  assert.equal(result.teamScopeSource, "legacy-session");
  assert.equal(sessionResult.session.activeTeamId, TEAM_ID);
});

test("legacy team tokens cannot select another team", async () => {
  const store = multiTeamStore();
  store.getActiveTeamApiSessionByHash = async () => ({
    teamId: TEAM_ID,
    userId: USER_ID,
    authSource: "cli-device-token",
  });

  const result = await teamAuth.resolveTeamApiToken(store, "aios_legacy", {
    requestedTeamId: SECOND_TEAM_ID,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "credential_team_mismatch");
});

test("user-owned API keys use an explicit team or their metadata fallback", async () => {
  apiKeyResult = {
    valid: true,
    key: {
      referenceId: "better-auth-user",
      metadata: { teamId: TEAM_ID },
    },
  };
  const store = multiTeamStore();

  const explicit = await teamAuth.resolveTeamApiToken(store, "aos_user_key", {
    requestedTeamId: SECOND_TEAM_ID,
  });
  const fallback = await teamAuth.resolveTeamApiToken(store, "aos_user_key");

  assert.equal(explicit.teamId, SECOND_TEAM_ID);
  assert.equal(explicit.teamScopeSource, "explicit-header");
  assert.equal(fallback.teamId, TEAM_ID);
  assert.equal(fallback.teamScopeSource, "legacy-api-key");
});

test("resolveTeamApiToken preserves a valid suspended session as blocked", async () => {
  sessionResult = futureSession();

  const result = await teamAuth.resolveTeamApiToken(identityStore("suspended"), "blocked-session");

  assert.deepEqual(result, {
    status: "blocked",
    code: "forbidden",
    message: "active team membership is required",
  });
});

test("resolveTeamApiToken rejects an unknown session", async () => {
  const result = await teamAuth.resolveTeamApiToken(identityStore(), "unknown-session");
  assert.equal(result, null);
});

test("resolveTeamApiToken deletes and rejects an expired session", async () => {
  sessionResult = {
    session: {
      activeTeamId: TEAM_ID,
      expiresAt: new Date(Date.now() - 60_000),
    },
    user: { email: EMAIL },
  };

  const result = await teamAuth.resolveTeamApiToken(identityStore(), "expired-session");

  assert.equal(result, null);
  assert.deepEqual(deletedSessionTokens, ["expired-session"]);
});

test("revokeTeamAuthToken still deletes a suspended Better Auth session", async () => {
  sessionResult = futureSession();

  const revoked = await teamAuth.revokeTeamAuthToken(identityStore("suspended"), "blocked-session");

  assert.equal(revoked, true);
  assert.deepEqual(deletedSessionTokens, ["blocked-session"]);
});
