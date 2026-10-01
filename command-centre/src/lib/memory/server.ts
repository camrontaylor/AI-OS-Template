/**
 * Memory Schema — the hosted memory API server.
 *
 * A deliberately small node:http transport over the handlers in api.ts. No
 * framework, no new dependencies — this is the service that runs NEXT TO the
 * hosted Postgres (Railway/VPS) so consumers get a URL + token instead of raw
 * database credentials.
 *
 * Routes:
 *   GET  /v1/health          — liveness + backend/embedder info (no auth)
 *   GET  /v1/team/whoami     — resolved user/team context (Bearer auth)
 *   GET  /v1/team/clients    — clients granted to the resolved user (Bearer auth)
 *   GET  /v1/team/secrets    — allowed secret metadata (Bearer auth)
 *   POST /v1/team/secrets    — admin secret actions (Bearer auth)
 *   POST /v1/team/secrets/sync — materialize allowed secret values (Bearer auth)
 *   GET  /v1/workspace/manifest — granted client file manifest (Bearer auth)
 *   GET  /v1/workspace/file     — read one granted client file (Bearer auth)
 *   PUT  /v1/workspace/file     — write one granted client file (Bearer auth)
 *   DELETE /v1/workspace/file   — delete one granted client file (Bearer auth)
 *   GET  /v1/context/snapshot   — resolved Team OS context snapshot (Bearer auth)
 *   GET  /v1/context/documents  — list scoped context documents (Bearer auth)
 *   PUT  /v1/context/document   — write one scoped context document (Bearer auth)
 *   DELETE /v1/context/document — archive one scoped context document (Bearer auth)
 *   GET  /v1/user/config-file   — read one encrypted private user config file (Bearer auth)
 *   PUT  /v1/user/config-file   — write one encrypted private user config file (Bearer auth)
 *   GET  /v1/memory/status  — scoped memory/indexing status (Bearer auth)
 *   GET  /v1/memory/memories — admin review queue + published memories (Bearer auth)
 *   POST /v1/memory/memories — admin accept/discard review item (Bearer auth)
 *   POST /v1/memory/captures — stage one automatic session capture (Bearer auth)
 *   POST /v1/memory/consolidation/claim — claim staged captures (Bearer auth)
 *   POST /v1/memory/consolidation/complete — publish/review a claimed batch (Bearer auth)
 *   GET  /v1/memory/imports — inspect manual imports and failures (Bearer auth)
 *   POST /v1/memory/imports — admin manual shared content import (Bearer auth)
 *   POST /v1/memory/imports/retry — retry a failed manual import (Bearer auth)
 *   POST /v1/memory/search   — scoped, reranked search (Bearer auth)
 *   POST /v1/memory/ingest   — scoped single-source ingest (Bearer auth)
 *
 * Auth is fail-closed: createMemoryApiServer REFUSES to build without a token —
 * a hosted deployment never quietly serves unauthenticated. Token comparison is
 * constant-time. Fine-grained membership and grant checks happen at this
 * boundary whenever the server is configured with a resolved principal.
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  handleBrandContextFileReadRequest,
  handleBrandContextFileWriteRequest,
  handleBrandContextManifestRequest,
  handleCaptureCreateRequest,
  handleConsolidationClaimRequest,
  handleConsolidationCompleteRequest,
  handleContextDocumentDeleteRequest,
  handleContextDocumentWriteRequest,
  handleContextDocumentsListRequest,
  handleContextSnapshotRequest,
  handleCompanyAccessActionRequest,
  handleCompanyAccessRequest,
  handleCompanyInvitationAcceptRequest,
  handleCompanyMembershipsActionRequest,
  handleCompanyMembershipsRequest,
  handleCompanyTeamsActionRequest,
  handleCompanyTeamsRequest,
  handleExpandRequest,
  handleIngestRequest,
  handleManualImportRequest,
  handleManualImportRetryRequest,
  handleManualImportsListRequest,
  handleMemoriesListRequest,
  handleMemoryStatusRequest,
  handleMemoryReviewActionRequest,
  handleTeamAdminActionRequest,
  handleTeamAdminRequest,
  handleSearchRequest,
  handleSkillFileDeleteRequest,
  handleSkillFileReadRequest,
  handleSkillFileWriteRequest,
  handleSkillManifestRequest,
  handleSkillsListRequest,
  handleTeamSecretsActionRequest,
  handleTeamSecretsListRequest,
  handleTeamSecretsSyncRequest,
  handleUserConfigFileReadRequest,
  handleUserConfigFileWriteRequest,
  handleTeamClientsRequest,
  handleTeamJoinRequest,
  handleTeamLoginRequest,
  handleTeamLogoutRequest,
  handleTeamMembershipsRequest,
  handleTeamPasswordResetRequest,
  handleTeamWhoamiRequest,
  handleWorkspaceFileDeleteRequest,
  handleWorkspaceFileReadRequest,
  handleWorkspaceFileWriteRequest,
  handleWorkspaceManifestRequest,
  type ApiResponse,
  type MemoryApiDeps,
  type MemoryApiPrincipal,
  type MemoryApiUserPrincipal,
} from "./api";

export interface CreateMemoryApiServerOptions {
  deps: MemoryApiDeps;
  /** The Bearer token every /v1/memory/* request must present. REQUIRED. */
  token: string;
  /** Reported by /v1/health (resolved by the runner). */
  backendKind?: string;
  /** Max accepted request body size. Default 40 MB. */
  maxBodyBytes?: number;
  /** Resolve the authenticated actor from server-trusted auth state. */
  resolvePrincipal?: (input: {
    headers: http.IncomingHttpHeaders;
    token: string;
    path: string;
    requestedTeamId: string | null;
  }) => Promise<MemoryApiPrincipal | BlockedPrincipalResolution | null>;
  /** Resolve only the authenticated user for user-scoped auth routes. */
  resolveUser?: (input: {
    headers: http.IncomingHttpHeaders;
    token: string;
    path: string;
  }) => Promise<MemoryApiUserPrincipal | null>;
  /** Error logger for unexpected (500) failures. Default console.error. */
  logError?: (msg: string) => void;
}

export interface BlockedPrincipalResolution {
  status: "blocked";
  statusCode?: 400 | 403;
  code: string;
  message: string;
}

function readTeamScopeHeader(
  headers: http.IncomingHttpHeaders,
): { ok: true; teamId: string | null } | { ok: false; response: ApiResponse } {
  const value = headers["x-ai-team-id"];
  if (value == null) return { ok: true, teamId: null };
  if (Array.isArray(value) || value.includes(",")) {
    return { ok: false, response: errorBody(400, "invalid_team_scope", "X-AI-Team-Id must contain one team UUID") };
  }
  const teamId = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId)) {
    return { ok: false, response: errorBody(400, "invalid_team_scope", "X-AI-Team-Id must contain one team UUID") };
  }
  return { ok: true, teamId };
}

const DEFAULT_MAX_BODY_BYTES = 40 * 1024 * 1024;

/** Constant-time token check (hash both sides so length differences don't leak). */
function tokenMatches(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function isBlockedPrincipalResolution(
  value: MemoryApiPrincipal | BlockedPrincipalResolution | null,
): value is BlockedPrincipalResolution {
  return Boolean(value && "status" in value && value.status === "blocked");
}

function send(res: http.ServerResponse, response: ApiResponse): void {
  const payload = JSON.stringify(response.body);
  res.writeHead(response.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
  });
  res.end(html);
}

async function sendLogo(res: http.ServerResponse): Promise<void> {
  const candidates = [
    path.resolve(process.cwd(), "public", "logo.png"),
    path.resolve(process.cwd(), "command-centre", "public", "logo.png"),
  ];
  for (const candidate of candidates) {
    try {
      const payload = await fs.readFile(candidate);
      res.writeHead(200, {
        "content-type": "image/png",
        "content-length": payload.byteLength,
        "cache-control": "public, max-age=3600",
      });
      res.end(payload);
      return;
    } catch {
      // Try the next candidate.
    }
  }
  const fallback = Buffer.from(
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#5C5C5C\"/><path d=\"M18 46 32 14l14 32h-8l-2.5-6.5h-7L26 46h-8Zm13-13h3l-1.5-4-1.5 4Z\" fill=\"#fff\"/></svg>",
  );
  res.writeHead(200, {
    "content-type": "image/svg+xml",
    "content-length": fallback.byteLength,
    "cache-control": "public, max-age=3600",
  });
  res.end(fallback);
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function requestPublicBaseUrl(req: http.IncomingMessage): string | null {
  const host = firstHeader(req.headers["x-forwarded-host"]) ?? firstHeader(req.headers.host);
  if (!host) return null;
  const proto = firstHeader(req.headers["x-forwarded-proto"]) ?? "http";
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

function hostedPageShell(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --brand: #5C5C5C; --brand-soft: #F7F7F7; --brand-line: rgba(92, 92, 92,.18); --canvas: #F9F9F9; --text: #1C1C1C; --muted: #686868; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #F7F7F7 0, var(--canvas) 42%, #F3F3F3 100%); color: var(--text); }
    main { width: min(460px, 100%); padding: 30px; border: 1px solid var(--brand-line); border-radius: 10px; background: rgba(255,255,255,.96); box-shadow: 0 24px 72px rgba(28, 28, 28,.13); }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
    .brand img { width: 38px; height: 38px; object-fit: contain; }
    .brand span { color: var(--brand); font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; letter-spacing: 0; }
    p { margin: 0 0 18px; color: var(--muted); font-size: 14px; line-height: 1.5; }
    label { display: grid; gap: 6px; margin-top: 12px; color: #525252; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    input { height: 40px; padding: 0 11px; border: 1px solid #C9C9C9; border-radius: 6px; background: #fff; font: inherit; color: var(--text); outline-color: var(--brand); }
    input[readonly] { background: #F3F3F3; color: var(--muted); }
    button { width: 100%; height: 42px; margin-top: 18px; border: 0; border-radius: 6px; background: var(--brand); color: #fff; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: 0.65; cursor: default; }
    .message { min-height: 18px; margin-top: 14px; font-size: 13px; line-height: 1.4; }
    .error { color: #5D5D5D; }
    .success { color: #6F6F6F; }
    .success-state { text-align: center; padding: 10px 0 4px; }
    .success-icon { width: 54px; height: 54px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center; background: #F5F5F5; color: #6F6F6F; font-size: 30px; font-weight: 900; }
  </style>
</head>
<body>
  <main><div class="brand"><img src="/logo.png" alt="AI-OS" /><span>AI-OS</span></div>${body}</main>
  <script>${script}</script>
</body>
</html>`;
}

function joinPageHtml(): string {
  return hostedPageShell(
    "Join Team OS",
    `<h1>Join Team OS</h1>
    <p>Set your name and password to accept this team invite.</p>
    <form id="join-form">
      <label>Team<input id="team" readonly /></label>
      <label>Email<input id="email" type="email" readonly /></label>
      <label>Name<input id="displayName" autocomplete="name" /></label>
      <label>Password<input id="password" type="password" autocomplete="new-password" minlength="8" required /></label>
      <button id="submit" type="submit">Join team</button>
      <div id="message" class="message"></div>
    </form>`,
    `const params = new URLSearchParams(location.search);
const form = document.getElementById("join-form");
const button = document.getElementById("submit");
const message = document.getElementById("message");
document.getElementById("team").value = params.get("team") || "";
document.getElementById("email").value = params.get("email") || "";
function showSuccess() {
  document.querySelector("main").innerHTML = '<div class="brand"><img src="/logo.png" alt="AI-OS" /><span>AI-OS</span></div><div class="success-state"><div class="success-icon">&#10003;</div><h1>Account ready</h1><p>Your Team OS account is ready. You can now sign in from AI-OS.</p></div>';
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";
  message.textContent = "";
  button.disabled = true;
  try {
    const response = await fetch("/v1/auth/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        team: params.get("team") || "",
        email: params.get("email") || "",
        token: params.get("token") || "",
        displayName: document.getElementById("displayName").value,
        password: document.getElementById("password").value
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "Could not join team");
    showSuccess();
  } catch (error) {
    message.className = "message error";
    message.textContent = error instanceof Error ? error.message : "Could not join team";
  } finally {
    button.disabled = false;
  }
});`,
  );
}

function companyJoinPageHtml(): string {
  return hostedPageShell(
    "Join Company in Team OS",
    `<h1>Join your company</h1>
    <p>Set your name and password to accept this Company Admin invite.</p>
    <form id="join-form">
      <label>Email<input id="email" type="email" readonly /></label>
      <label>Name<input id="displayName" autocomplete="name" /></label>
      <label>Password<input id="password" type="password" autocomplete="new-password" minlength="8" required /></label>
      <button id="submit" type="submit">Accept invite</button>
      <div id="message" class="message"></div>
    </form>`,
    `const params = new URLSearchParams(location.search);
const form = document.getElementById("join-form");
const button = document.getElementById("submit");
const message = document.getElementById("message");
document.getElementById("email").value = params.get("email") || "";
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";
  message.textContent = "";
  button.disabled = true;
  try {
    const response = await fetch("/v1/company/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: params.get("email") || "",
        token: params.get("token") || "",
        displayName: document.getElementById("displayName").value,
        password: document.getElementById("password").value
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "Could not accept invite");
    document.querySelector("main").innerHTML = '<div class="brand"><img src="/logo.png" alt="AI-OS" /><span>AI-OS</span></div><div class="success-state"><div class="success-icon">&#10003;</div><h1>Account ready</h1><p>You can now sign in to AI-OS.</p></div>';
  } catch (error) {
    message.className = "message error";
    message.textContent = error instanceof Error ? error.message : "Could not accept invite";
  } finally {
    button.disabled = false;
  }
});`,
  );
}

function resetPasswordPageHtml(): string {
  return hostedPageShell(
    "Reset Team OS Password",
    `<h1>Reset password</h1>
    <p>Choose a new password for your Team OS account.</p>
    <form id="reset-form">
      <label>Email<input id="email" type="email" readonly /></label>
      <label>New password<input id="password" type="password" autocomplete="new-password" minlength="8" required /></label>
      <button id="submit" type="submit">Reset password</button>
      <div id="message" class="message"></div>
    </form>`,
    `const params = new URLSearchParams(location.search);
const form = document.getElementById("reset-form");
const button = document.getElementById("submit");
const message = document.getElementById("message");
document.getElementById("email").value = params.get("email") || "";
function showSuccess() {
  document.querySelector("main").innerHTML = '<div class="brand"><img src="/logo.png" alt="AI-OS" /><span>AI-OS</span></div><div class="success-state"><div class="success-icon">&#10003;</div><h1>Password updated</h1><p>You can now sign in to AI-OS with your new password.</p></div>';
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";
  message.textContent = "";
  button.disabled = true;
  try {
    const response = await fetch("/v1/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: params.get("token") || "",
        password: document.getElementById("password").value
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || "Could not reset password");
    showSuccess();
  } catch (error) {
    message.className = "message error";
    message.textContent = error instanceof Error ? error.message : "Could not reset password";
  } finally {
    button.disabled = false;
  }
});`,
  );
}

function errorBody(status: number, code: string, message: string): ApiResponse {
  return { status, body: { error: { code, message } } };
}

/** Read the request body, enforcing the size cap. Resolves to the raw string. */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; raw: string } | { ok: false; response: ApiResponse }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let done = false;

    req.on("data", (chunk: Buffer) => {
      if (done) return;
      received += chunk.length;
      if (received > maxBytes) {
        done = true;
        // Drain (don't destroy) the rest: killing the socket here would also
        // kill the response before the client can read the 413.
        chunks.length = 0;
        req.removeAllListeners("data");
        req.resume();
        resolve({
          ok: false,
          response: errorBody(
            413,
            "payload_too_large",
            `request body exceeds ${maxBytes} bytes`,
          ),
        });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve({ ok: true, raw: Buffer.concat(chunks).toString("utf-8") });
    });
    req.on("error", () => {
      if (done) return;
      done = true;
      resolve({
        ok: false,
        response: errorBody(400, "invalid_request", "failed to read request body"),
      });
    });
  });
}

/**
 * Build the HTTP server (without listening — callers own the lifecycle, tests
 * listen on port 0). Throws when no token is configured: fail closed.
 */
export function createMemoryApiServer(
  opts: CreateMemoryApiServerOptions,
): http.Server {
  if (!opts.token || opts.token.trim() === "") {
    throw new Error(
      "createMemoryApiServer: MEMORY_API_TOKEN is required — the hosted memory " +
        "API never serves unauthenticated. Set a strong token and pass it here.",
    );
  }
  const token = opts.token.trim();
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const logError = opts.logError ?? ((msg: string) => console.error(msg));

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;

      // Liveness — unauthenticated by design (Railway healthchecks).
      if (url.pathname === "/v1/health") {
        if (req.method !== "GET") {
          send(res, errorBody(405, "method_not_allowed", "use GET /v1/health"));
          return;
        }
        send(res, {
          status: 200,
          body: {
            ok: true,
            backend: opts.backendKind ?? "unknown",
            embedder: {
              mode: "client-provided",
              model: opts.deps.expectedEmbeddingModel ?? "bge-m3",
              dim: opts.deps.expectedEmbeddingDim ?? 1024,
              serverModeEnabled: typeof opts.deps.serverEmbedder === "function",
            },
          },
        });
        return;
      }

      if (url.pathname === "/logo.png") {
        if (req.method !== "GET") {
          send(res, errorBody(405, "method_not_allowed", "use GET /logo.png"));
          return;
        }
        await sendLogo(res);
        return;
      }

      if (
        url.pathname === "/team/join" ||
        url.pathname === "/team/reset-password" ||
        url.pathname === "/company/join"
      ) {
        if (req.method !== "GET") {
          send(res, errorBody(405, "method_not_allowed", `use GET ${url.pathname}`));
          return;
        }
        sendHtml(
          res,
          url.pathname === "/team/join"
            ? joinPageHtml()
            : url.pathname === "/company/join"
              ? companyJoinPageHtml()
              : resetPasswordPageHtml(),
        );
        return;
      }

      const isSearch = url.pathname === "/v1/memory/search";
      const isExpand = url.pathname === "/v1/memory/expand";
      const isIngest = url.pathname === "/v1/memory/ingest";
      const isMemoryStatus = url.pathname === "/v1/memory/status";
      const isMemories = url.pathname === "/v1/memory/memories";
      const isMemoryCapture = url.pathname === "/v1/memory/captures";
      const isConsolidationClaim = url.pathname === "/v1/memory/consolidation/claim";
      const isConsolidationComplete = url.pathname === "/v1/memory/consolidation/complete";
      const isManualImports = url.pathname === "/v1/memory/imports";
      const isManualImportRetry = url.pathname === "/v1/memory/imports/retry";
      const isAuthLogin = url.pathname === "/v1/auth/login";
      const isAuthJoin = url.pathname === "/v1/auth/join";
      const isAuthResetPassword = url.pathname === "/v1/auth/reset-password";
      const isAuthLogout = url.pathname === "/v1/auth/logout";
      const isAuthTeams = url.pathname === "/v1/auth/teams";
      const isCompanyTeams = url.pathname === "/v1/company/teams";
      const isCompanyMemberships = url.pathname === "/v1/company/memberships";
      const isCompanyAccess = url.pathname === "/v1/company/access";
      const isCompanyInvitationAccept = url.pathname === "/v1/company/invitations/accept";
      const isWhoami = url.pathname === "/v1/team/whoami";
      const isClients = url.pathname === "/v1/team/clients";
      const isTeamAdmin = url.pathname === "/v1/team/admin";
      const isTeamSecrets = url.pathname === "/v1/team/secrets";
      const isTeamSecretsSync = url.pathname === "/v1/team/secrets/sync";
      const isBrandContextManifest = url.pathname === "/v1/team/brand-context/manifest";
      const isBrandContextFile = url.pathname === "/v1/team/brand-context/file";
      const isSkills = url.pathname === "/v1/team/skills";
      const isSkillManifest = url.pathname === "/v1/team/skills/manifest";
      const isSkillFile = url.pathname === "/v1/team/skills/file";
      const isWorkspaceManifest = url.pathname === "/v1/workspace/manifest";
      const isWorkspaceFile = url.pathname === "/v1/workspace/file";
      const isContextSnapshot = url.pathname === "/v1/context/snapshot";
      const isContextDocuments = url.pathname === "/v1/context/documents";
      const isContextDocument = url.pathname === "/v1/context/document";
      const isUserConfigFile = url.pathname === "/v1/user/config-file";
      if (
        !isSearch &&
        !isExpand &&
        !isIngest &&
        !isMemoryStatus &&
        !isMemories &&
        !isMemoryCapture &&
        !isConsolidationClaim &&
        !isConsolidationComplete &&
        !isManualImports &&
        !isManualImportRetry &&
        !isAuthLogin &&
        !isAuthJoin &&
        !isAuthResetPassword &&
        !isAuthLogout &&
        !isAuthTeams &&
        !isCompanyTeams &&
        !isCompanyMemberships &&
        !isCompanyAccess &&
        !isCompanyInvitationAccept &&
        !isWhoami &&
        !isClients &&
        !isTeamAdmin &&
        !isTeamSecrets &&
        !isTeamSecretsSync &&
        !isBrandContextManifest &&
        !isBrandContextFile &&
        !isSkills &&
        !isSkillManifest &&
        !isSkillFile &&
        !isWorkspaceManifest &&
        !isWorkspaceFile &&
        !isContextSnapshot &&
        !isContextDocuments &&
        !isContextDocument &&
        !isUserConfigFile
      ) {
        send(res, errorBody(404, "not_found", `no route for ${route}`));
        return;
      }
      const allowedMethods = isAuthLogin || isAuthJoin || isAuthResetPassword || isAuthLogout || isCompanyInvitationAccept
        ? ["POST"]
        : isCompanyTeams || isCompanyMemberships || isCompanyAccess || isTeamAdmin || isTeamSecrets
          ? ["GET", "POST"]
        : isAuthTeams || isWhoami || isClients || isWorkspaceManifest || isBrandContextManifest || isMemoryStatus || (isMemories && req.method === "GET") || isSkills || isSkillManifest || isContextSnapshot || isContextDocuments
        ? ["GET"]
        : isTeamSecretsSync
          ? ["POST"]
        : isManualImports
          ? ["GET", "POST"]
        : isMemories
          ? ["GET", "POST"]
        : isMemoryCapture || isConsolidationClaim || isConsolidationComplete
          ? ["POST"]
        : isWorkspaceFile
          ? ["GET", "PUT", "DELETE"]
        : isContextDocument
          ? ["PUT", "DELETE"]
        : isUserConfigFile
          ? ["GET", "PUT"]
        : isSkillFile
          ? ["GET", "PUT", "DELETE"]
        : isBrandContextFile
          ? ["GET", "PUT"]
          : ["POST"];
      if (!allowedMethods.includes(req.method ?? "")) {
        send(
          res,
          errorBody(
            405,
            "method_not_allowed",
            `use ${allowedMethods.join(" or ")} ${url.pathname}`,
          ),
        );
        return;
      }

      if (isAuthLogin || isAuthJoin || isAuthResetPassword || isCompanyInvitationAccept) {
        const body = await readBody(req, maxBodyBytes);
        if (!body.ok) {
          send(res, body.response);
          return;
        }
        let parsed: unknown;
        try {
          parsed = body.raw === "" ? {} : JSON.parse(body.raw);
        } catch {
          send(res, errorBody(400, "invalid_request", "request body must be valid JSON"));
          return;
        }
        const response = isAuthLogin
          ? await handleTeamLoginRequest(opts.deps, parsed)
          : isAuthJoin
            ? await handleTeamJoinRequest(opts.deps, parsed)
            : isAuthResetPassword
              ? await handleTeamPasswordResetRequest(opts.deps, parsed)
              : await handleCompanyInvitationAcceptRequest(opts.deps, parsed);
        send(res, response);
        return;
      }

      // Bearer auth — before the protected body is read.
      const header = req.headers.authorization ?? "";
      const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
      if (provided === "") {
        send(res, errorBody(401, "unauthorized", "missing or invalid bearer token"));
        return;
      }
      const isDevToken = tokenMatches(provided, token);
      const isCompanyRoute = isCompanyTeams || isCompanyMemberships || isCompanyAccess;
      const isUserScopedRoute = isAuthLogout || isAuthTeams || isCompanyRoute;
      const userResolution = isUserScopedRoute && opts.resolveUser
        ? await opts.resolveUser({ headers: req.headers, token: provided, path: url.pathname })
        : null;
      const compatibilityAuthResolution = isUserScopedRoute && !opts.resolveUser && opts.resolvePrincipal
        ? await opts.resolvePrincipal({
            headers: req.headers,
            token: provided,
            path: url.pathname,
            requestedTeamId: null,
          })
        : null;
      const teamScope = isUserScopedRoute
        ? { ok: true as const, teamId: null }
        : readTeamScopeHeader(req.headers);
      if (!teamScope.ok) {
        send(res, teamScope.response);
        return;
      }
      const principalResolution = !isUserScopedRoute && opts.resolvePrincipal
        ? await opts.resolvePrincipal({
            headers: req.headers,
            token: provided,
            path: url.pathname,
            requestedTeamId: teamScope.teamId,
          })
        : null;
      if (!isDevToken && !(isUserScopedRoute
        ? userResolution || compatibilityAuthResolution
        : principalResolution)) {
        send(res, errorBody(401, "unauthorized", "missing or invalid bearer token"));
        return;
      }

      if (isAuthLogout) {
        send(res, await handleTeamLogoutRequest(opts.deps, provided));
        return;
      }

      if (isAuthTeams) {
        const authenticatedUser = userResolution ?? (
          compatibilityAuthResolution && !isBlockedPrincipalResolution(compatibilityAuthResolution)
            ? {
                userId: compatibilityAuthResolution.userId,
                authSource: compatibilityAuthResolution.authSource,
                legacyTeamId: compatibilityAuthResolution.teamId,
              }
            : null
        );
        if (!authenticatedUser) {
          send(res, errorBody(401, "unauthorized", "missing or invalid bearer token"));
          return;
        }
        send(res, await handleTeamMembershipsRequest(opts.deps, authenticatedUser));
        return;
      }

      if (isCompanyRoute) {
        const authenticatedUser = userResolution ?? (
          compatibilityAuthResolution && !isBlockedPrincipalResolution(compatibilityAuthResolution)
            ? {
                userId: compatibilityAuthResolution.userId,
                authSource: compatibilityAuthResolution.authSource,
                legacyTeamId: compatibilityAuthResolution.teamId,
              }
            : null
        );
        if (!authenticatedUser) {
          send(res, errorBody(401, "unauthorized", "missing or invalid bearer token"));
          return;
        }
        const context = {
          userPrincipal: authenticatedUser,
          publicBaseUrl: requestPublicBaseUrl(req),
        };
        if (req.method === "GET") {
          const response = isCompanyTeams
            ? await handleCompanyTeamsRequest(
                opts.deps,
                { teamId: url.searchParams.get("teamId") },
                context,
              )
            : isCompanyMemberships
              ? await handleCompanyMembershipsRequest(opts.deps, context)
              : await handleCompanyAccessRequest(opts.deps, context);
          send(res, response);
          return;
        }
        const body = await readBody(req, maxBodyBytes);
        if (!body.ok) {
          send(res, body.response);
          return;
        }
        let parsed: unknown;
        try {
          parsed = body.raw === "" ? {} : JSON.parse(body.raw);
        } catch {
          send(res, errorBody(400, "invalid_request", "request body must be valid JSON"));
          return;
        }
        const response = isCompanyTeams
          ? await handleCompanyTeamsActionRequest(opts.deps, parsed, context)
          : isCompanyMemberships
            ? await handleCompanyMembershipsActionRequest(opts.deps, parsed, context)
            : await handleCompanyAccessActionRequest(opts.deps, parsed, context);
        send(res, response);
        return;
      }

      if (isBlockedPrincipalResolution(principalResolution)) {
        send(res, errorBody(principalResolution.statusCode ?? 403, principalResolution.code, principalResolution.message));
        return;
      }

      const principal = principalResolution;

      if (
        isWhoami ||
        isClients ||
        (isTeamAdmin && req.method === "GET") ||
        (isTeamSecrets && req.method === "GET") ||
        isBrandContextManifest ||
        (isBrandContextFile && req.method === "GET") ||
        isSkills ||
        isSkillManifest ||
        (isSkillFile && req.method === "GET") ||
        isWorkspaceManifest ||
        isContextSnapshot ||
        isContextDocuments ||
        (isUserConfigFile && req.method === "GET") ||
        isMemoryStatus ||
        (isMemories && req.method === "GET") ||
        (isManualImports && req.method === "GET") ||
        (isWorkspaceFile && req.method === "GET")
      ) {
        const response = isWhoami
          ? await handleTeamWhoamiRequest(opts.deps, { principal })
          : isClients
            ? await handleTeamClientsRequest(opts.deps, { principal })
          : isTeamAdmin
              ? await handleTeamAdminRequest(opts.deps, { principal, publicBaseUrl: requestPublicBaseUrl(req) })
            : isTeamSecrets
              ? await handleTeamSecretsListRequest(
                  opts.deps,
                  { client: url.searchParams.get("client") },
                  { principal },
                )
            : isBrandContextManifest
              ? await handleBrandContextManifestRequest(opts.deps, { principal })
            : isBrandContextFile
              ? await handleBrandContextFileReadRequest(
                  opts.deps,
                  { path: url.searchParams.get("path") },
                  { principal },
                )
            : isSkills
              ? await handleSkillsListRequest(opts.deps, { principal })
            : isSkillManifest
              ? await handleSkillManifestRequest(
                  opts.deps,
                  { skill: url.searchParams.get("skill") },
                  { principal },
                )
            : isSkillFile
              ? await handleSkillFileReadRequest(
                  opts.deps,
                  { path: url.searchParams.get("path") },
                  { principal },
                )
            : isMemoryStatus
            ? await handleMemoryStatusRequest(opts.deps, { principal })
            : isMemories
              ? await handleMemoriesListRequest(
                  opts.deps,
                  { limit: url.searchParams.get("limit") },
                  { principal },
                )
            : isContextSnapshot
              ? await handleContextSnapshotRequest(
                  opts.deps,
                  {
                    client: url.searchParams.get("client"),
                    cwd: url.searchParams.get("cwd"),
                    taskType: url.searchParams.get("taskType"),
                  },
                  { principal },
                )
            : isContextDocuments
              ? await handleContextDocumentsListRequest(
                  opts.deps,
                  {
                    visibility: url.searchParams.get("visibility"),
                    client: url.searchParams.get("client"),
                  },
                  { principal },
                )
              : isManualImports
                ? await handleManualImportsListRequest(
                    opts.deps,
                    {
                      status: url.searchParams.get("status") ?? undefined,
                      limit: url.searchParams.get("limit") ?? undefined,
                    },
                    { principal },
                  )
              : isWorkspaceManifest
              ? await handleWorkspaceManifestRequest(
                  opts.deps,
                  { client: url.searchParams.get("client") },
                  { principal },
                )
              : isUserConfigFile
              ? await handleUserConfigFileReadRequest(
                  opts.deps,
                  { path: url.searchParams.get("path") },
                  { principal },
                )
              : await handleWorkspaceFileReadRequest(
                  opts.deps,
                  { path: url.searchParams.get("path") },
                  { principal },
                );
        send(res, response);
        return;
      }

      if (isWorkspaceFile && req.method === "DELETE") {
        send(
          res,
          await handleWorkspaceFileDeleteRequest(
            opts.deps,
            {
              path: url.searchParams.get("path"),
              expectedSha256: url.searchParams.get("expectedSha256"),
            },
            { principal },
          ),
        );
        return;
      }

      if (isContextDocument && req.method === "DELETE") {
        send(
          res,
          await handleContextDocumentDeleteRequest(
            opts.deps,
            {
              visibility: url.searchParams.get("visibility"),
              path: url.searchParams.get("path"),
              client: url.searchParams.get("client"),
              expectedSha256: url.searchParams.get("expectedSha256"),
            },
            { principal },
          ),
        );
        return;
      }

      if (isSkillFile && req.method === "DELETE") {
        send(
          res,
          await handleSkillFileDeleteRequest(
            opts.deps,
            {
              path: url.searchParams.get("path"),
              expectedSha256: url.searchParams.get("expectedSha256"),
            },
            { principal },
          ),
        );
        return;
      }

      const body = await readBody(req, maxBodyBytes);
      if (!body.ok) {
        send(res, body.response);
        return;
      }

      let parsed: unknown;
      try {
        parsed = body.raw === "" ? {} : JSON.parse(body.raw);
      } catch {
        send(res, errorBody(400, "invalid_request", "request body must be valid JSON"));
        return;
      }

      const response = isSearch
        ? await handleSearchRequest(opts.deps, parsed, { principal })
        : isExpand
          ? await handleExpandRequest(opts.deps, parsed, { principal })
        : isIngest
          ? await handleIngestRequest(opts.deps, parsed, { principal })
        : isMemoryCapture
          ? await handleCaptureCreateRequest(opts.deps, parsed, { principal })
        : isConsolidationClaim
          ? await handleConsolidationClaimRequest(opts.deps, parsed, { principal })
        : isConsolidationComplete
          ? await handleConsolidationCompleteRequest(opts.deps, parsed, { principal })
        : isMemories
          ? await handleMemoryReviewActionRequest(opts.deps, parsed, { principal })
        : isTeamAdmin
            ? await handleTeamAdminActionRequest(opts.deps, parsed, {
                principal,
                publicBaseUrl: requestPublicBaseUrl(req),
              })
          : isTeamSecrets
            ? await handleTeamSecretsActionRequest(opts.deps, parsed, { principal })
          : isTeamSecretsSync
            ? await handleTeamSecretsSyncRequest(opts.deps, parsed, { principal })
          : isBrandContextFile
            ? await handleBrandContextFileWriteRequest(
                opts.deps,
                parsed,
                { path: url.searchParams.get("path") },
                { principal },
              )
          : isContextDocument
            ? await handleContextDocumentWriteRequest(opts.deps, parsed, { principal })
          : isUserConfigFile
            ? await handleUserConfigFileWriteRequest(opts.deps, parsed, { principal })
          : isSkillFile
            ? req.method === "GET"
              ? await handleSkillFileReadRequest(
                  opts.deps,
                  { path: url.searchParams.get("path") },
                  { principal },
                )
              : await handleSkillFileWriteRequest(
                  opts.deps,
                  parsed,
                  { path: url.searchParams.get("path") },
                  { principal },
                )
          : isManualImports
            ? await handleManualImportRequest(opts.deps, parsed, { principal })
          : isManualImportRetry
            ? await handleManualImportRetryRequest(opts.deps, parsed, { principal })
          : await handleWorkspaceFileWriteRequest(
              opts.deps,
              parsed,
              { path: url.searchParams.get("path") },
              { principal },
            );
      send(res, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`[memory-api] ${req.method} ${req.url} failed: ${message}`);
      if (!res.headersSent) {
        send(res, errorBody(500, "internal", "internal error"));
      } else {
        res.end();
      }
    }
  });
}
