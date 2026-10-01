#!/usr/bin/env node
/**
 * memory-consolidate — client-side Team OS memory consolidation.
 *
 * The server stores raw capture batches and enforces scope. This client runs the
 * AI step: extract durable memories with Claude Haiku, prepare embeddings only
 * for approved final memories, then complete the batch.
 */

const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const { prepareMemoryApiIngestBody } = require("./lib/memory-api-payload.cjs");
const { teamRequest } = require("./lib/team-api.cjs");
const { readConfig } = require("./lib/team-config.cjs");

const DEFAULT_MODEL = "haiku";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LIMIT = 20;
const PUBLISH_CONFIDENCE_FLOOR = 0.75;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    switch (arg) {
      case "--client": flags.client = next(); break;
      case "--visibility": flags.visibility = next(); break;
      case "--limit": flags.limit = Number(next()); break;
      case "--model": flags.model = next(); break;
      case "--timeout-ms": flags.timeoutMs = Number(next()); break;
      case "--quiet": flags.quiet = true; break;
      case "--help": case "-h": flags.help = true; break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

const USAGE = `memory-consolidate — consolidate Team OS staged captures

Usage:
  node scripts/memory-consolidate.cjs [--client slug] [--limit n]

Options:
  --client <slug>          consolidate client-scoped captures
  --visibility <team|client>  default team, or client when --client is set
  --limit <n>              max captures to claim (default ${DEFAULT_LIMIT})
  --model <name>           Claude model for extraction (default ${DEFAULT_MODEL})
  --timeout-ms <n>         Claude timeout (default ${DEFAULT_TIMEOUT_MS})
  --quiet                  only print errors
  --help`;

function normalizeLimit(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 100) : DEFAULT_LIMIT;
}

function resolveScope(flags, teamId) {
  const visibility = flags.visibility || (flags.client ? "client" : "team");
  if (visibility !== "team" && visibility !== "client") {
    throw new Error("--visibility must be team or client");
  }
  if (visibility === "client" && !flags.client) {
    throw new Error("--client is required when --visibility client is used");
  }
  return {
    teamId,
    clientId: visibility === "client" ? String(flags.client).trim() : null,
    userId: null,
    visibility,
  };
}

function idFromRecord(value) {
  return value && typeof value === "object" && typeof value.id === "string"
    ? value.id.trim()
    : "";
}

async function resolveTeamId(config, request = teamRequest) {
  const whoami = await request(config, "/v1/team/whoami");
  const teamId = idFromRecord(whoami.team || config.team);
  if (!teamId) throw new Error("Team OS login did not return a team id");
  return teamId;
}

function buildConsolidationSystemPrompt() {
  return [
    "You consolidate raw AI-OS memory captures for a shared team memory system.",
    "Extract only durable items useful for future recall: decisions, preferences, stable facts, learnings, and reusable patterns.",
    "Treat explicit user requests like remember this, save this, note this, log this, or add this to team/client memory as durable memory candidates.",
    "If an explicit memory request is clear, non-sensitive, and matches the batch scope, publish it even when it appears in a short chat turn.",
    "If an explicit memory request is unclear, sensitive, secret-like, or seems scoped to the wrong audience, mark it review instead of publishing.",
    "Ignore transient status updates, tool chatter, implementation noise, and anything that is only useful for debugging one turn.",
    "If an item may contain a secret, sensitive personal data, a conflict with existing memory, or ambiguous scope, mark it review.",
    "If there is no useful durable memory in a capture, mark it discard.",
    "Return strict JSON only, with this shape:",
    "{\"items\":[{\"disposition\":\"publish|review|discard\",\"captureIds\":[\"...\"],\"title\":\"...\",\"content\":\"markdown for publish only\",\"confidence\":0.0,\"reviewReason\":\"...\",\"discardReason\":\"...\"}]}",
    "Publish items must be short, factual markdown, written in the user's primary language when clear.",
  ].join(" ");
}

function buildConsolidationInput(batch, captures) {
  const lines = [
    `Batch: ${batch.id}`,
    `Scope: ${batch.scope?.visibility ?? "team"} / client=${batch.scope?.clientId ?? "-"}`,
    "",
    "Captures:",
  ];
  for (const capture of captures) {
    lines.push("");
    lines.push(`--- capture ${capture.id} ---`);
    lines.push(`session: ${capture.sessionId}`);
    lines.push(`actorUserId: ${capture.actorUserId}`);
    lines.push(`sourcePath: ${capture.sourcePath ?? "-"}`);
    lines.push(`createdAt: ${capture.createdAt ?? "-"}`);
    lines.push("content:");
    lines.push(String(capture.content ?? "").trim());
  }
  return lines.join("\n");
}

function resolveWindowsCommand(command, env = process.env) {
  const value = String(command || "").trim();
  if (!value) return null;
  if ((path.isAbsolute(value) || value.includes("\\") || value.includes("/")) && fs.existsSync(value)) {
    return value;
  }
  const lookup = spawnSync("where.exe", [value], {
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  if (lookup.status !== 0 || !lookup.stdout) return null;
  return lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function spawnCommand(command, args, options) {
  if (process.platform === "win32" && !command.includes("\\") && !command.includes("/")) {
    const resolved = resolveWindowsCommand(command, options?.env);
    const commandToRun = resolved || command;
    const extension = path.extname(commandToRun).toLowerCase();
    if (resolved && extension !== ".cmd" && extension !== ".bat") {
      return spawn(commandToRun, args, options);
    }
    return spawn("cmd", ["/d", "/s", "/c", commandToRun, ...args], options);
  }
  return spawn(command, args, options);
}

function spawnWithInput({ command, args, input, timeoutMs, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      reject(new Error(`Claude consolidation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Claude exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

async function runClaudeConsolidation(input, opts = {}) {
  return spawnWithInput({
    command: opts.command || process.env.MEMORY_CONSOLIDATE_CLAUDE_COMMAND || "claude",
    args: buildClaudeConsolidationArgs(opts.model || DEFAULT_MODEL),
    input: buildClaudeConsolidationInput(input),
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT_MS,
    cwd: opts.cwd || process.cwd(),
  });
}

function buildClaudeConsolidationArgs(model = DEFAULT_MODEL) {
  return [
      "-p",
      "--model",
      model,
      "--no-session-persistence",
    ];
}

function buildClaudeConsolidationInput(input) {
  return [
    "System instructions:",
    buildConsolidationSystemPrompt(),
    "",
    "Consolidation input:",
    input,
  ].join("\n");
}

function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("model returned empty output");
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("model output did not contain a JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

function captureIdSet(captures) {
  return new Set(captures.map((capture) => capture.id));
}

function normalizeCaptureIds(raw, validIds) {
  if (!Array.isArray(raw)) return [];
  const ids = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (validIds.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function safeSlug(value, fallback) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || fallback;
}

function sourcePathForItem(batch, item, index) {
  const scope = batch.scope || {};
  const date = new Date().toISOString().slice(0, 10);
  const area = scope.visibility === "client" ? `client-${safeSlug(scope.clientId, "client")}` : "team";
  const title = safeSlug(item.title, `item-${index + 1}`);
  return `consolidated/${area}/${date}-${String(batch.id).slice(0, 8)}-${index + 1}-${title}.md`;
}

function fallbackItem(disposition, captureIds, reason) {
  return {
    disposition,
    captureIds,
    confidence: 0,
    reviewReason: reason,
    discardReason: reason,
  };
}

function isMemoryMaintenanceCapture(capture) {
  const contentText = [
    capture?.title,
    capture?.content,
  ].filter(Boolean).join("\n").toLowerCase();
  if (!contentText) return false;

  const systemRun = /scheduled job|cron|AI-OS|claude code executed|running as a scheduled job|background process|nightly memory|daily memory|weekly memory/.test(contentText);
  const memoryMaintenance = /memory:capture|memory:status|memory:consolidate|memory:index|memory:backup|memory:restore|memory index|memory refresh|pglite memory|semantic recall|re-embed|embedding model|session auto-capture|auto-capture|nightly memory index|daily memory distill|weekly memory curator|weekly memory gaps|nightly memory backup/.test(contentText);
  return systemRun && memoryMaintenance;
}

function discardMaintenanceItems(captures) {
  if (!captures.length) return [];
  return [{
    disposition: "discard",
    captureIds: captures.map((capture) => capture.id),
    discardReason: "memory_maintenance_capture",
    confidence: 1,
  }];
}

function normalizeModelItems(modelBody, captures) {
  const validIds = captureIdSet(captures);
  const allIds = captures.map((capture) => capture.id);
  const rawItems = Array.isArray(modelBody?.items) ? modelBody.items : [];
  const items = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const disposition = String(raw.disposition ?? "").trim();
    const captureIds = normalizeCaptureIds(raw.captureIds, validIds);
    if (captureIds.length === 0) continue;
    items.push({ ...raw, disposition, captureIds });
  }
  return items.length ? items : [fallbackItem("discard", allIds, "no_durable_memory")];
}

async function buildCompleteItems(batch, captures, modelItems, prepareIngest = prepareMemoryApiIngestBody) {
  const completeItems = [];
  for (const [index, item] of modelItems.entries()) {
    if (item.disposition === "discard") {
      completeItems.push({
        disposition: "discard",
        captureIds: item.captureIds,
        discardReason: String(item.discardReason || "no_durable_memory"),
        confidence: typeof item.confidence === "number" ? item.confidence : null,
      });
      continue;
    }

    if (item.disposition !== "publish") {
      completeItems.push({
        disposition: "review",
        captureIds: item.captureIds,
        reviewReason: String(item.reviewReason || "needs_review"),
        confidence: typeof item.confidence === "number" ? item.confidence : null,
      });
      continue;
    }

    const confidence = typeof item.confidence === "number" ? item.confidence : 0;
    const content = String(item.content ?? "").trim();
    if (confidence < PUBLISH_CONFIDENCE_FLOOR || !content) {
      completeItems.push({
        disposition: "review",
        captureIds: item.captureIds,
        reviewReason: confidence < PUBLISH_CONFIDENCE_FLOOR ? "low_confidence" : "empty_publish_content",
        confidence,
      });
      continue;
    }

    const sourcePath = sourcePathForItem(batch, item, index);
    try {
      completeItems.push({
        disposition: "publish",
        captureIds: item.captureIds,
        scope: batch.scope,
        sourcePath,
        sourceType: "memory",
        title: String(item.title || "Consolidated memory"),
        content,
        confidence,
        ...(await prepareIngest({ content, sourcePath })),
      });
    } catch (error) {
      completeItems.push({
        disposition: "review",
        captureIds: item.captureIds,
        reviewReason: `embedding_failed: ${error instanceof Error ? error.message : String(error)}`,
        confidence,
      });
    }
  }
  return completeItems;
}

async function completeBatchItems(config, batch, items, request = teamRequest) {
  return request(config, "/v1/memory/consolidation/complete", {
    method: "POST",
    body: {
      batchId: batch.id,
      claimToken: batch.claimToken,
      items,
    },
  });
}

async function consolidateOnce(opts = {}) {
  const config = opts.config || readConfig();
  const request = opts.request || teamRequest;
  const teamId = opts.teamId || await resolveTeamId(config, request);
  const scope = opts.scope || resolveScope(opts.flags || {}, teamId);
  const limit = normalizeLimit(opts.limit ?? opts.flags?.limit);
  const claimed = await request(config, "/v1/memory/consolidation/claim", {
    method: "POST",
    body: { scope, limit },
  });
  if (!claimed.batch || !Array.isArray(claimed.captures) || claimed.captures.length === 0) {
    return { claimed: 0, published: 0, review: 0, discarded: 0, batch: null };
  }
  const maintenanceCaptures = claimed.captures.filter(isMemoryMaintenanceCapture);
  const captures = claimed.captures.filter((capture) => !isMemoryMaintenanceCapture(capture));
  const maintenanceDiscardItems = discardMaintenanceItems(maintenanceCaptures);

  if (captures.length === 0) {
    const completed = await completeBatchItems(config, claimed.batch, maintenanceDiscardItems, request);
    return {
      claimed: claimed.captures.length,
      published: 0,
      review: 0,
      discarded: completed.discarded?.length ?? maintenanceCaptures.length,
      batch: completed.batch,
    };
  }

  const modelRunner = opts.modelRunner || runClaudeConsolidation;
  let modelBody;
  try {
    const output = await modelRunner(buildConsolidationInput(claimed.batch, captures), {
      model: opts.model || opts.flags?.model || DEFAULT_MODEL,
      timeoutMs: opts.timeoutMs || opts.flags?.timeoutMs || DEFAULT_TIMEOUT_MS,
      cwd: opts.cwd || process.cwd(),
    });
    modelBody = extractJson(output);
  } catch (error) {
    const completed = await completeBatchItems(config, claimed.batch, [
      {
        disposition: "review",
        captureIds: captures.map((capture) => capture.id),
        reviewReason: `model_failed: ${error instanceof Error ? error.message : String(error)}`,
        confidence: 0,
      },
      ...maintenanceDiscardItems,
    ], request);
    return {
      claimed: claimed.captures.length,
      published: 0,
      review: completed.review?.length ?? 1,
      discarded: completed.discarded?.length ?? maintenanceCaptures.length,
      batch: completed.batch,
    };
  }

  const modelItems = normalizeModelItems(modelBody, captures);
  const completeItems = await buildCompleteItems(
    claimed.batch,
    captures,
    modelItems,
    opts.prepareIngest || prepareMemoryApiIngestBody,
  );
  const completed = await completeBatchItems(config, claimed.batch, [
    ...completeItems,
    ...maintenanceDiscardItems,
  ], request);
  return {
    claimed: claimed.captures.length,
    published: completed.published?.length ?? 0,
    review: completed.review?.length ?? 0,
    discarded: completed.discarded?.length ?? 0,
    batch: completed.batch,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  const result = await consolidateOnce({ flags, limit: flags.limit, model: flags.model, timeoutMs: flags.timeoutMs });
  if (!flags.quiet) {
    console.log(
      `memory-consolidate: claimed ${result.claimed}, published ${result.published}, ` +
        `review ${result.review}, discarded ${result.discarded}`,
    );
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`memory-consolidate failed: ${error instanceof Error ? error.message : error}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 1;
    });
}

module.exports = {
  buildCompleteItems,
  buildClaudeConsolidationArgs,
  buildClaudeConsolidationInput,
  buildConsolidationInput,
  buildConsolidationSystemPrompt,
  consolidateOnce,
  extractJson,
  isMemoryMaintenanceCapture,
  normalizeModelItems,
  parseArgs,
  resolveScope,
  runClaudeConsolidation,
  sourcePathForItem,
};
