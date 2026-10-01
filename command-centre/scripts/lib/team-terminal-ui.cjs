const pc = require("picocolors");

const BACK = "__back";
const EXIT = "__exit";

function clay(value) {
  return `\x1b[38;2;192;64;48m${value}\x1b[0m`;
}

function sage(value) {
  return `\x1b[38;2;107;142;107m${value}\x1b[0m`;
}

function muted(value) {
  return pc.dim(value);
}

function warn(value) {
  return pc.yellow(value);
}

function danger(value) {
  return pc.red(value);
}

function banner() {
  const line = "=".repeat(42);
  return [
    "",
    clay(line),
    clay(" Team OS"),
    muted(" Terminal control for AI-OS teams"),
    clay(line),
    "",
  ].join("\n");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function teamLabel(team) {
  const record = asRecord(team);
  const slug = record.slug || record.id || null;
  const name = record.name || null;
  if (slug && name && slug !== name) return `${slug} (${name})`;
  return slug || name || "unknown team";
}

function userLabel(user) {
  const record = asRecord(user);
  return record.email || record.name || record.displayName || record.id || "unknown user";
}

function roleLabel(status) {
  return asRecord(status?.membership).role || "member";
}

function isAdminStatus(status) {
  const role = roleLabel(status);
  return status?.status === "connected" && (role === "owner" || role === "admin");
}

function isSignedInStatus(status) {
  return status?.status === "connected" || status?.status === "unavailable" || status?.hasLogin === true;
}

function normalizeMenuStatus(input = {}) {
  const status = input.status || (input.hasLogin ? "unavailable" : "signed_out");
  return {
    status,
    signedIn: status === "connected",
    hasLogin: input.hasLogin === true || status === "connected" || status === "unavailable",
    apiUrl: input.apiUrl || null,
    savedAt: input.savedAt || null,
    expiresAt: input.expiresAt || null,
    checkedAt: input.checkedAt || null,
    error: input.error || null,
    user: input.user || null,
    team: input.team || null,
    membership: input.membership || null,
    counts: {
      clients: input.counts?.clients ?? null,
      members: input.counts?.members ?? null,
      skills: input.counts?.skills ?? null,
      secrets: input.counts?.secrets ?? null,
      memorySources: input.counts?.memorySources ?? null,
      memoryChunks: input.counts?.memoryChunks ?? null,
      memoryPending: input.counts?.memoryPending ?? null,
    },
  };
}

function formatStatusLines(input) {
  const status = normalizeMenuStatus(input);
  if (status.status === "signed_out") {
    return [
      `${clay("Status")}: ${warn("signed out")}`,
      `${clay("Next")}: Sign in to connect this workspace to Team OS.`,
    ];
  }

  const connected = status.status === "connected";
  const lines = [
    `${clay("Status")}: ${connected ? sage("connected") : warn("offline")}`,
    `${clay("Team")}: ${teamLabel(status.team)}`,
    `${clay("User")}: ${userLabel(status.user)}`,
    `${clay("Role")}: ${roleLabel(status)}`,
    `${clay("Server")}: ${status.apiUrl || "unknown server"}`,
  ];

  const countParts = [];
  if (status.counts.clients != null) countParts.push(`clients ${status.counts.clients}`);
  if (status.counts.members != null) countParts.push(`members ${status.counts.members}`);
  if (status.counts.skills != null) countParts.push(`skills ${status.counts.skills}`);
  if (status.counts.secrets != null) countParts.push(`secrets ${status.counts.secrets}`);
  if (status.counts.memorySources != null || status.counts.memoryChunks != null) {
    countParts.push(`memory ${status.counts.memorySources || 0}/${status.counts.memoryChunks || 0}`);
  }
  if (status.counts.memoryPending != null) countParts.push(`pending ${status.counts.memoryPending}`);
  if (countParts.length > 0) lines.push(`${clay("Data")}: ${countParts.join(" | ")}`);
  if (status.checkedAt) lines.push(`${clay("Checked")}: ${status.checkedAt}`);
  if (!connected && status.error) lines.push(`${clay("Last error")}: ${status.error}`);
  return lines;
}

function statusPanel(input) {
  return {
    title: "Team OS status",
    body: formatStatusLines(input).join("\n"),
  };
}

function option(label, value, detail) {
  return { label, value, detail };
}

function buildMainMenuOptions(statusInput) {
  const status = normalizeMenuStatus(statusInput);
  const signedIn = isSignedInStatus(status);
  const admin = isAdminStatus(status);
  const options = [option("Connection", "Connection", signedIn ? "whoami, status, sign out" : "sign in, status")];
  if (signedIn) {
    options.push(option("Dashboard", "Dashboard", "team, role, clients, skills, secrets, memory"));
    if (admin) options.push(option("Members", "Members", "invite, links, role change, remove"));
    options.push(option("Clients", "Clients", admin ? "create, grants, pull and push" : "list, pull and push"));
    options.push(option("Secrets", "Secrets", admin ? "manage and sync .env values" : "list and sync permitted values"));
    options.push(option("Skills", "Skills", admin ? "list, grants, pull, push, adopt, prune" : "list, pull, push, adopt, prune"));
    options.push(option("Context & Sync", "Context & Sync", "brand context, client workspace, .mcp.json"));
    options.push(option("Memory", "Memory", "status, imports, retry"));
  }
  options.push(option("Exit", EXIT));
  return options;
}

function buildSectionOptions(section, statusInput) {
  const status = normalizeMenuStatus(statusInput);
  const admin = isAdminStatus(status);
  const options = [];
  if (section === "Connection") {
    options.push(option("Status information", "status-information", "connection, team, user, server"));
    if (status.status !== "connected") {
      options.push(option("Sign in", "login"));
      options.push(option("Sign in with dev token", "login-dev"));
    } else {
      options.push(option("Whoami", "whoami"));
      options.push(option("Sign out", "logout"));
    }
  }
  if (section === "Dashboard") options.push(option("Show dashboard", "show"));
  if (section === "Members" && admin) {
    options.push(option("List members", "list"));
    options.push(option("Invite member", "invite"));
    options.push(option("Create invite links", "invite-link"));
    options.push(option("Create reset links", "reset-link"));
    options.push(option("Change role", "role"));
    options.push(option("Remove members", "remove"));
  }
  if (section === "Clients") {
    options.push(option("List clients", "list"));
    if (admin) {
      options.push(option("Create client", "create"));
      options.push(option("Grant access", "grant"));
      options.push(option("Revoke access", "revoke"));
    }
    options.push(option("Pull workspace", "pull"));
    options.push(option("Push workspace", "push"));
  }
  if (section === "Secrets") {
    options.push(option("List secrets", "list"));
    if (admin) {
      options.push(option("Create secret", "create"));
      options.push(option("Update secret", "update"));
      options.push(option("Grant secrets", "grant"));
      options.push(option("Revoke secrets", "revoke"));
      options.push(option("Archive secrets", "archive"));
    }
    options.push(option("Sync permitted secrets", "sync"));
  }
  if (section === "Skills") {
    options.push(option("List skills", "list"));
    options.push(option("Search skills", "search"));
    if (admin) {
      options.push(option("Grant skills", "grant"));
      options.push(option("Revoke skills", "revoke"));
    }
    options.push(option("Pull skills", "pull"));
    options.push(option("Push skills", "push"));
    options.push(option("Adopt skills", "adopt"));
    options.push(option("Prune local skills", "prune"));
  }
  if (section === "Context & Sync") {
    options.push(option("Brand context status", "brand-status"));
    options.push(option("Pull brand context", "brand-pull"));
    if (admin) options.push(option("Push brand context", "brand-push"));
    options.push(option("Client workspace pull", "client-pull"));
    options.push(option("Client workspace push", "client-push"));
    options.push(option("MCP backup status", "mcp-status"));
    options.push(option("Backup .mcp.json", "mcp-backup"));
    options.push(option("Restore .mcp.json", "mcp-restore"));
  }
  if (section === "Memory") {
    options.push(option("Memory status", "status"));
    options.push(option("Import file", "import"));
    options.push(option("List imports", "imports"));
    options.push(option("Retry failed imports", "retry"));
  }
  return options;
}

function summarizeBatch(label, results) {
  const rows = asArray(results);
  const ok = rows.filter((result) => result.ok).length;
  const failed = rows.length - ok;
  const lines = [`${label}: ${ok}/${rows.length} done`];
  for (const result of rows.filter((row) => !row.ok)) {
    lines.push(`${result.label}: ${result.error}`);
  }
  return { ok, failed, text: lines.join("\n") };
}

module.exports = {
  BACK,
  EXIT,
  banner,
  buildMainMenuOptions,
  buildSectionOptions,
  clay,
  danger,
  formatStatusLines,
  isAdminStatus,
  isSignedInStatus,
  muted,
  normalizeMenuStatus,
  sage,
  statusPanel,
  summarizeBatch,
  teamLabel,
  userLabel,
  warn,
};
