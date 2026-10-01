const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const Database = require("better-sqlite3");
const { spawn, spawnSync } = require("child_process");
const { randomUUID } = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const {
  removeFileIfMatchesAtomically,
  replaceFileIfMatchesAtomically,
  writeFileAtomically,
  writeFileExclusivelyAtomically,
} = require("./owned-file.cjs");

const workspaceMarkers = ["AGENTS.md", "CLAUDE.md"];
const WEEKDAY_TOKENS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAY_SET = new Set(WEEKDAY_TOKENS);
const DAY_SHORTCUTS = new Set(["daily", "weekdays", "weekends"]);
const FIXED_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const INTERVAL_TIME_RE = /^every_([1-9]\d*)([mh])$/;
const DEFAULT_TIMEOUT = "30m";
const RUNTIME_STALE_MS = 120_000;
const RUNTIME_LOCK_FILE = "cron-runtime-lock.json";
const RUNTIME_PID_FILE = "cron-daemon.pid";
const RUNTIME_LOG_FILE = "cron-daemon.log";
const CRON_RUN_RESULT_SOURCES = new Set(["observed", "inferred"]);
const OUTPUT_SCAN_ROOTS = ["projects", "brand_context", "context"];
const OUTPUT_SCAN_IGNORES = new Set([
  ".git",
  ".next",
  "node_modules",
  ".command-centre",
]);

const profileDbPathContext = new AsyncLocalStorage();
const cachedDbs = new Map();

const WINDOWS_HIDDEN_RUNNER_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "run-hidden-command.ps1"
);
const WINDOWS_GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];
const runtimeHooks = {
  findCommandOnPath: null,
  platform: null,
  notificationSender: null,
};

function getRuntimePlatform() {
  return typeof runtimeHooks.platform === "function"
    ? runtimeHooks.platform()
    : process.platform;
}

function setCronRuntimeTestHooks(hooks = {}) {
  Object.assign(runtimeHooks, hooks);
}

function resetCronRuntimeTestHooks() {
  runtimeHooks.findCommandOnPath = null;
  runtimeHooks.platform = null;
  runtimeHooks.notificationSender = null;
}

function normalizeClientId(clientId) {
  if (!clientId || clientId === "root") {
    return null;
  }
  return clientId;
}

function workspaceKeyFor(clientId) {
  return normalizeClientId(clientId) || "root";
}

function toClientLabel(clientId) {
  if (!clientId) return "Root";
  return clientId
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function isWorkspaceRoot(targetDir) {
  return workspaceMarkers.some((marker) => fs.existsSync(path.join(targetDir, marker)));
}

function resolveAiOsRoot(explicitRoot) {
  const configuredRoot = explicitRoot || process.env.AI_OS_DIR || process.cwd();
  let currentDir = path.resolve(configuredRoot);

  for (let depth = 0; depth < 10; depth += 1) {
    if (isWorkspaceRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(
    `Unable to locate the AI-OS workspace root from ${configuredRoot}. Expected one of: ${workspaceMarkers.join(", ")}`
  );
}

function getDataDir(aiOsDir) {
  const dataDir = path.join(aiOsDir, ".command-centre");
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function getRuntimePaths(aiOsDir) {
  const dataDir = getDataDir(aiOsDir);
  return {
    dataDir,
    lockPath: path.join(dataDir, RUNTIME_LOCK_FILE),
    pidPath: path.join(dataDir, RUNTIME_PID_FILE),
    logPath: path.join(dataDir, RUNTIME_LOG_FILE),
  };
}

function getRuntimeCommands() {
  if (process.platform === "win32") {
    return {
      startCommand: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\start-crons.ps1",
      stopCommand: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\stop-crons.ps1",
      statusCommand: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\status-crons.ps1",
      logsCommand: "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\logs-crons.ps1",
    };
  }

  return {
    startCommand: "bash scripts/start-crons.sh",
    stopCommand: "bash scripts/stop-crons.sh",
    statusCommand: "bash scripts/status-crons.sh",
    logsCommand: "bash scripts/logs-crons.sh",
  };
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    return safeParseJson(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

function listWorkspaceDescriptors(aiOsDir) {
  const workspaces = [
    {
      clientId: null,
      workspaceKey: "root",
      label: "Root",
      workspaceDir: aiOsDir,
    },
  ];

  const clientsDir = path.join(aiOsDir, "clients");
  if (!fs.existsSync(clientsDir)) {
    return workspaces;
  }

  const entries = fs.readdirSync(clientsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const clientId = entry.name;
    workspaces.push({
      clientId,
      workspaceKey: workspaceKeyFor(clientId),
      label: toClientLabel(clientId),
      workspaceDir: path.join(clientsDir, clientId),
    });
  }

  return workspaces;
}

function getWorkspaceDescriptor(aiOsDir, clientId) {
  const normalizedClientId = normalizeClientId(clientId);
  if (!normalizedClientId) {
    return {
      clientId: null,
      workspaceKey: "root",
      label: "Root",
      workspaceDir: aiOsDir,
    };
  }

  const workspaceDir = path.join(aiOsDir, "clients", normalizedClientId);
  if (!fs.existsSync(workspaceDir)) {
    throw new Error(`Client directory not found: ${workspaceDir}`);
  }

  return {
    clientId: normalizedClientId,
    workspaceKey: workspaceKeyFor(normalizedClientId),
    label: toClientLabel(normalizedClientId),
    workspaceDir,
  };
}

function getWorkspacePaths(aiOsDir, clientId) {
  const descriptor = getWorkspaceDescriptor(aiOsDir, clientId);
  return {
    ...descriptor,
    jobsDir: path.join(descriptor.workspaceDir, "cron", "jobs"),
    logsDir: path.join(descriptor.workspaceDir, "cron", "logs"),
    statusDir: path.join(descriptor.workspaceDir, "cron", "status"),
  };
}

function normalizeDayTokens(days) {
  return String(days || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeTimeTokens(time) {
  return String(time || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function isSupportedCronDays(days) {
  const tokens = normalizeDayTokens(days);
  if (tokens.length === 0) return false;

  if (tokens.length === 1) {
    return DAY_SHORTCUTS.has(tokens[0]) || WEEKDAY_SET.has(tokens[0]);
  }

  return tokens.every((token) => WEEKDAY_SET.has(token));
}

function isSupportedCronTime(time) {
  const trimmed = String(time || "").trim();
  if (!trimmed) return false;

  if (INTERVAL_TIME_RE.test(trimmed)) {
    return true;
  }

  const parts = normalizeTimeTokens(trimmed);
  return parts.length > 0 && parts.every((part) => FIXED_TIME_RE.test(part));
}

function isSupportedCronSchedule(time, days) {
  return isSupportedCronTime(time) && isSupportedCronDays(days);
}

function getCronScheduleValidationError(time, days) {
  if (!isSupportedCronTime(time)) {
    return "Unsupported time schedule. Use HH:MM, comma-separated HH:MM values, every_Nm, or every_Nh.";
  }

  if (!isSupportedCronDays(days)) {
    return "Unsupported day schedule. Use daily, weekdays, weekends, or comma-separated weekday tokens like mon,wed.";
  }

  return null;
}

function matchesDays(date, days) {
  const tokens = normalizeDayTokens(days);
  if (tokens.length === 0) return false;

  const dayToken = WEEKDAY_TOKENS[date.getDay() === 0 ? 6 : date.getDay() - 1];
  if (tokens.length === 1) {
    switch (tokens[0]) {
      case "daily":
        return true;
      case "weekdays":
        return dayToken !== "sat" && dayToken !== "sun";
      case "weekends":
        return dayToken === "sat" || dayToken === "sun";
      default:
        return tokens[0] === dayToken;
    }
  }

  return tokens.includes(dayToken);
}

function matchesTime(date, schedule) {
  const trimmed = String(schedule || "").trim();
  const intervalMatch = trimmed.match(INTERVAL_TIME_RE);
  if (intervalMatch) {
    const interval = Number(intervalMatch[1]);
    const unit = intervalMatch[2];

    if (unit === "m") {
      return date.getMinutes() % interval === 0;
    }

    return date.getMinutes() === 0 && date.getHours() % interval === 0;
  }

  const currentTime = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return normalizeTimeTokens(trimmed).includes(currentTime);
}

// Single canonical gate for the live tick: a scheduled job should dispatch at
// `now` only when BOTH the time-of-day and the day-of-week match. Pure: the
// caller supplies `now` (no `new Date()` here, no side effects), so both live
// schedulers (in-process + daemon) share one decision and cannot drift apart.
// Manual "run now" and catch-up paths intentionally do NOT route through here.
function shouldDispatchNow(now, job) {
  return matchesTime(now, job.time) && matchesDays(now, job.days);
}

function isFixedTimeSchedule(schedule) {
  return !INTERVAL_TIME_RE.test(String(schedule || "").trim());
}

function toMinuteDate(date) {
  const minute = new Date(date);
  minute.setSeconds(0, 0);
  return minute;
}

function toMinuteIso(date) {
  return toMinuteDate(date).toISOString();
}

function getNextFixedRun(time, days, now) {
  const times = normalizeTimeTokens(time);
  if (times.length === 0) return null;

  let earliest = null;
  for (let offset = 0; offset < 14; offset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    day.setSeconds(0, 0);

    if (!matchesDays(day, days)) {
      continue;
    }

    for (const fixedTime of times) {
      const [hours, minutes] = fixedTime.split(":").map(Number);
      const candidate = new Date(day);
      candidate.setHours(hours, minutes, 0, 0);

      if (candidate <= now) {
        continue;
      }

      if (!earliest || candidate < earliest) {
        earliest = candidate;
      }
    }

    if (earliest) {
      return earliest;
    }
  }

  return null;
}

function getNextIntervalRun(time, days, now) {
  const intervalMatch = String(time || "").trim().match(INTERVAL_TIME_RE);
  if (!intervalMatch) return null;

  const interval = Number(intervalMatch[1]);
  const unit = intervalMatch[2];
  const cursor = toMinuteDate(now);

  if (unit === "m") {
    cursor.setMinutes(cursor.getMinutes() + 1);
    for (let i = 0; i < 60 * 24 * 14; i += 1) {
      if (matchesDays(cursor, days) && cursor.getMinutes() % interval === 0) {
        return new Date(cursor);
      }
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return null;
  }

  cursor.setMinutes(0, 0, 0);
  if (cursor <= now) {
    cursor.setHours(cursor.getHours() + 1);
  }

  for (let i = 0; i < 24 * 14; i += 1) {
    if (matchesDays(cursor, days) && cursor.getHours() % interval === 0) {
      return new Date(cursor);
    }
    cursor.setHours(cursor.getHours() + 1);
  }

  return null;
}

function getNextRunForSchedule(time, days, active, now = new Date()) {
  if (!active || !isSupportedCronSchedule(time, days)) {
    return null;
  }

  const next = INTERVAL_TIME_RE.test(String(time || "").trim())
    ? getNextIntervalRun(time, days, now)
    : getNextFixedRun(time, days, now);

  return next ? next.toISOString() : null;
}

function getMissedFixedRuns(schedule, days, start, end) {
  if (!isFixedTimeSchedule(schedule)) {
    return [];
  }

  const startMinute = toMinuteDate(start);
  const endMinute = toMinuteDate(end);
  if (endMinute <= startMinute) {
    return [];
  }

  const matches = [];
  const times = normalizeTimeTokens(schedule);
  const cursor = new Date(startMinute);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= endMinute) {
    if (matchesDays(cursor, days)) {
      for (const fixedTime of times) {
        const [hours, minutes] = fixedTime.split(":").map(Number);
        const candidate = new Date(cursor);
        candidate.setHours(hours, minutes, 0, 0);

        if (candidate > startMinute && candidate < endMinute) {
          matches.push(candidate);
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return matches.sort((left, right) => left.getTime() - right.getTime());
}

function getStatusFilePath(aiOsDir, clientId, slug) {
  return path.join(getWorkspacePaths(aiOsDir, clientId).statusDir, `${slug}.json`);
}

function readRunStatus(aiOsDir, clientId, slug) {
  const statusPath = getStatusFilePath(aiOsDir, clientId, slug);
  const data = readJsonFile(statusPath);
  if (!data || !data.last_run || !data.result) {
    return null;
  }

  return {
    lastRun: data.last_run,
    result: data.result,
    duration: data.duration || 0,
    exitCode: data.exit_code || 0,
    runCount: data.run_count || 0,
    failCount: data.fail_count || 0,
  };
}

function readSchemaSql(aiOsDir) {
  try {
    return fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  } catch {
    // Turbopack inlines __dirname as a virtual path in bundled API routes, so
    // fall back to the repo-local command-centre source tree.
    return fs.readFileSync(
      path.join(aiOsDir, "command-centre", "src", "lib", "schema.sql"),
      "utf-8"
    );
  }
}

function ensureColumn(db, tableName, columnName, alterSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(alterSql);
  }
}

function runWithDbPath(dbPath, operation) {
  if (!path.isAbsolute(dbPath)) throw new Error("Cron profile database path must be absolute");
  return profileDbPathContext.run(path.resolve(dbPath), operation);
}

function getDb(aiOsDir, explicitDbPath) {
  const dbPath = path.resolve(
    explicitDbPath ||
      profileDbPathContext.getStore() ||
      process.env.AI_OS_PROFILE_DB_PATH ||
      path.join(getDataDir(aiOsDir), "data.db")
  );
  const cachedDb = cachedDbs.get(dbPath);
  if (cachedDb) {
    return cachedDb;
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const hasTasksTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
  ).get();
  if (hasTasksTable) {
    ensureColumn(db, "tasks", "archivedAt", "ALTER TABLE tasks ADD COLUMN archivedAt TEXT");
    ensureColumn(db, "tasks", "archivingAt", "ALTER TABLE tasks ADD COLUMN archivingAt TEXT");
    ensureColumn(db, "tasks", "clientId", "ALTER TABLE tasks ADD COLUMN clientId TEXT");
    ensureColumn(db, "tasks", "workScope", "ALTER TABLE tasks ADD COLUMN workScope TEXT");
  }
  const hasConversationsTable = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'conversations'",
  ).get();
  if (hasConversationsTable) {
    ensureColumn(db, "conversations", "clientId", "ALTER TABLE conversations ADD COLUMN clientId TEXT");
    ensureColumn(db, "conversations", "workScope", "ALTER TABLE conversations ADD COLUMN workScope TEXT");
  }
  db.exec(readSchemaSql(aiOsDir));

  ensureColumn(db, "tasks", "clientId", "ALTER TABLE tasks ADD COLUMN clientId TEXT");
  ensureColumn(db, "tasks", "workScope", "ALTER TABLE tasks ADD COLUMN workScope TEXT");
  ensureColumn(db, "tasks", "archivingAt", "ALTER TABLE tasks ADD COLUMN archivingAt TEXT");
  ensureColumn(db, "tasks", "description", "ALTER TABLE tasks ADD COLUMN description TEXT");
  ensureColumn(db, "tasks", "projectSlug", "ALTER TABLE tasks ADD COLUMN projectSlug TEXT");
  ensureColumn(db, "tasks", "needsInput", "ALTER TABLE tasks ADD COLUMN needsInput INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "tasks", "phaseNumber", "ALTER TABLE tasks ADD COLUMN phaseNumber INTEGER");
  ensureColumn(
    db,
    "tasks",
    "gsdStep",
    "ALTER TABLE tasks ADD COLUMN gsdStep TEXT CHECK (gsdStep IN ('discuss', 'plan', 'execute', 'verify'))"
  );
  ensureColumn(db, "tasks", "cronJobSlug", "ALTER TABLE tasks ADD COLUMN cronJobSlug TEXT");
  ensureColumn(db, "tasks", "claudePid", "ALTER TABLE tasks ADD COLUMN claudePid INTEGER");
  ensureColumn(db, "tasks", "ownedClaudePid", "ALTER TABLE tasks ADD COLUMN ownedClaudePid INTEGER");
  ensureColumn(db, "tasks", "permissionMode", "ALTER TABLE tasks ADD COLUMN permissionMode TEXT DEFAULT 'default'");
  ensureColumn(db, "tasks", "contextSources", "ALTER TABLE tasks ADD COLUMN contextSources TEXT");
  ensureColumn(db, "tasks", "claudeSessionId", "ALTER TABLE tasks ADD COLUMN claudeSessionId TEXT");
  ensureColumn(db, "tasks", "lastReplyAt", "ALTER TABLE tasks ADD COLUMN lastReplyAt TEXT");
  ensureColumn(db, "tasks", "goalGroup", "ALTER TABLE tasks ADD COLUMN goalGroup TEXT");
  db.exec(`
    DROP TRIGGER IF EXISTS tasks_work_scope_immutable;
    DROP TRIGGER IF EXISTS tasks_work_scope_valid;
    CREATE TRIGGER tasks_work_scope_immutable
    BEFORE UPDATE OF workScope, clientId ON tasks
    WHEN OLD.workScope IS NOT NEW.workScope OR OLD.clientId IS NOT NEW.clientId
    BEGIN
      SELECT RAISE(ABORT, 'work_scope_immutable');
    END;
    CREATE TRIGGER tasks_work_scope_valid
    BEFORE INSERT ON tasks
    WHEN NEW.workScope IS NOT NULL AND CASE
      WHEN json_valid(NEW.workScope) = 0 THEN 1
      WHEN json_extract(NEW.workScope, '$.mode') = 'solo' THEN
        json_extract(NEW.workScope, '$.version') IS NOT 1
        OR COALESCE(NEW.clientId, '') <> COALESCE(json_extract(NEW.workScope, '$.clientId'), '')
      WHEN json_extract(NEW.workScope, '$.mode') = 'team' THEN
        json_extract(NEW.workScope, '$.scope.version') IS NOT 1
        OR COALESCE(NEW.clientId, '') <> COALESCE(json_extract(NEW.workScope, '$.scope.clientId'), '')
      ELSE 1
    END
    BEGIN
      SELECT RAISE(ABORT, 'invalid_work_scope');
    END;
  `);

  ensureColumn(db, "cron_runs", "taskId", "ALTER TABLE cron_runs ADD COLUMN taskId TEXT");
  ensureColumn(db, "cron_runs", "trigger", "ALTER TABLE cron_runs ADD COLUMN trigger TEXT DEFAULT 'scheduled'");
  ensureColumn(db, "cron_runs", "clientId", "ALTER TABLE cron_runs ADD COLUMN clientId TEXT");
  ensureColumn(db, "cron_runs", "scheduledFor", "ALTER TABLE cron_runs ADD COLUMN scheduledFor TEXT");
  ensureColumn(db, "cron_runs", "resultSource", "ALTER TABLE cron_runs ADD COLUMN resultSource TEXT");
  ensureColumn(db, "cron_runs", "completionReason", "ALTER TABLE cron_runs ADD COLUMN completionReason TEXT");

  // Fix cron tasks that were incorrectly stored with 'default' permission mode
  db.exec("UPDATE tasks SET permissionMode = 'bypassPermissions' WHERE cronJobSlug IS NOT NULL AND permissionMode = 'default'");

  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_clientId ON tasks(clientId)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_cronJobSlug ON tasks(cronJobSlug)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cron_runs_clientId ON cron_runs(clientId)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_cron_runs_job_client_schedule ON cron_runs(jobSlug, clientId, scheduledFor)");

  cachedDbs.set(dbPath, db);
  return db;
}

function closeCronProfileDatabase(dbPathInput) {
  const dbPath = path.resolve(dbPathInput);
  const db = cachedDbs.get(dbPath);
  if (!db) return true;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
  db.close();
  cachedDbs.delete(dbPath);
  return true;
}

function getCronStats(aiOsDir, slug, clientId) {
  const db = getDb(aiOsDir);
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as totalRuns,
         COALESCE(AVG(durationSec), 0) as avgDurationSec,
         COALESCE(AVG(costUsd), 0) as avgCostUsd
       FROM cron_runs
       WHERE jobSlug = ?
         AND COALESCE(clientId, '') = COALESCE(?, '')`
    )
    .get(slug, normalizeClientId(clientId));

  return {
    totalRuns: row && row.totalRuns ? row.totalRuns : 0,
    avgDurationSec: row && row.avgDurationSec ? row.avgDurationSec : 0,
    avgCostUsd: row && row.avgCostUsd ? row.avgCostUsd : 0,
  };
}

function frontmatterBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

function parseJobFile(aiOsDir, workspace, filePath) {
  const slug = path.basename(filePath, ".md");
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const active = String(parsed.data.active ?? "true").toLowerCase() === "true";
  const retry = Number.parseInt(String(parsed.data.retry ?? "0"), 10);
  const time = String(parsed.data.time ?? "00:00");
  const days = String(parsed.data.days ?? "daily");

  return {
    name: String(parsed.data.name || slug),
    slug,
    description: String(parsed.data.description || ""),
    time,
    days,
    active,
    model: String(parsed.data.model || "sonnet"),
    notify: String(parsed.data.notify || "on_finish"),
    timeout: String(parsed.data.timeout || DEFAULT_TIMEOUT),
    retry: Number.isFinite(retry) ? retry : 0,
    memoryCapture: frontmatterBoolean(parsed.data.memoryCapture, true),
    nextRun: getNextRunForSchedule(time, days, active),
    lastRun: readRunStatus(aiOsDir, workspace.clientId, slug),
    stats: getCronStats(aiOsDir, slug, workspace.clientId),
    prompt: parsed.content.trim(),
    clientId: workspace.clientId,
    workspaceKey: workspace.workspaceKey,
    workspaceLabel: workspace.label,
    workspaceDir: workspace.workspaceDir,
  };
}

function listCronJobs(aiOsDir, clientId) {
  const workspace = getWorkspaceDescriptor(aiOsDir, clientId);
  const jobsDir = path.join(workspace.workspaceDir, "cron", "jobs");

  try {
    return fs
      .readdirSync(jobsDir)
      .filter((fileName) => fileName.endsWith(".md"))
      .map((fileName) => parseJobFile(aiOsDir, workspace, path.join(jobsDir, fileName)));
  } catch {
    return [];
  }
}

function listAllCronJobs(aiOsDir) {
  return listWorkspaceDescriptors(aiOsDir).flatMap((workspace) => listCronJobs(aiOsDir, workspace.clientId));
}

function resolveUniqueJob(aiOsDir, slug, clientId) {
  const normalizedClientId = normalizeClientId(clientId);
  if (clientId !== undefined) {
    const workspace = getWorkspaceDescriptor(aiOsDir, normalizedClientId);
    const filePath = path.join(workspace.workspaceDir, "cron", "jobs", `${slug}.md`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return parseJobFile(aiOsDir, workspace, filePath);
  }

  const matches = listAllCronJobs(aiOsDir).filter((job) => job.slug === slug);
  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new Error(
      `Cron job slug "${slug}" exists in multiple workspaces. Pass a clientId to disambiguate.`
    );
  }
  return matches[0];
}

function getCronJob(aiOsDir, slug, clientId) {
  return resolveUniqueJob(aiOsDir, slug, clientId);
}

function toSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createCronJob(aiOsDir, clientId, input) {
  const workspace = getWorkspacePaths(aiOsDir, clientId);
  const slug = toSlug(input.name);
  const filePath = path.join(workspace.jobsDir, `${slug}.md`);

  fs.mkdirSync(workspace.jobsDir, { recursive: true });
  const frontmatter = {
    name: input.name,
    description: input.description || "",
    time: input.time,
    days: input.days,
    active: "true",
    model: input.model || "sonnet",
    notify: input.notify || "on_finish",
    timeout: input.timeout || DEFAULT_TIMEOUT,
    retry: String(input.retry ?? 0),
  };

  const content = matter.stringify(String(input.prompt || "").trim(), frontmatter);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);
  return parseJobFile(aiOsDir, workspace, filePath);
}

function updateCronJob(aiOsDir, clientId, slug, input) {
  const workspace = getWorkspacePaths(aiOsDir, clientId);
  const filePath = path.join(workspace.jobsDir, `${slug}.md`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);

  if (input.name !== undefined) parsed.data.name = input.name;
  if (input.description !== undefined) parsed.data.description = input.description;
  if (input.time !== undefined) parsed.data.time = input.time;
  if (input.days !== undefined) parsed.data.days = input.days;
  if (input.active !== undefined) parsed.data.active = String(input.active);
  if (input.model !== undefined) parsed.data.model = input.model;
  if (input.notify !== undefined) parsed.data.notify = input.notify;
  if (input.timeout !== undefined) parsed.data.timeout = input.timeout;
  if (input.retry !== undefined) parsed.data.retry = String(input.retry);
  if (input.memoryCapture !== undefined) parsed.data.memoryCapture = String(input.memoryCapture);

  const nextPrompt = input.prompt !== undefined ? String(input.prompt).trim() : parsed.content.trim();
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, matter.stringify(nextPrompt, parsed.data), "utf-8");
  fs.renameSync(tempPath, filePath);

  return parseJobFile(aiOsDir, workspace, filePath);
}

function deleteCronJob(aiOsDir, clientId, slug) {
  const workspace = getWorkspacePaths(aiOsDir, clientId);
  fs.rmSync(path.join(workspace.jobsDir, `${slug}.md`), { force: true });
}

function getCronRunHistory(aiOsDir, slug, clientId) {
  const normalizedClientId = normalizeClientId(clientId);
  const db = getDb(aiOsDir);
  const rows = db
    .prepare(
      `SELECT id, jobSlug, taskId, startedAt, completedAt, result, resultSource, completionReason, durationSec, costUsd, exitCode, trigger
       FROM cron_runs
       WHERE jobSlug = ?
         AND COALESCE(clientId, '') = COALESCE(?, '')
       ORDER BY startedAt DESC
       LIMIT 50`
    )
    .all(slug, normalizedClientId);

  if (rows.length > 0) {
    return rows.map((row) => {
      let outputs = [];
      if (row.taskId) {
        outputs = db
          .prepare(
            `SELECT fileName, filePath, extension
             FROM task_outputs
             WHERE taskId = ?
             ORDER BY createdAt ASC`
          )
          .all(row.taskId);
      }

      return {
        ...row,
        trigger: row.trigger || "scheduled",
        resultSource: normalizeCronRunResultSource(row.resultSource),
        completionReason: normalizeCronRunCompletionReason(row.completionReason),
        outputs,
      };
    });
  }

  const status = readRunStatus(aiOsDir, normalizedClientId, slug);
  if (!status) return [];

  const startedAt = status.lastRun;
  const durationSec = status.duration || 0;
  const completedAt = new Date(new Date(startedAt).getTime() + durationSec * 1000).toISOString();

  return [
    {
      id: -1,
      jobSlug: slug,
      taskId: null,
      startedAt,
      completedAt,
      result: status.result,
      durationSec,
      costUsd: 0,
      exitCode: status.exitCode || 0,
      trigger: "scheduled",
      resultSource: null,
      completionReason: null,
      outputs: [],
    },
  ];
}

function getRawJobFile(aiOsDir, slug, clientId) {
  try {
    const job = resolveUniqueJob(aiOsDir, slug, clientId);
    if (!job) return null;
    return fs.readFileSync(path.join(job.workspaceDir, "cron", "jobs", `${job.slug}.md`), "utf-8");
  } catch {
    return null;
  }
}

function getCronJobLog(aiOsDir, slug, clientId) {
  try {
    const workspace = getWorkspacePaths(aiOsDir, clientId);
    const content = fs.readFileSync(path.join(workspace.logsDir, `${slug}.log`), "utf-8");
    if (content.length > 50_000) {
      return `... (truncated)\n${content.slice(-50_000)}`;
    }
    return content;
  } catch {
    return "";
  }
}

function appendCronLog(aiOsDir, clientId, slug, line) {
  const workspace = getWorkspacePaths(aiOsDir, clientId);
  fs.mkdirSync(workspace.logsDir, { recursive: true });
  fs.appendFileSync(path.join(workspace.logsDir, `${slug}.log`), `${line}${line.endsWith("\n") ? "" : "\n"}`, "utf-8");
}

function readRuntimeRecord(aiOsDir) {
  return readJsonFile(getRuntimePaths(aiOsDir).lockPath);
}

function readDaemonPid(aiOsDir) {
  const raw = (() => {
    try {
      return fs.readFileSync(getRuntimePaths(aiOsDir).pidPath, "utf-8").trim();
    } catch {
      return "";
    }
  })();

  if (!raw) return null;
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) ? pid : null;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRuntimeRecordStale(record, now = Date.now()) {
  if (!record || !record.heartbeatAt) {
    return true;
  }

  const heartbeatAt = Date.parse(record.heartbeatAt);
  if (!Number.isFinite(heartbeatAt)) {
    return true;
  }

  return now - heartbeatAt > RUNTIME_STALE_MS;
}

function writeDaemonPid(aiOsDir, pid) {
  writeFileAtomically(getRuntimePaths(aiOsDir).pidPath, String(pid));
}

function claimDaemonPid(aiOsDir, pid) {
  const pidPath = getRuntimePaths(aiOsDir).pidPath;
  return writeFileExclusivelyAtomically(pidPath, String(pid));
}

function removeDaemonPid(aiOsDir, expectedPid = null) {
  if (expectedPid === null) return false;
  return removeFileIfMatchesAtomically(
    getRuntimePaths(aiOsDir).pidPath,
    (contents) => {
      return Number.parseInt(String(contents).trim(), 10) === expectedPid;
    },
  );
}

function normalizeCronRunResultSource(value) {
  return CRON_RUN_RESULT_SOURCES.has(value) ? value : null;
}

function normalizeCronRunCompletionReason(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getDefaultCompletionReason(result, resultSource) {
  if (resultSource === "inferred") {
    return "recovered_inferred_state";
  }

  switch (result) {
    case "timeout":
      return "timed_out";
    case "failure":
      return "failed";
    case "success":
      return "completed";
    default:
      return null;
  }
}

function buildRecoveredCronRunUpdate(completionReason, details = {}) {
  const result = details.result === "timeout" ? "timeout" : "failure";
  const durationSec =
    details.durationSec !== undefined
      ? details.durationSec
      : details.durationMs !== undefined
        ? Math.round(details.durationMs / 1000)
        : 0;
  const normalizedCompletionReason =
    normalizeCronRunCompletionReason(completionReason) || "recovered_inferred_state";

  return {
    completedAt: details.completedAt || new Date().toISOString(),
    result,
    resultSource: "inferred",
    completionReason: normalizedCompletionReason,
    durationSec,
    costUsd: details.costUsd ?? null,
    exitCode:
      details.exitCode !== undefined
        ? details.exitCode
        : result === "timeout"
          ? 124
          : 1,
  };
}

function toRuntimeLabel(runtime) {
  switch (runtime) {
    case "daemon":
      return "Daemon";
    case "in-process":
      return "In-process runtime";
    default:
      return "No runtime";
  }
}

function buildRuntimeStatusSummary(status) {
  switch (status.ownershipReason) {
    case "local-leader-active":
      return "This runtime currently owns cron scheduling.";
    case "external-leader-active":
      return `${toRuntimeLabel(status.runtime)} currently owns cron scheduling${status.localRuntimePresent ? "; this runtime is standby." : "."}`;
    case "stale-leader-record":
      return status.localRuntimePresent
        ? "A stale cron leader record was found; this runtime is running but not yet the owner."
        : "A stale cron leader record was found; no active cron owner is confirmed.";
    case "daemon-process-without-lock":
      return status.localRuntimePresent
        ? "A daemon process exists, but there is no active cron leader record; this runtime is currently standby."
        : "A daemon process exists, but there is no active cron leader record.";
    case "local-runtime-without-leader":
      return "This runtime is available, but no cron leader is active yet.";
    default:
      return "No cron runtime is active.";
  }
}

function deriveManagedRuntimeStatus(aiOsDir, localIdentifier) {
  const commands = getRuntimeCommands();
  const workspaceCount = listWorkspaceDescriptors(aiOsDir).length;
  const current = readRuntimeRecord(aiOsDir);
  const leaderState = !current
    ? "absent"
    : isRuntimeRecordStale(current)
      ? "stale"
      : "active";
  const activeLeader = leaderState === "active" ? current : null;
  const daemonPid = readDaemonPid(aiOsDir);
  const daemonProcessPresent = Boolean(daemonPid && isProcessAlive(daemonPid));
  const localRuntimePresent = Boolean(localIdentifier);
  const runtime = activeLeader
    ? activeLeader.runtime
    : daemonProcessPresent
      ? "daemon"
      : localRuntimePresent
        ? "in-process"
        : "stopped";
  const leader = activeLeader
    ? localIdentifier
      ? activeLeader.identifier === localIdentifier
      : true
    : false;

  let ownershipReason = "no-runtime-detected";
  if (activeLeader) {
    ownershipReason =
      localIdentifier && activeLeader.identifier === localIdentifier
        ? "local-leader-active"
        : "external-leader-active";
  } else if (leaderState === "stale") {
    ownershipReason = "stale-leader-record";
  } else if (daemonProcessPresent) {
    ownershipReason = "daemon-process-without-lock";
  } else if (localRuntimePresent) {
    ownershipReason = "local-runtime-without-leader";
  }

  const status = {
    runtime,
    leader,
    leaderState,
    identifier:
      activeLeader?.identifier ||
      current?.identifier ||
      (daemonProcessPresent ? `daemon-${daemonPid}` : localIdentifier || null),
    localRuntimePresent,
    ownershipReason,
    startCommand: activeLeader?.startCommand || commands.startCommand,
    stopCommand: activeLeader?.stopCommand || commands.stopCommand,
    statusCommand: commands.statusCommand,
    logsCommand: commands.logsCommand,
    workspaceCount: activeLeader?.workspaceCount || current?.workspaceCount || workspaceCount,
    heartbeatAt: current?.heartbeatAt || null,
    pid: activeLeader?.pid || (daemonProcessPresent ? daemonPid : localRuntimePresent ? process.pid : null),
  };

  return {
    ...status,
    statusSummary: buildRuntimeStatusSummary(status),
  };
}

function claimRuntimeLeadership(aiOsDir, candidate) {
  const runtimePaths = getRuntimePaths(aiOsDir);
  const commands = getRuntimeCommands();
  const nowIso = new Date().toISOString();
  const record = {
    runtime: candidate.runtime,
    leader: true,
    identifier: candidate.identifier,
    pid: candidate.pid || process.pid,
    startedAt: candidate.startedAt || nowIso,
    heartbeatAt: nowIso,
    lastSweepAt: candidate.lastSweepAt || null,
    workspaceCount: candidate.workspaceCount || listWorkspaceDescriptors(aiOsDir).length,
    startCommand: commands.startCommand,
    stopCommand: commands.stopCommand,
    profileKey: candidate.profileKey || null,
    startToken: candidate.startToken || null,
  };

  if (
    writeFileExclusivelyAtomically(
      runtimePaths.lockPath,
      JSON.stringify(record, null, 2),
    )
  ) {
    return record;
  }

  const current = readRuntimeRecord(aiOsDir);
  if (!current) {
    removeFileIfMatchesAtomically(runtimePaths.lockPath, (contents) => {
      try {
        const parsed = JSON.parse(contents);
        return !parsed || typeof parsed !== "object";
      } catch {
        return true;
      }
    });
    return claimRuntimeLeadership(aiOsDir, candidate);
  }

  if (current.identifier === candidate.identifier) {
    if (
      current.runtime !== record.runtime ||
      current.pid !== record.pid ||
      (record.profileKey && current.profileKey !== record.profileKey) ||
      (record.startToken && current.startToken !== record.startToken)
    ) {
      return null;
    }
    const updated = {
      ...current,
      ...record,
      startedAt: current.startedAt || record.startedAt,
      heartbeatAt: nowIso,
    };
    const replaced = replaceFileIfMatchesAtomically(
      runtimePaths.lockPath,
      (contents) => {
        try {
          return JSON.stringify(JSON.parse(contents)) === JSON.stringify(current);
        } catch {
          return false;
        }
      },
      () => JSON.stringify(updated, null, 2),
    );
    return replaced ? updated : claimRuntimeLeadership(aiOsDir, candidate);
  }

  if (isRuntimeRecordStale(current)) {
    const removed = removeFileIfMatchesAtomically(runtimePaths.lockPath, (contents) => {
      let claimed;
      try {
        claimed = JSON.parse(contents);
      } catch {
        return false;
      }
      return (
        JSON.stringify(claimed) === JSON.stringify(current) &&
        isRuntimeRecordStale(claimed)
      );
    });
    if (!removed) {
      // A replacement won the race. Re-enter through the exclusive-create
      // path and evaluate that new owner instead of unlinking it.
      return claimRuntimeLeadership(aiOsDir, candidate);
    }
    return claimRuntimeLeadership(aiOsDir, candidate);
  }

  return null;
}

function refreshRuntimeHeartbeat(aiOsDir, identifier, updates = {}, expected = {}) {
  const runtimePaths = getRuntimePaths(aiOsDir);
  const current = readRuntimeRecord(aiOsDir);
  if (
    !current ||
    current.identifier !== identifier ||
    (expected.pid && current.pid !== expected.pid) ||
    (expected.profileKey && current.profileKey !== expected.profileKey) ||
    (expected.startToken && current.startToken !== expected.startToken)
  ) {
    return null;
  }

  const updated = {
    ...current,
    ...updates,
    heartbeatAt: new Date().toISOString(),
  };
  const replaced = replaceFileIfMatchesAtomically(
    runtimePaths.lockPath,
    (contents) => {
      try {
        return JSON.stringify(JSON.parse(contents)) === JSON.stringify(current);
      } catch {
        return false;
      }
    },
    () => JSON.stringify(updated, null, 2),
  );
  return replaced ? updated : null;
}

function releaseRuntimeLeadership(aiOsDir, identifier, expected = {}) {
  const runtimePaths = getRuntimePaths(aiOsDir);
  return removeFileIfMatchesAtomically(runtimePaths.lockPath, (contents) => {
    let current;
    try {
      current = JSON.parse(contents);
    } catch {
      return false;
    }
    return Boolean(
      current &&
        current.identifier === identifier &&
        (!expected.pid || current.pid === expected.pid) &&
        (!expected.profileKey || current.profileKey === expected.profileKey) &&
        (!expected.startToken || current.startToken === expected.startToken),
    );
  });
}

function getManagedRuntimeStatus(aiOsDir, localIdentifier) {
  return deriveManagedRuntimeStatus(aiOsDir, localIdentifier);
}

function getNextBacklogOrder(db) {
  const row = db
    .prepare("SELECT COALESCE(MIN(columnOrder), 1) as minOrder FROM tasks WHERE status = 'backlog'")
    .get();
  return (row && row.minOrder) ? row.minOrder - 1 : 0;
}

function enqueueCronJob(aiOsDir, job, options = {}) {
  const db = getDb(aiOsDir);
  const now = new Date().toISOString();
  const normalizedClientId = normalizeClientId(job.clientId);
  const scheduledFor = options.scheduledFor ? toMinuteIso(new Date(options.scheduledFor)) : toMinuteIso(new Date());

  if (options.dedupeByMinute) {
    const existing = db
      .prepare(
        `SELECT taskId, id
         FROM cron_runs
         WHERE jobSlug = ?
           AND COALESCE(clientId, '') = COALESCE(?, '')
           AND scheduledFor = ?
         LIMIT 1`
      )
      .get(job.slug, normalizedClientId, scheduledFor);

    if (existing) {
      return {
        duplicate: true,
        cronRunId: existing.id,
        task: existing.taskId
          ? db.prepare("SELECT * FROM tasks WHERE id = ?").get(existing.taskId)
          : null,
      };
    }
  }

  const task = {
    id: randomUUID(),
    title: options.title || `${job.name}${options.titleSuffix || ""}`,
    description: job.prompt,
    status: "queued",
    level: "task",
    parentId: null,
    projectSlug: null,
    columnOrder: getNextBacklogOrder(db),
    createdAt: now,
    updatedAt: now,
    costUsd: null,
    tokensUsed: null,
    durationMs: null,
    activityLabel: options.activityLabel || `Queued — ${options.trigger || "scheduled"}`,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    clientId: normalizedClientId,
    workScope: JSON.stringify({ mode: "solo", version: 1, clientId: normalizedClientId }),
    needsInput: 0,
    phaseNumber: null,
    gsdStep: null,
    cronJobSlug: job.slug,
    permissionMode: "bypassPermissions",
  };

  db.prepare(
    `INSERT INTO tasks (
      id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt,
      updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt,
      completedAt, clientId, workScope, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.id,
    task.title,
    task.description,
    task.status,
    task.level,
    task.parentId,
    task.projectSlug,
    task.columnOrder,
    task.createdAt,
    task.updatedAt,
    task.costUsd,
    task.tokensUsed,
    task.durationMs,
    task.activityLabel,
    task.errorMessage,
    task.startedAt,
    task.completedAt,
    task.clientId,
    task.workScope,
    task.needsInput,
    task.phaseNumber,
    task.gsdStep,
    task.cronJobSlug,
    task.permissionMode
  );

  const cronRun = db
    .prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, resultSource, completionReason, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', NULL, NULL, ?, ?, ?)
       RETURNING id`
    )
    .get(job.slug, task.id, now, options.trigger || "scheduled", normalizedClientId, scheduledFor);

  return {
    duplicate: false,
    task: db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id),
    cronRunId: cronRun ? cronRun.id : null,
    scheduledFor,
  };
}

function updateCronStatusFile(aiOsDir, clientId, slug, payload) {
  const statusPath = getStatusFilePath(aiOsDir, clientId, slug);
  const existing = readJsonFile(statusPath) || { run_count: 0, fail_count: 0 };

  writeJsonFileAtomic(statusPath, {
    last_run: payload.completedAt,
    result: payload.result,
    duration: payload.durationSec,
    exit_code: payload.exitCode,
    run_count: Number(existing.run_count || 0) + 1,
    fail_count: Number(existing.fail_count || 0) + (payload.result === "success" ? 0 : 1),
  });
}

function completeCronRunForTask(aiOsDir, task, payload = {}) {
  if (!task || !task.cronJobSlug) {
    return;
  }

  const db = getDb(aiOsDir);
  const completedAt = payload.completedAt || new Date().toISOString();
  const durationSec = payload.durationSec ?? Math.round((payload.durationMs || 0) / 1000);
  const result = payload.result || (task.errorMessage ? "failure" : "success");
  const resultSource = normalizeCronRunResultSource(payload.resultSource) || "observed";
  const completionReason =
    normalizeCronRunCompletionReason(payload.completionReason) ||
    getDefaultCompletionReason(result, resultSource);
  const exitCode =
    payload.exitCode !== undefined
      ? payload.exitCode
      : result === "success"
        ? 0
        : result === "timeout"
          ? 124
          : 1;
  const normalizedClientId = normalizeClientId(task.clientId);

  const existing = db
    .prepare("SELECT id FROM cron_runs WHERE taskId = ? AND result = 'running' LIMIT 1")
    .get(task.id);

  if (existing) {
    db.prepare(
      `UPDATE cron_runs
       SET completedAt = ?, result = ?, resultSource = ?, completionReason = ?, durationSec = ?, costUsd = ?, exitCode = ?, clientId = COALESCE(clientId, ?)
       WHERE id = ?`
    ).run(
      completedAt,
      result,
      resultSource,
      completionReason,
      durationSec,
      payload.costUsd ?? null,
      exitCode,
      normalizedClientId,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO cron_runs (
         jobSlug, taskId, startedAt, completedAt, result, resultSource, completionReason, durationSec, costUsd, exitCode,
         trigger, clientId, scheduledFor
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.cronJobSlug,
      task.id,
      task.startedAt || completedAt,
      completedAt,
      result,
      resultSource,
      completionReason,
      durationSec,
      payload.costUsd ?? null,
      exitCode,
      payload.trigger || "scheduled",
      normalizedClientId,
      payload.scheduledFor || (task.startedAt ? toMinuteIso(new Date(task.startedAt)) : toMinuteIso(new Date(completedAt)))
    );
  }

  updateCronStatusFile(aiOsDir, normalizedClientId, task.cronJobSlug, {
    completedAt,
    result,
    durationSec,
    exitCode,
  });
}

function normalizeCronNotificationResult(result) {
  if (result === "success") {
    return "success";
  }
  if (result === "timeout") {
    return "timeout";
  }
  return "failure";
}

function formatCronNotificationDuration(durationMs) {
  const durationSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  return `${durationSeconds}s`;
}

function shouldSendCronNotification(notifySetting, result) {
  const policy = String(notifySetting || "on_finish").trim().toLowerCase();
  const normalizedResult = normalizeCronNotificationResult(result);

  if (policy === "silent") {
    return false;
  }

  if (policy === "on_failure") {
    return normalizedResult === "failure" || normalizedResult === "timeout";
  }

  return (
    normalizedResult === "success" ||
    normalizedResult === "failure" ||
    normalizedResult === "timeout"
  );
}

function defaultWindowsCronNotificationSender(aiOsDir, notification) {
  return new Promise((resolve, reject) => {
    const notifyScriptPath = path.join(aiOsDir, "scripts", "windows-notify.ps1");
    if (!fs.existsSync(notifyScriptPath)) {
      resolve({ sent: false, skipped: true, reason: "missing-script" });
      return;
    }

    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        notifyScriptPath,
        "-Channel",
        "cron",
        "-Event",
        notification.event,
        "-ContextJson",
        JSON.stringify(notification.context),
      ],
      {
        cwd: aiOsDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code || 0) !== 0) {
        const message =
          stderr.trim() || stdout.trim() || `Notification helper exited with code ${code}`;
        reject(new Error(message));
        return;
      }

      resolve({
        sent: true,
        event: notification.event,
        output: stdout.trim(),
      });
    });
  });
}

async function maybeSendWindowsCronNotification(aiOsDir, job, payload = {}) {
  const result = normalizeCronNotificationResult(payload.result);
  const notifySetting = payload.notifySetting || job?.notify || "on_failure";

  if (!shouldSendCronNotification(notifySetting, result)) {
    return {
      sent: false,
      skipped: true,
      reason: "policy",
      event: result,
    };
  }

  if (getRuntimePlatform() !== "win32") {
    return {
      sent: false,
      skipped: true,
      reason: "platform",
      event: result,
    };
  }

  const notificationSender =
    runtimeHooks.notificationSender || defaultWindowsCronNotificationSender;
  const jobName = payload.jobName || job?.name || job?.slug || "Scheduled task";
  const clientLabel =
    payload.clientLabel || job?.workspaceLabel || toClientLabel(job?.clientId);
  const exitCode =
    payload.exitCode !== undefined
      ? payload.exitCode
      : result === "success"
        ? 0
        : result === "timeout"
          ? 124
          : 1;

  return notificationSender(aiOsDir, {
    event: result,
    job,
    payload,
    context: {
      status:
        payload.status ||
        (result === "success"
          ? "Task complete"
          : result === "timeout"
            ? "Timed out"
            : "Needs attention"),
      subject: payload.subject || jobName,
      detail: payload.detail || payload.errorMessage || "",
      duration: payload.duration || formatCronNotificationDuration(payload.durationMs),
      clientLabel,
      jobName,
      exitCode,
      timeout: payload.timeout || job?.timeout || DEFAULT_TIMEOUT,
      catchUpSuffix: payload.catchUpSuffix || "",
    },
  });
}

async function finalizeCronExecutionOutcome(aiOsDir, job, taskId, payload = {}) {
  const completedAt = payload.completedAt || new Date().toISOString();
  const durationMs = payload.durationMs ?? 0;
  const result = normalizeCronNotificationResult(payload.result);
  const exitCode =
    payload.exitCode !== undefined
      ? payload.exitCode
      : result === "success"
        ? 0
        : result === "timeout"
          ? 124
          : 1;

  for (const line of Array.isArray(payload.logLines) ? payload.logLines : []) {
    if (line && job?.slug) {
      appendCronLog(aiOsDir, job.clientId, job.slug, line);
    }
  }

  if (job?.slug) {
    appendCronLog(
      aiOsDir,
      job.clientId,
      job.slug,
      `=== [${completedAt}] ${result.toUpperCase()}: ${job.name} (${Math.round(durationMs / 1000)}s) ===`
    );
  }

  const updatedTask = finalizeTask(aiOsDir, taskId, {
    result,
    errorMessage: payload.errorMessage || null,
    durationMs,
    completedAt,
    status: payload.status,
    activityLabel:
      payload.activityLabel ||
      (payload.needsInput
        ? "Waiting for your reply"
        : result === "success"
          ? "Scheduled job completed"
          : result === "timeout"
            ? `Timed out after ${job?.timeout || DEFAULT_TIMEOUT}`
            : `Failed with exit code ${exitCode}`),
    needsInput: Boolean(payload.needsInput),
  });

  completeCronRunForTask(aiOsDir, updatedTask, {
    result,
    exitCode,
    durationMs,
    completedAt,
    trigger: payload.trigger,
    scheduledFor: payload.scheduledFor,
    resultSource: payload.resultSource,
    completionReason: payload.completionReason,
    costUsd: payload.costUsd,
  });

  let notification = {
    sent: false,
    skipped: true,
    reason: "not-attempted",
    event: result,
  };

  try {
    notification = await maybeSendWindowsCronNotification(aiOsDir, job, {
      ...payload,
      result,
      exitCode,
      durationMs,
      completedAt,
    });
  } catch (error) {
    notification = {
      sent: false,
      skipped: false,
      event: result,
      error: error instanceof Error ? error.message : String(error),
    };

    if (job?.slug) {
      appendCronLog(
        aiOsDir,
        job.clientId,
        job.slug,
        `[cron-daemon] Notification failed: ${notification.error}`
      );
    }
  }

  return {
    task: updatedTask,
    result,
    exitCode,
    durationMs,
    notification,
  };
}

function parseTimeoutToMs(timeoutValue) {
  const raw = String(timeoutValue || DEFAULT_TIMEOUT).trim();
  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }
  if (/^\d+s$/.test(raw)) {
    return Number(raw.slice(0, -1)) * 1000;
  }
  if (/^\d+m$/.test(raw)) {
    return Number(raw.slice(0, -1)) * 60 * 1000;
  }
  if (/^\d+h$/.test(raw)) {
    return Number(raw.slice(0, -1)) * 60 * 60 * 1000;
  }
  return 30 * 60 * 1000;
}

function resolveCommandOnWindowsPath(command, env = process.env) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    return null;
  }

  if (typeof runtimeHooks.findCommandOnPath === "function") {
    const hookedPath = runtimeHooks.findCommandOnPath(normalizedCommand, env);
    if (hookedPath) {
      return hookedPath;
    }
  }

  if (path.isAbsolute(normalizedCommand) || normalizedCommand.includes("\\") || normalizedCommand.includes("/")) {
    return normalizedCommand;
  }

  try {
    const lookup = spawnSync("where.exe", [normalizedCommand], {
      env,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    });

    if (lookup.status === 0) {
      const match = String(lookup.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (match) {
        return match;
      }
    }
  } catch {
    // Best-effort lookup only.
  }

  return null;
}

function resolveGitBashPath(env = process.env) {
  if (env.CLAUDE_CODE_GIT_BASH_PATH) {
    return env.CLAUDE_CODE_GIT_BASH_PATH;
  }

  const discoveredPath =
    resolveCommandOnWindowsPath("bash.exe", env) ||
    resolveCommandOnWindowsPath("bash", env);
  const candidates = [discoveredPath, ...WINDOWS_GIT_BASH_CANDIDATES].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveWindowsClaudeLaunchPlan({ claudeCommand, env = process.env }) {
  const configuredCommand = String(claudeCommand || "").trim() || "claude";
  const normalizedCommand = configuredCommand.toLowerCase();
  const resolvedCommandPath = resolveCommandOnWindowsPath(configuredCommand, env);
  const commandToRun = resolvedCommandPath || configuredCommand;
  const extension = path.extname(commandToRun).toLowerCase();
  const childEnv = { ...env };
  const gitBashPath = resolveGitBashPath(childEnv);

  if (gitBashPath && !childEnv.CLAUDE_CODE_GIT_BASH_PATH) {
    childEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
  }

  if (
    normalizedCommand === "claude" ||
    normalizedCommand === "claude.exe" ||
    extension === ".exe"
  ) {
    return {
      mode: "direct",
      command: commandToRun,
      env: childEnv,
      resolvedCommandPath,
      extension,
    };
  }

  if (extension === ".cmd" || extension === ".bat" || extension === ".ps1") {
    return {
      mode: "wrapper",
      command: commandToRun,
      env: childEnv,
      resolvedCommandPath,
      extension,
    };
  }

  return {
    mode: "direct",
    command: commandToRun,
    env: childEnv,
    resolvedCommandPath,
    extension,
  };
}

function buildWrapperEnvironmentOverrides(env = {}) {
  const overrides = {};
  for (const key of [
    "AI_OS_DIR",
    "AI_OS_CRON_JOB_SLUG",
    "AI_OS_SKIP_MEMORY_CAPTURE",
    "AI_OS_TASK_ID",
    "CLAUDE_CODE_GIT_BASH_PATH",
  ]) {
    if (env[key]) {
      overrides[key] = env[key];
    }
  }
  return overrides;
}

function walkFiles(rootDir, callback, relativePrefix = "") {
  if (!fs.existsSync(rootDir)) {
    return;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    const relativePath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;

    if (entry.isDirectory()) {
      if (OUTPUT_SCAN_IGNORES.has(entry.name)) {
        continue;
      }
      walkFiles(fullPath, callback, relativePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    callback(fullPath, relativePath);
  }
}

function normalizeRelativePathForMatch(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/");
}

function isRelativePathInside(relativePath, parentRelativePath) {
  const normalizedRelativePath = normalizeRelativePathForMatch(relativePath);
  const normalizedParentPath = normalizeRelativePathForMatch(parentRelativePath);

  if (!normalizedParentPath) {
    return false;
  }

  return (
    normalizedRelativePath === normalizedParentPath ||
    normalizedRelativePath.startsWith(`${normalizedParentPath}/`)
  );
}

function takeFileSnapshot(rootDir, options = {}) {
  const snapshot = new Map();
  const {
    roots = null,
    excludeRelativePath = null,
  } = options;

  const recordFile = (fullPath, relativePath) => {
    if (excludeRelativePath && isRelativePathInside(relativePath, excludeRelativePath)) {
      return;
    }

    const stat = fs.statSync(fullPath);
    snapshot.set(relativePath, `${stat.size}:${stat.mtimeMs}`);
  };

  if (Array.isArray(roots) && roots.length > 0) {
    for (const rootName of roots) {
      const snapshotRootDir = path.join(rootDir, rootName);
      walkFiles(snapshotRootDir, recordFile, rootName);
    }
  } else {
    walkFiles(rootDir, recordFile);
  }

  return snapshot;
}

function collectChangedFiles(rootDir, beforeSnapshot, startMs, endMs, options = {}) {
  const files = [];
  const {
    roots = null,
    excludeRelativePath = null,
  } = options;

  const collectFile = (fullPath, relativePath) => {
    if (excludeRelativePath && isRelativePathInside(relativePath, excludeRelativePath)) {
      return;
    }

    const stat = fs.statSync(fullPath);
    const previous = beforeSnapshot.get(relativePath);
    const current = `${stat.size}:${stat.mtimeMs}`;

    if (previous === current) {
      return;
    }

    if (stat.mtimeMs < startMs - 2_000 || stat.mtimeMs > endMs + 2_000) {
      return;
    }

    files.push({
      fileName: path.basename(fullPath),
      filePath: fullPath,
      relativePath,
      extension: path.extname(fullPath).replace(/^\./, ""),
      sizeBytes: stat.size,
    });
  };

  if (Array.isArray(roots) && roots.length > 0) {
    for (const rootName of roots) {
      const collectRootDir = path.join(rootDir, rootName);
      walkFiles(collectRootDir, collectFile, rootName);
    }
  } else {
    walkFiles(rootDir, collectFile);
  }

  return files;
}

function takeOutputSnapshot(workspaceDir) {
  return takeFileSnapshot(workspaceDir, { roots: OUTPUT_SCAN_ROOTS });
}

function collectOutputFiles(workspaceDir, beforeSnapshot, startMs, endMs) {
  return collectChangedFiles(workspaceDir, beforeSnapshot, startMs, endMs, {
    roots: OUTPUT_SCAN_ROOTS,
  });
}

function collectOutsideWorkspaceMutations(aiOsDir, workspaceDir, beforeSnapshot, startMs, endMs) {
  const workspaceRelativePath = path.relative(aiOsDir, workspaceDir);
  return collectChangedFiles(aiOsDir, beforeSnapshot, startMs, endMs, {
    excludeRelativePath: workspaceRelativePath,
  });
}

function buildCronExecutionPrompt(job, workspace) {
  const basePrompt = String(job.prompt || "").trim();
  // Scheduled jobs run without the user watching, so they carry the autonomous
  // counterpart to the interactive "answer vs action" boundary in AGENTS.md:
  // proceed on reversible work rather than stopping to ask, and only pause for
  // destructive actions or genuine scope changes.
  const autonomy =
    "You are operating autonomously as a scheduled job. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to...?' or 'Shall I...?' will block the work. For reversible actions that follow from this job's task, proceed without asking. Stop only for destructive actions or genuine scope changes the user must decide.";

  if (!workspace.clientId) {
    return [autonomy, basePrompt].filter(Boolean).join("\n\n");
  }

  return [
    autonomy,
    `You are running a scheduled job inside the client workspace "${workspace.label}".`,
    `Workspace root: ${workspace.workspaceDir}`,
    "Stay inside this workspace for all reads and writes.",
    'When creating output files, use explicit client-local paths such as "projects/..." inside the current workspace.',
    "Do not create or update files in the root workspace or in another client workspace.",
    basePrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatOutputLeakMessage(files) {
  const paths = files.map((file) => file.relativePath).slice(0, 5);
  const suffix = files.length > 5 ? ` (+${files.length - 5} more)` : "";
  return `Client cron job touched files outside its workspace: ${paths.join(", ")}${suffix}`;
}

function persistTaskOutputs(aiOsDir, taskId, files) {
  const db = getDb(aiOsDir);
  db.prepare("DELETE FROM task_outputs WHERE taskId = ?").run(taskId);

  for (const file of files) {
    db.prepare(
      `INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      taskId,
      file.fileName,
      file.filePath,
      file.relativePath,
      file.extension,
      file.sizeBytes,
      new Date().toISOString()
    );
  }
}

// Cron tasks are claimed by the runtime itself so UI-led and daemon-led
// dispatchers follow the same single-owner execution contract.
function claimQueuedCronTask(aiOsDir, taskId) {
  const db = getDb(aiOsDir);
  const now = new Date().toISOString();
  const claimed = db.prepare(
    `UPDATE tasks
     SET status = 'running',
         startedAt = COALESCE(startedAt, ?),
         updatedAt = ?,
         activityLabel = 'Running scheduled job...',
         errorMessage = NULL,
         needsInput = 0
     WHERE id = ?
       AND status = 'queued'`
  ).run(now, now, taskId);

  if (!claimed.changes) {
    return null;
  }

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

function finalizeTask(aiOsDir, taskId, payload) {
  const db = getDb(aiOsDir);
  const completedAt = payload.completedAt || new Date().toISOString();
  const nextStatus =
    payload.status ||
    (payload.needsInput ? "review" : payload.result === "success" ? "done" : "review");
  const completedAtValue = payload.needsInput ? null : completedAt;
  db.prepare(
    `UPDATE tasks
     SET status = ?,
         updatedAt = ?,
         completedAt = ?,
         durationMs = ?,
         errorMessage = ?,
         activityLabel = ?,
         needsInput = ?,
         claudePid = NULL
     WHERE id = ?`
  ).run(
    nextStatus,
    completedAt,
    completedAtValue,
    payload.durationMs,
    payload.errorMessage || null,
    payload.activityLabel || (payload.result === "success" ? "Completed" : "Failed"),
    payload.needsInput ? 1 : 0,
    taskId
  );

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

function normalizeCronTaskLogContent(type, content) {
  const normalizedLineEndings = String(content ?? "").replace(/\r\n?/g, "\n");
  if (type === "text" || type === "question" || type === "user_reply" || type === "system") {
    return normalizedLineEndings.trim();
  }
  return normalizedLineEndings;
}

function insertCronTaskLog(aiOsDir, taskId, entry) {
  const normalizedContent = normalizeCronTaskLogContent(entry.type, entry.content);
  if (!normalizedContent) {
    return;
  }

  const db = getDb(aiOsDir);
  db.prepare(
    "INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    entry.id || randomUUID(),
    taskId,
    entry.type,
    entry.timestamp || new Date().toISOString(),
    normalizedContent,
    entry.toolName || null,
    entry.toolArgs || null,
    entry.toolResult || null,
    entry.isCollapsed ? 1 : 0,
    entry.questionSpec || null,
    entry.questionAnswers || null
  );
}

function parseCronQuestionSpecs(raw) {
  const validTypes = new Set(["text", "multiline", "select", "multiselect"]);
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.questions)
      ? raw.questions
      : null;

  if (!list) {
    return [];
  }

  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const spec = item;
      if (
        typeof spec.id !== "string" ||
        typeof spec.prompt !== "string" ||
        !validTypes.has(spec.type)
      ) {
        return null;
      }

      return {
        id: spec.id,
        prompt: spec.prompt,
        type: spec.type,
        required: Boolean(spec.required),
        ...(Array.isArray(spec.options)
          ? {
              options: spec.options.filter((option) => typeof option === "string"),
            }
          : {}),
      };
    })
    .filter(Boolean);
}

function detectCronStructuredQuestions(text) {
  const fenceRegex = /```ask-user-questions\s*\n([\s\S]*?)\n```/i;
  const match = String(text || "").match(fenceRegex);
  if (!match || !match[1]) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1].trim());
    const specs = parseCronQuestionSpecs(parsed);
    return specs.length > 0 ? specs : null;
  } catch {
    return null;
  }
}

function detectCronQuestion(text) {
  const trimmed = String(text || "").trim();
  const lines = trimmed.split("\n").filter((line) => line.trim());
  const lastLine = lines[lines.length - 1]?.trim() || "";

  if (lastLine.endsWith("?")) {
    return lastLine;
  }

  const lastFewLines = lines.slice(-4).map((line) => line.trim());
  for (const line of lastFewLines) {
    if (line.endsWith("?") && line.length > 10) {
      return line;
    }
  }

  const questionPatterns = [
    /would you like me to/i,
    /shall I/i,
    /do you want me to/i,
    /please (confirm|choose|select|specify|provide)/i,
    /which (one|option|approach)/i,
    /let me know (if|when|what|which|how)/i,
    /needs? your (approval|input|confirmation|permission|review)/i,
    /you should be seeing a prompt/i,
    /waiting for (your|you to)/i,
    /paste (it |.{0,20} )here/i,
    /if you'd (rather|like to|prefer)/i,
    /alternatively,? (you can|if you)/i,
    /approve (it|the|this)/i,
    /ready when you are/i,
    /once you (approve|confirm|provide|add|set)/i,
  ];

  const searchText = lastFewLines.join(" ");
  for (const pattern of questionPatterns) {
    if (pattern.test(searchText)) {
      for (const line of [...lastFewLines].reverse()) {
        if (pattern.test(line)) {
          return line;
        }
      }
      return lastFewLines[lastFewLines.length - 1] || lastLine;
    }
  }

  return null;
}

function extractCronActivityLabel(text) {
  let cleaned = String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[SILENT\]/gi, "")
    .replace(/`[^`]+`/g, "")
    .replace(/[#*_~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(?:\/[\w.-]+){2,}/g, "")
    .replace(/[\w.-]+\/[\w.-]+\/[\w.-]+/g, "")
    .replace(/\b\w+\.(md|json|ts|tsx|js|jsx|py|sh|yaml|yml|csv|txt|log|pdf|png|svg)\b/gi, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 5) {
    return null;
  }

  cleaned = cleaned
    .replace(/[^\w\s]*\s*\w+\s+for\s+\d+[hms]\s*\d*[hms\d\s·,]*(?:tokens?)?\s*/gi, "")
    .trim();

  if (!cleaned || cleaned.length < 5) {
    return null;
  }

  const sentences = cleaned
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 8)
    .filter((sentence) => !/^(saved|wrote|created|updated|deleted|reading|writing|running|executed)\s+(to|from|at|in)\b/i.test(sentence))
    .filter((sentence) => !/^(Report|Output|File|Log|Result) saved/i.test(sentence))
    .filter((sentence) => !/\bfor\s+\d+[hms]/i.test(sentence));

  const fallbackSentences = cleaned
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 8);
  const pool = sentences.length > 0 ? sentences : fallbackSentences;
  const label = pool.length > 0 ? pool[pool.length - 1] : cleaned;

  if (!label || label.length < 5) {
    return null;
  }

  return label.length > 100 ? `${label.slice(0, 97)}...` : label;
}

function buildCronToolActivityLabel(name, input) {
  const str = (key) => (typeof input?.[key] === "string" ? input[key] : null);
  const basename = (filePath) => filePath.split("/").pop() || filePath;
  const truncate = (value, limit) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);
  const hostname = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return String(url || "").slice(0, 40);
    }
  };

  switch (name) {
    case "Read": {
      const filePath = str("file_path");
      return filePath ? `Reading ${basename(filePath)}` : "Reading file";
    }
    case "Grep": {
      const pattern = str("pattern");
      return pattern ? `Searching for '${truncate(pattern, 40)}'` : "Searching codebase";
    }
    case "Glob": {
      const pattern = str("pattern");
      return pattern ? `Finding files matching '${truncate(pattern, 35)}'` : "Finding files";
    }
    case "Bash": {
      const command = str("command");
      return command ? `Running ${truncate(command, 50)}` : "Running command";
    }
    case "Write": {
      const filePath = str("file_path");
      return filePath ? `Writing ${basename(filePath)}` : "Writing file";
    }
    case "Edit": {
      const filePath = str("file_path");
      return filePath ? `Editing ${basename(filePath)}` : "Editing file";
    }
    case "WebFetch": {
      const url = str("url");
      return url ? `Fetching ${hostname(url)}` : "Fetching URL";
    }
    case "WebSearch": {
      const query = str("query");
      return query ? `Searching web for '${truncate(query, 35)}'` : "Searching web";
    }
    case "TodoWrite":
      return "Updating task list";
    default:
      return name ? `Using ${name}` : null;
  }
}

function createCronClaudeStreamState(taskId) {
  return {
    taskId,
    stdoutBuffer: "",
    stderrBuffer: "",
    lastTextWasQuestion: false,
    latestQuestionLabel: null,
    latestActivityLabel: null,
    resultCostUsd: 0,
  };
}

function handleCronClaudeJsonLine(aiOsDir, taskId, line, state) {
  const trimmed = String(line || "").trim();
  if (!trimmed) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  switch (parsed.type) {
    case "assistant": {
      const content = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
      const textBlocks = content.filter((block) => block?.type === "text" && typeof block.text === "string");
      if (textBlocks.length === 0) {
        return;
      }

      const fullText = textBlocks.map((block) => block.text).join("");
      insertCronTaskLog(aiOsDir, taskId, {
        type: "text",
        content: fullText,
        timestamp: new Date().toISOString(),
      });

      state.lastTextWasQuestion = false;

      const activityLabel = extractCronActivityLabel(fullText);
      if (activityLabel) {
        state.latestActivityLabel = activityLabel;
      }

      const structuredQuestions = detectCronStructuredQuestions(fullText);
      if (structuredQuestions && structuredQuestions.length > 0) {
        state.lastTextWasQuestion = true;
        state.latestQuestionLabel = structuredQuestions[0].prompt || "Waiting for your answers";
        insertCronTaskLog(aiOsDir, taskId, {
          type: "structured_question",
          timestamp: new Date().toISOString(),
          content: structuredQuestions.map((spec, index) => `${index + 1}. ${spec.prompt}`).join("\n"),
          questionSpec: JSON.stringify(structuredQuestions),
        });
        return;
      }

      const questionText = detectCronQuestion(fullText);
      if (questionText) {
        state.lastTextWasQuestion = true;
        state.latestQuestionLabel = questionText;
      }
      return;
    }
    case "tool_use": {
      const name = typeof parsed.name === "string" ? parsed.name : "unknown_tool";
      insertCronTaskLog(aiOsDir, taskId, {
        type: "tool_use",
        timestamp: new Date().toISOString(),
        content: name,
        toolName: name,
        toolArgs: JSON.stringify(parsed.input ?? {}),
        isCollapsed: true,
      });

      const activityLabel = buildCronToolActivityLabel(name, parsed.input ?? {});
      if (activityLabel) {
        state.latestActivityLabel = activityLabel;
      }
      return;
    }
    case "tool_result": {
      const content = parsed.content;
      let resultText = "";
      if (typeof content === "string") {
        resultText = content;
      } else if (Array.isArray(content)) {
        resultText = content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("");
      }

      insertCronTaskLog(aiOsDir, taskId, {
        type: "tool_result",
        timestamp: new Date().toISOString(),
        content: resultText || "(no output)",
        toolResult: resultText || undefined,
      });
      return;
    }
    case "result":
      state.resultCostUsd = typeof parsed.cost_usd === "number" ? parsed.cost_usd : 0;
      return;
    case "error":
      state.stderrBuffer += typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : "";
      return;
    default:
      return;
  }
}

function consumeCronClaudeStdout(aiOsDir, taskId, chunk, state) {
  const text = String(chunk || "");
  if (!text) {
    return;
  }

  state.stdoutBuffer += text;

  while (true) {
    const newlineIndex = state.stdoutBuffer.indexOf("\n");
    if (newlineIndex === -1) {
      break;
    }

    const line = state.stdoutBuffer.slice(0, newlineIndex);
    state.stdoutBuffer = state.stdoutBuffer.slice(newlineIndex + 1);
    handleCronClaudeJsonLine(aiOsDir, taskId, line, state);
  }
}

function flushCronClaudeStdout(aiOsDir, taskId, state) {
  const leftover = state.stdoutBuffer.trim();
  state.stdoutBuffer = "";
  if (leftover) {
    handleCronClaudeJsonLine(aiOsDir, taskId, leftover, state);
  }
}

function spawnClaudeRunViaHiddenWindowsWrapper(
  aiOsDir,
  taskId,
  job,
  cwd,
  logFilePath,
  claudeCommand,
  claudeArgs,
  env
) {
  return new Promise((resolve, reject) => {
    const streamState = createCronClaudeStreamState(taskId);
    const tempBase = `${logFilePath}.${process.pid}.${Date.now()}.${randomUUID()}`;
    const stdoutPath = `${tempBase}.stdout`;
    const stderrPath = `${tempBase}.stderr`;
    const envOverrides = buildWrapperEnvironmentOverrides(env);
    const helperArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOWS_HIDDEN_RUNNER_PATH,
      "-FilePath",
      claudeCommand,
      "-WorkingDirectory",
      cwd,
      "-StdoutPath",
      stdoutPath,
      "-StderrPath",
      stderrPath,
      "-ArgumentsBase64",
      Buffer.from(JSON.stringify(claudeArgs), "utf8").toString("base64"),
      "-TimeoutSeconds",
      String(Math.max(1, Math.ceil(parseTimeoutToMs(job.timeout) / 1000))),
    ];

    if (Object.keys(envOverrides).length > 0) {
      helperArgs.push(
        "-EnvironmentBase64",
        Buffer.from(JSON.stringify(envOverrides), "utf8").toString("base64")
      );
    }

    const child = spawn("powershell.exe", helperArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let wrapperStderr = "";
    let settled = false;
    let stdoutLength = 0;
    let stderrLength = 0;

    const appendIncrementalFileContent = (filePath, streamName) => {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const text = fs.readFileSync(filePath, "utf8");
      const previousLength = streamName === "stdout" ? stdoutLength : stderrLength;
      if (text.length <= previousLength) {
        return;
      }

      const delta = text.slice(previousLength);
      if (streamName === "stdout") {
        stdout += delta;
        stdoutLength = text.length;
        consumeCronClaudeStdout(aiOsDir, taskId, delta, streamState);
      } else {
        stderr += delta;
        stderrLength = text.length;
      }

      fs.appendFileSync(logFilePath, delta, "utf-8");
    };

    const flushBufferedOutput = () => {
      appendIncrementalFileContent(stdoutPath, "stdout");
      appendIncrementalFileContent(stderrPath, "stderr");
    };

    const cleanupTempFiles = () => {
      for (const filePath of [stdoutPath, stderrPath]) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Best-effort cleanup only.
        }
      }
    };

    const pollHandle = setInterval(flushBufferedOutput, 250);

    child.stderr.on("data", (chunk) => {
      wrapperStderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearInterval(pollHandle);
      flushBufferedOutput();
      flushCronClaudeStdout(aiOsDir, taskId, streamState);
      cleanupTempFiles();
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearInterval(pollHandle);
      flushBufferedOutput();
      flushCronClaudeStdout(aiOsDir, taskId, streamState);
      cleanupTempFiles();

      const combinedStderr = [stderr, streamState.stderrBuffer.trim(), wrapperStderr.trim()]
        .filter(Boolean)
        .join("\n");
      resolve({
        exitCode: code || 0,
        timedOut: code === 124,
        stdout,
        stderr: combinedStderr,
        streamState,
      });
    });
  });
}

// Scheduled runs are unattended, so nothing can answer Claude Code's
// built-in question tool. Mirrors ASK_USER_QUESTION_TOOL_NAME in
// src/types/question-spec.ts.
const CRON_DISALLOWED_TOOLS = ["--disallowedTools", "AskUserQuestion"];

function buildCronClaudeArgs(job, workspace) {
  const prompt = String(job.prompt || "");
  const model = job.model || "sonnet";

  if (!workspace?.clientId) {
    return [
      "-p",
      "--model",
      model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      ...CRON_DISALLOWED_TOOLS,
      "--",
      prompt,
    ];
  }

  return [
    "-p",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--add-dir",
    workspace.workspaceDir,
    ...CRON_DISALLOWED_TOOLS,
    "--",
    prompt,
  ];
}

function buildCronExecutionEnv(baseEnv, job, cwd, taskId) {
  const childEnv = { ...baseEnv };
  delete childEnv.CLAUDECODE;
  childEnv.AI_OS_DIR = cwd;
  childEnv.AI_OS_CRON_JOB_SLUG = job.slug;
  // Lets the session-sync hook attach this run to its own task.
  if (taskId) {
    childEnv.AI_OS_TASK_ID = taskId;
  } else {
    delete childEnv.AI_OS_TASK_ID;
  }
  if (job.memoryCapture === false) {
    childEnv.AI_OS_SKIP_MEMORY_CAPTURE = "1";
  } else {
    delete childEnv.AI_OS_SKIP_MEMORY_CAPTURE;
  }
  return childEnv;
}

function spawnClaudeRun(aiOsDir, taskId, job, workspace, logFilePath) {
  return new Promise((resolve, reject) => {
    const streamState = createCronClaudeStreamState(taskId);
    const cwd = workspace.workspaceDir;
    const childEnv = buildCronExecutionEnv(process.env, job, cwd, taskId);
    const configuredCommand = childEnv.AI_OS_CLAUDE_BIN || "claude";
    const windowsLaunchPlan =
      getRuntimePlatform() === "win32"
        ? resolveWindowsClaudeLaunchPlan({ claudeCommand: configuredCommand, env: childEnv })
        : null;
    const env = windowsLaunchPlan?.env || childEnv;
    const claudeCommand = windowsLaunchPlan?.command || configuredCommand;
    const claudeArgs = buildCronClaudeArgs(job, workspace);
    const timeoutMs = parseTimeoutToMs(job.timeout);

    if (
      getRuntimePlatform() === "win32" &&
      windowsLaunchPlan?.mode === "wrapper" &&
      fs.existsSync(WINDOWS_HIDDEN_RUNNER_PATH)
    ) {
      spawnClaudeRunViaHiddenWindowsWrapper(
        aiOsDir,
        taskId,
        job,
        cwd,
        logFilePath,
        claudeCommand,
        claudeArgs,
        env
      ).then(resolve).catch(reject);
      return;
    }

    const child = spawn(claudeCommand, claudeArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const onStreamData = (streamName, chunk) => {
      const text = chunk.toString();
      if (streamName === "stdout") {
        stdout += text;
        consumeCronClaudeStdout(aiOsDir, taskId, text, streamState);
      } else {
        stderr += text;
      }
      fs.appendFileSync(logFilePath, text, "utf-8");
    };

    child.stdout.on("data", (chunk) => onStreamData("stdout", chunk));
    child.stderr.on("data", (chunk) => onStreamData("stderr", chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      flushCronClaudeStdout(aiOsDir, taskId, streamState);
      reject(error);
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore kill errors.
      }

      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore kill errors.
        }
      }, 5_000).unref();
    }, timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      flushCronClaudeStdout(aiOsDir, taskId, streamState);
      resolve({
        exitCode: timedOut ? 124 : (code || 0),
        timedOut,
        stdout,
        stderr: [stderr, streamState.stderrBuffer.trim()].filter(Boolean).join("\n"),
        streamState,
      });
    });
  });
}

async function executeCronTask(aiOsDir, taskId) {
  const db = getDb(aiOsDir);
  const queuedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!queuedTask || !queuedTask.cronJobSlug) {
    throw new Error(`Queued cron task not found: ${taskId}`);
  }

  const originalTask = claimQueuedCronTask(aiOsDir, taskId);
  if (!originalTask || !originalTask.cronJobSlug) {
    return {
      task: db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId),
      result: "skipped",
      exitCode: null,
      durationMs: 0,
      skipped: true,
    };
  }

  const currentRun = db
    .prepare(
      `SELECT trigger, scheduledFor
       FROM cron_runs
       WHERE taskId = ?
         AND result = 'running'
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(taskId);
  const trigger = currentRun?.trigger === "manual" ? "manual" : "scheduled";

  const job = getCronJob(aiOsDir, originalTask.cronJobSlug, originalTask.clientId);
  if (!job) {
    const missingJob = {
      slug: originalTask.cronJobSlug,
      name: originalTask.cronJobSlug,
      clientId: originalTask.clientId,
      workspaceLabel: toClientLabel(originalTask.clientId),
      notify: "on_failure",
      timeout: DEFAULT_TIMEOUT,
    };

    const missingResult = await finalizeCronExecutionOutcome(aiOsDir, missingJob, taskId, {
      result: "failure",
      errorMessage: `Cron job definition not found: ${originalTask.cronJobSlug}`,
      durationMs: 0,
      activityLabel: "Cron job missing",
      trigger,
      scheduledFor: currentRun?.scheduledFor,
      detail: `Cron job definition not found: ${originalTask.cronJobSlug}`,
    });

    return {
      task: missingResult.task,
      result: missingResult.result,
      exitCode: missingResult.exitCode,
      durationMs: missingResult.durationMs,
    };
  }

  const workspace = getWorkspacePaths(aiOsDir, originalTask.clientId);
  fs.mkdirSync(workspace.logsDir, { recursive: true });
  fs.mkdirSync(workspace.statusDir, { recursive: true });
  const logFilePath = path.join(workspace.logsDir, `${job.slug}.log`);
  const startIso = new Date().toISOString();
  const startMs = Date.now();
  const beforeSnapshot = takeOutputSnapshot(workspace.workspaceDir);
  const beforeRootSnapshot = workspace.clientId
    ? takeFileSnapshot(aiOsDir, {
        excludeRelativePath: path.relative(aiOsDir, workspace.workspaceDir),
      })
    : null;
  const executionJob = {
    ...job,
    prompt: buildCronExecutionPrompt(job, workspace),
  };

  appendCronLog(
    aiOsDir,
    job.clientId,
    job.slug,
    `\n=== [${startIso}] START: ${job.name} ===`
  );

  let attempt = 0;
  let lastRun = {
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "",
    streamState: createCronClaudeStreamState(taskId),
  };
  const configuredAttempts = Math.max(1, Number(job.retry || 0) + 1);
  const maxAttempts =
    trigger === "scheduled"
      ? Math.min(Math.max(1, Number(job.retry || 0) + 1), 2)
      : configuredAttempts;

  while (attempt < maxAttempts) {
    attempt += 1;
    if (maxAttempts > 1) {
      appendCronLog(
        aiOsDir,
        job.clientId,
        job.slug,
        `--- Attempt ${attempt}/${maxAttempts} ---`
      );
    }

    try {
      lastRun = await spawnClaudeRun(
        aiOsDir,
        taskId,
        executionJob,
        workspace,
        logFilePath
      );
    } catch (error) {
      lastRun = {
        exitCode: 1,
        timedOut: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        streamState: createCronClaudeStreamState(taskId),
      };
      appendCronLog(aiOsDir, job.clientId, job.slug, `[cron-daemon] ${lastRun.stderr}`);
    }

    if (!lastRun.timedOut && lastRun.exitCode === 0) {
      break;
    }
  }

  const completedAt = new Date().toISOString();
  const endMs = Date.now();
  const durationMs = endMs - startMs;
  const outputs = collectOutputFiles(workspace.workspaceDir, beforeSnapshot, startMs, endMs);
  const leakedRootOutputs =
    beforeRootSnapshot
      ? collectOutsideWorkspaceMutations(
          aiOsDir,
          workspace.workspaceDir,
          beforeRootSnapshot,
          startMs,
          endMs
        )
      : [];
  const containmentError =
    leakedRootOutputs.length > 0 ? formatOutputLeakMessage(leakedRootOutputs) : null;
  const streamState = lastRun.streamState || createCronClaudeStreamState(taskId);
  const needsInput =
    !containmentError &&
    !lastRun.timedOut &&
    lastRun.exitCode === 0 &&
    streamState.lastTextWasQuestion === true;
  const result = containmentError
    ? "failure"
    : needsInput
      ? "failure"
    : lastRun.timedOut
      ? "timeout"
      : lastRun.exitCode === 0
        ? "success"
        : "failure";
  const exitCode =
    (containmentError || needsInput) && lastRun.exitCode === 0 ? 1 : lastRun.exitCode;
  persistTaskOutputs(aiOsDir, taskId, outputs);

  const completion = await finalizeCronExecutionOutcome(aiOsDir, job, taskId, {
    result,
    exitCode,
    durationMs,
    completedAt,
    trigger,
    scheduledFor: currentRun?.scheduledFor,
    costUsd: streamState.resultCostUsd,
    needsInput,
    status: needsInput ? "review" : undefined,
    completionReason: needsInput ? "needs_input" : undefined,
    errorMessage:
      result === "success"
        ? null
        : needsInput
          ? null
          : containmentError || lastRun.stderr || `Exit code ${exitCode}`,
    detail:
      needsInput
        ? streamState.latestQuestionLabel || "Waiting for your reply"
        : containmentError || lastRun.stderr || `Exit code ${exitCode}`,
    activityLabel:
      needsInput
        ? streamState.latestQuestionLabel || "Waiting for your reply"
        : result === "success"
        ? "Scheduled job completed"
        : result === "timeout"
          ? `Timed out after ${job.timeout}`
          : streamState.latestActivityLabel || `Failed with exit code ${lastRun.exitCode}`,
    logLines: containmentError ? [`[cron-daemon] ${containmentError}`] : [],
  });

  return {
    task: completion.task,
    result: completion.result,
    exitCode: completion.exitCode,
    durationMs: completion.durationMs,
    outputs,
  };
}

async function runCronJobNow(aiOsDir, slug, clientId) {
  const job = getCronJob(aiOsDir, slug, clientId);
  if (!job) {
    throw new Error(`Cron job not found: ${slug}`);
  }

  const queued = enqueueCronJob(aiOsDir, job, {
    trigger: "manual",
    dedupeByMinute: false,
    titleSuffix: " (manual run)",
    activityLabel: "Queued — manual trigger",
    scheduledFor: new Date().toISOString(),
  });

  return executeCronTask(aiOsDir, queued.task.id);
}

function hasActiveCronJobs(aiOsDir) {
  return listAllCronJobs(aiOsDir).some(
    (job) => job.active && job.prompt && isSupportedCronSchedule(job.time, job.days)
  );
}

module.exports = {
  DEFAULT_TIMEOUT,
  RUNTIME_LOG_FILE,
  RUNTIME_STALE_MS,
  resolveAiOsRoot,
  normalizeClientId,
  workspaceKeyFor,
  listWorkspaceDescriptors,
  getWorkspacePaths,
  isSupportedCronDays,
  isSupportedCronTime,
  isSupportedCronSchedule,
  getCronScheduleValidationError,
  matchesDays,
  matchesTime,
  shouldDispatchNow,
  isFixedTimeSchedule,
  getNextRunForSchedule,
  getMissedFixedRuns,
  toMinuteIso,
  getDb,
  closeCronProfileDatabase,
  runWithDbPath,
  listCronJobs,
  listAllCronJobs,
  getCronJob,
  parseTimeoutToMs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  getCronRunHistory,
  getRawJobFile,
  getCronJobLog,
  appendCronLog,
  readRunStatus,
  readRuntimeRecord,
  readDaemonPid,
  isProcessAlive,
  isRuntimeRecordStale,
  writeDaemonPid,
  claimDaemonPid,
  removeDaemonPid,
  buildRecoveredCronRunUpdate,
  claimRuntimeLeadership,
  refreshRuntimeHeartbeat,
  releaseRuntimeLeadership,
  getManagedRuntimeStatus,
  getRuntimePaths,
  getRuntimeCommands,
  buildCronClaudeArgs,
  buildCronExecutionEnv,
  buildWrapperEnvironmentOverrides,
  enqueueCronJob,
  completeCronRunForTask,
  executeCronTask,
  runCronJobNow,
  hasActiveCronJobs,
  resolveGitBashPath,
  resolveWindowsClaudeLaunchPlan,
  setCronRuntimeTestHooks,
  resetCronRuntimeTestHooks,
  shouldSendCronNotification,
  maybeSendWindowsCronNotification,
  finalizeCronExecutionOutcome,
};
