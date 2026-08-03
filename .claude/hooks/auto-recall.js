#!/usr/bin/env node
// UserPromptSubmit hook - AI-OS automatic semantic recall.
//
// Why this exists: AI-OS builds a healthy semantic memory index, but nothing
// ever pulled from it unless the model chose to run a search. Transcript
// evidence (2026-07-20 audit) showed recall firing in only a handful of
// sessions and almost never in organic work, so the whole semantic layer was
// "available" but not "used". This hook flips that: on substantive prompts it
// runs a relevance-gated recall and injects the top hits as context, the same
// way the flat memory files are injected at session start.
//
// 2026-07-28 recalibration (memory diagnosis): the v1 gate starved injection.
// Measured against real July failure queries: the correct answers scored
// 0.50-0.90 (comms-message learnings hit 0.529 on an Alessandro-email query)
// while the floor was 0.75; exact-match markdown hits carrying MEMORY.md
// standing assumptions and learnings scored 20-150 and were structurally
// barred by the 0<score<=1 range; and the once-per-session fire meant the
// 2026-07-28 pricing failure could not be caught mid-session even though the
// right chunk scored 0.897. So: floor 0.5, a small exact-match lane, up to
// MAX_FIRES fires per session with a cooldown, and cross-fire dedup.
//
// Design guarantees (all load-bearing):
//   - Fires at most MAX_FIRES times per session, min COOLDOWN between fires.
//   - NEVER blocks the prompt: on any error, timeout, or empty result it emits
//     nothing and exits 0.
//   - NEVER injects noise: a hit must clear its lane's relevance bar, and
//     file-list headings (Deliverables) are skipped. Below the bar we inject
//     nothing - silence beats noise.
//   - NEVER re-injects what startup already loaded (MEMORY.md at any level,
//     client current-state.md, today's/yesterday's daily log) and never
//     re-injects a chunk already surfaced earlier in the session.
//   - Skips greetings (waits for a real prompt) and scheduled cron runs.
//
// Tunables (env):
//   AI_OS_AUTORECALL_DISABLE=1     - turn the hook off entirely
//   AI_OS_AUTORECALL_MIN_SCORE     - semantic relevance floor (default 0.5)
//   AI_OS_AUTORECALL_MAX_HITS      - max hits injected per fire (default 4)
//   AI_OS_AUTORECALL_MAX_FIRES     - max fires per session (default 4)
//   AI_OS_AUTORECALL_COOLDOWN_MS   - min gap between fires (default 90000)
//   AI_OS_AUTORECALL_TIMEOUT_MS    - hard kill for the search (default 9000)

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawn } = require("child_process");

const shared = require(path.join(__dirname, "lib", "writing-prompt.js"));

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const SEARCH = path.join(PROJECT_DIR, "scripts", "memsearch-search.sh");

const MIN_SCORE = clampNum(process.env.AI_OS_AUTORECALL_MIN_SCORE, 0.5, 0, 1);
const MAX_HITS = Math.max(1, Math.round(clampNum(process.env.AI_OS_AUTORECALL_MAX_HITS, 4, 1, 8)));
const MAX_FIRES = Math.max(1, Math.round(clampNum(process.env.AI_OS_AUTORECALL_MAX_FIRES, 4, 1, 12)));
const COOLDOWN_MS = Math.round(clampNum(process.env.AI_OS_AUTORECALL_COOLDOWN_MS, 90000, 0, 3600000));
const HARD_TIMEOUT_MS = Math.max(2000, Math.round(clampNum(process.env.AI_OS_AUTORECALL_TIMEOUT_MS, 9000, 2000, 30000)));
// The search's own internal budget sits just under our hard kill so its markdown
// fallback still has room to answer before we give up.
const INNER_TIMEOUT_S = Math.max(3, Math.floor((HARD_TIMEOUT_MS - 2000) / 1000));
const SNIPPET_CHARS = 400;
// Exact-match (markdown-rarity) lane: scores are term-rarity sums, not cosines,
// so they get their own bar and a small per-fire cap instead of sharing the
// semantic floor. Measured real hits on MEMORY/learnings/knowledge files ran
// 20-150; single weak-term matches sit under 10.
const MD_MIN_SCORE = 10;
const MD_MAX_HITS = 2;

function clampNum(raw, def, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

// Pure greeting / trivial openers: do NOT consume a fire, so recall still
// lands on the first real task prompt that follows. Mirrors the detector in
// session-title-hint.js.
const GREETING_RE =
  /^(hi|hey|hello|yo|sup|gm|hiya|howdy|morning|good (morning|afternoon|evening)|hey there|hello there|what'?s up|whats up|ok|okay|k|thanks|thank you|ty|yes|no|yep|nope|sure)[\s!.?,]*$/i;

function isGreetingOrTrivial(prompt) {
  const cleaned = prompt.trim();
  if (cleaned.length < 12) return true; // too short to be a meaningful query
  if (cleaned.length <= 30 && GREETING_RE.test(cleaned)) return true;
  return false;
}

// Headless cron runs have no human reader and would pay the search cost on
// every sweep. Detector shared with writing-context-gate.js.
const isScheduledAutomation = shared.isScheduledAutomation;

// --- per-session fire state (multi-fire with cooldown + cross-fire dedup) ---

function statePath(sessionId) {
  return path.join(os.tmpdir(), "cc-autorecall-" + sessionId + ".json");
}

function readState(sessionId) {
  try {
    const raw = fs.readFileSync(statePath(sessionId), "utf8");
    const s = JSON.parse(raw);
    return {
      fires: Array.isArray(s.fires) ? s.fires.filter((t) => Number.isFinite(t)) : [],
      keys: Array.isArray(s.keys) ? s.keys : [],
      zeroYield: Number.isFinite(s.zeroYield) ? s.zeroYield : 0,
    };
  } catch {
    // Legacy one-shot marker from the previous version of this hook: treat it
    // as one consumed fire so a live session does not suddenly double-fire.
    const legacy = path.join(os.tmpdir(), "cc-autorecall-" + sessionId + ".done");
    if (fs.existsSync(legacy)) return { fires: [0], keys: [], zeroYield: 0 };
    return { fires: [], keys: [], zeroYield: 0 };
  }
}

// Atomic-ish write (temp + rename) so a concurrent reader never sees a torn
// file (review pass 2, F8). Last-writer-wins on true concurrency is accepted.
function writeState(sessionId, state) {
  try {
    const file = statePath(sessionId);
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch {}
}

function mayFire(state, now) {
  if (state.fires.length >= MAX_FIRES) return false;
  const last = state.fires.length ? Math.max(...state.fires) : 0;
  // Zero-yield backoff (review pass 2, F7): consecutive fires that injected
  // nothing double the cooldown each time, so a user iterating on one topic
  // stops paying search latency for silence.
  const backoff = COOLDOWN_MS * Math.pow(2, Math.min(state.zeroYield || 0, 3));
  return now - last >= backoff;
}

// Sources already loaded into context at session start (load-memory-snapshot.js):
// MEMORY.md at any workspace level, client current-state.md, plus today's and
// yesterday's daily log. Re-surfacing these is pure redundancy. Dates are LOCAL
// (the snapshot hook uses local dates; the old UTC version opened an evening
// off-by-one window where today's log was re-injected).
function localDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Only the ACTIVE workspace's daily logs are startup-loaded, so only those are
// excluded. A blanket suffix match here also blocked the ROOT daily log in
// client sessions - fresh root-session facts from the last 48h were then
// reachable neither at startup nor via recall (pass-1 review finding).
function activeWorkspaceRel(cwd) {
  const m = /\/clients\/([^/]+)(\/|$)/.exec(String(cwd || "").replace(/\\/g, "/"));
  return m ? `clients/${m[1]}/` : "";
}

function alreadyLoadedSources(cwd) {
  const set = new Set();
  const prefix = activeWorkspaceRel(cwd);
  const now = new Date();
  for (const offset of [0, 1]) {
    const d = new Date(now.getTime() - offset * 86400000);
    set.add(`${prefix}context/memory/${localDateStr(d)}.md`);
  }
  return set;
}

function isAlreadyLoaded(source, loadedDailies) {
  const norm = String(source || "").replace(/\\/g, "/");
  if (/(^|\/)context\/MEMORY\.md$/.test(norm)) return true; // root or client MEMORY.md (both startup-loaded)
  if (/(^|\/)context\/current-state\.md$/.test(norm)) return true; // generated client brief
  return loadedDailies.has(shortSource(norm));
}

// Lane classification keys on the PRODUCER first, not the score magnitude:
// both producers stamp reranked=true, so "reranked" proves nothing (pass-1
// review finding), and a markdown hit with a small score must never slip into
// the semantic lane past its own floor.
function isMarkdownProduced(hit) {
  if (hit.search_mode === "markdown_fallback") return true;
  const modes = hit.search_modes;
  return Array.isArray(modes) && modes.includes("markdown_fallback") && !modes.includes("semantic") && !modes.includes("hybrid");
}

// Two scoring lanes, because the producers are not comparable:
//   semantic/hybrid  - 0-1 cosine/rerank relevance, floor MIN_SCORE
//   markdown-rarity  - term-rarity sums (often 20-150), floor MD_MIN_SCORE,
//                      capped at MD_MAX_HITS per fire. These carry the exact-term
//                      hits on learnings/knowledge files that the semantic lane
//                      misses, and were structurally excluded before 2026-07-28.
function laneOf(hit) {
  const s = Number(hit.score);
  if (!Number.isFinite(s) || s <= 0) return null;
  if (isMarkdownProduced(hit)) {
    return s >= MD_MIN_SCORE ? { lane: "markdown", score: s } : null;
  }
  if (s <= 1) return s >= MIN_SCORE ? { lane: "semantic", score: s } : null;
  return null; // semantic-produced score >1: malformed, drop
}

// File-list headings: high term overlap, zero decision value. Injecting a list
// of deliverable paths reads as context but teaches nothing.
function isNoiseHeading(heading) {
  return /^deliverables/i.test(String(heading || "").trim());
}

function shortSource(source) {
  const norm = String(source || "").replace(/\\/g, "/");
  const marker = "/AI-OS/";
  const i = norm.indexOf(marker);
  return i >= 0 ? norm.slice(i + marker.length) : norm.split("/").slice(-2).join("/");
}

function snippet(text) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_CHARS ? oneLine.slice(0, SNIPPET_CHARS - 1) + "…" : oneLine;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(then, now) {
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / 86400000));
}

// Best-effort "when was this written" for a recalled fragment, so the model can
// judge staleness instead of treating every hit as current knowledge. Priority:
//   1. a date in the source filename (daily logs: context/memory/2026-07-20.md)
//   2. a leading YYYY-MM-DD on the fragment itself
//   3. the file's last-modified time on disk (dateless files, last resort)
function fragmentDate(shortSrc, rawSource, text, now) {
  const parse = (s) => {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return Number.isFinite(d.getTime()) ? d : null;
  };
  let d = parse(shortSrc);
  if (d) return { basis: "written", date: iso(d), ageDays: daysBetween(d, now) };
  const lead = /^[\s\-*>]*(\d{4}-\d{2}-\d{2})\b/.exec(String(text || ""));
  if (lead && (d = parse(lead[1]))) {
    return { basis: "written", date: iso(d), ageDays: daysBetween(d, now) };
  }
  try {
    const full = rawSource ? path.resolve(PROJECT_DIR, rawSource) : "";
    if (full) {
      const st = fs.statSync(full);
      if (st && Number.isFinite(st.mtime.getTime())) {
        return { basis: "file updated", date: iso(st.mtime), ageDays: daysBetween(st.mtime, now) };
      }
    }
  } catch {}
  return null;
}

function runSearch(query, cwd) {
  const out = execFileSync("bash", [SEARCH, query, "8"], {
    cwd,
    timeout: HARD_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    // Tag this retrieval as organic auto-recall so the usage readout can tell it
    // apart from eval/cron noise - but let an eval harness that already set the tag
    // keep it, so hook-driven evals are not miscounted as organic.
    env: {
      ...process.env,
      AI_OS_MEMSEARCH_TIMEOUT_SECONDS: String(INNER_TIMEOUT_S),
      AI_OS_RECALL_CALLER: process.env.AI_OS_RECALL_CALLER || "auto-recall",
    },
  });
  const start = out.indexOf("[");
  if (start < 0) return [];
  const parsed = JSON.parse(out.slice(start));
  return Array.isArray(parsed) ? parsed : [];
}

// Best-effort log of what auto-recall actually SURFACED (injected), the closest
// signal to "memory was used" in an organic session. Never blocks the prompt.
function logSurfaced(query, hits, cwd) {
  try {
    const logger = path.join(PROJECT_DIR, "scripts", "lib", "recall-log.py");
    if (!fs.existsSync(logger) || hits.length === 0) return;
    const items = hits.map((h) => ({
      source: h.rawSource || h.source,
      chunk_hash: h.chunk || "",
      heading: h.heading || "",
      score: h.score,
      lane: h.lane || "",
    }));
    // Fire-and-forget: logging must be off the prompt's latency-critical path, so a
    // slow or contended append can never delay the injection or the hook.
    const child = spawn(
      "python3",
      [logger, "--kind", "surfaced", "--caller", "auto-recall", "--query", String(query || ""), "--items-json", JSON.stringify(items)],
      { cwd, detached: true, stdio: "ignore" }
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    /* observability must never break the prompt */
  }
}

// When the writing gate is about to inject the active workspace's learnings
// sections on this same prompt, auto-recall skips that learnings file and any
// daily-log Preferences chunks (the distill sources of the same bullets), so
// the same preference text never arrives twice (review pass 2, F1). Root
// learnings in a client session are NOT excluded - the gate never injects them.
function gateOverlapExclusions(prompt, sessionId, cwd) {
  if (!shared.isLikelyWritingPrompt(prompt)) return null;
  // Both orderings: the gate may run after us (would fire) or already have run
  // on this same prompt seconds ago (fired recently, now in cooldown).
  if (!shared.gateWouldFire(sessionId) && !shared.gateFiredRecently(sessionId)) return null;
  const prefix = activeWorkspaceRel(cwd);
  return { learningsRel: `${prefix}context/learnings.md` };
}

function selectHits(results, loadedDailies, seenKeys, overlap) {
  const seen = new Set(seenKeys);
  const picked = [];
  const now = new Date();
  let mdCount = 0;
  let semCount = 0;

  const gateExcluded = (h) => {
    if (!overlap) return false;
    const rel = shortSource(h.source || h.source_path || "");
    if (rel === overlap.learningsRel) return true;
    return /(^|\/)context\/memory\//.test(rel) && /^preferences/i.test(String(h.heading || "").trim());
  };

  const candidates = results
    .map((h) => ({ h, lane: laneOf(h) }))
    .filter((c) => c.lane !== null)
    // Semantic lane sorts by cosine; markdown lane keeps producer rank but
    // always sorts after any semantic hit of equal standing. Within-lane order
    // is what matters; the render interleaves nothing.
    .sort((a, b) => {
      if (a.lane.lane !== b.lane.lane) return a.lane.lane === "semantic" ? -1 : 1;
      return b.lane.score - a.lane.score;
    });

  // Reserve room for the exact-match lane: those hits carry the term-precise
  // matches on learnings/knowledge files (measured highest-value in the July
  // failure replays), and a full semantic slate would otherwise always crowd
  // them out because the sort puts semantic first. Availability is counted
  // with the SAME filters the admission loop applies (incl. cross-fire dedup),
  // so an already-surfaced markdown hit never reserves a slot it cannot use.
  const keyOf = (h) => {
    const src = shortSource(h.source || h.source_path || "");
    return src + "#" + (h.heading || "") + "#" + (h.start_line || h.chunk_hash || "");
  };
  const admissible = (h) => {
    const src = h.source || h.source_path || "";
    return !isAlreadyLoaded(src, loadedDailies) && !isNoiseHeading(h.heading) && !seen.has(keyOf(h)) && !gateExcluded(h);
  };
  const mdAvailable = Math.min(
    MD_MAX_HITS,
    candidates.filter((c) => c.lane.lane === "markdown" && admissible(c.h)).length
  );
  const semCap = Math.max(1, MAX_HITS - mdAvailable);

  for (const { h, lane } of candidates) {
    if (!admissible(h)) continue;
    if (lane.lane === "markdown" && mdCount >= MD_MAX_HITS) continue;
    if (lane.lane === "semantic" && semCount >= semCap) continue;
    const source = h.source || h.source_path || "";
    const key = keyOf(h);
    seen.add(key);
    if (lane.lane === "markdown") mdCount++;
    else semCount++;
    picked.push({
      key,
      source: shortSource(source),
      rawSource: source,
      chunk: h.chunk_hash || "",
      heading: h.heading || "",
      line: h.start_line || null,
      score: lane.score,
      lane: lane.lane,
      text: snippet(h.content),
      date: fragmentDate(shortSource(source), source, h.content, now),
    });
    if (picked.length >= MAX_HITS) break;
  }
  return picked;
}

function render(hits, cwd) {
  const inClientSession = Boolean(activeWorkspaceRel(cwd));
  const lines = hits.map((h) => {
    const loc = [h.source, h.heading ? `"${h.heading}"` : "", h.line ? `:${h.line}` : ""]
      .filter(Boolean)
      .join(" ");
    let stamp = h.date ? `${h.date.basis} ${h.date.date}, ${h.date.ageDays}d ago` : "date unknown";
    const isDailyLog = /(^|\/)context\/memory\//.test(h.source);
    // Dated session notes go stale fast: a decision logged 3 weeks ago is often
    // superseded by a newer session (review pass 2, F3). Label it so class-1
    // "apply directly" framing does not resurrect a dead decision.
    if (isDailyLog && h.date && h.date.ageDays > 7) {
      stamp += " - possibly superseded; check newer session notes before relying";
    }
    // Root daily logs are a cross-client soup; in a client session a root
    // session note may concern a different client entirely (review pass 2, F6).
    if (inClientSession && isDailyLog && !h.source.startsWith("clients/")) {
      stamp += " - root session note, may concern another client";
    }
    const scoreLabel = h.lane === "markdown" ? `exact-match ${Math.round(h.score)}` : h.score.toFixed(2);
    return `- (${scoreLabel}, ${stamp}) ${loc}\n  ${h.text}`;
  });
  return (
    "AI-OS auto-recall - fragments retrieved from your own memory index for this prompt. Treat them in two classes. " +
    "(1) INTERNAL preferences, decisions, corrections, and lessons (from learnings.md, MEMORY.md, session Corrections/Decisions/Preferences): these are the user's own standing record - APPLY them to this reply directly; do not re-derive, re-ask, or contradict them, and re-read the source file only when the exact wording is load-bearing. " +
    "(2) OUTSIDE-WORLD claims (vendor capabilities, pricing, tiers, API surfaces, anything another party controls): these are unverified leads - re-check at the current live source before asserting them, especially in anything client-facing. " +
    "Each fragment shows when it was written; anything old that a decision now turns on gets re-checked or date-labelled before it travels. " +
    "Run `bash scripts/memsearch-search.sh \"<query>\" 10` for a deeper pull.\n\n" +
    lines.join("\n")
  );
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    if (process.env.AI_OS_AUTORECALL_DISABLE === "1") return;
    // Cron children set AI_OS_AUTONOMOUS=1 (cron-runtime.js); any automation
    // prompt without the standard preamble line would otherwise pay a search.
    if (process.env.AI_OS_AUTONOMOUS === "1") return;

    const data = JSON.parse(input || "{}");
    const sessionId = data.session_id;
    const prompt = data.prompt || data.message || "";
    if (!sessionId || !prompt) return;

    if (isGreetingOrTrivial(prompt)) return; // wait for a real prompt; don't consume a fire

    const state = readState(sessionId);
    const nowMs = Date.now();

    if (isScheduledAutomation(prompt)) {
      // No human, no value; exhaust the fires so the whole run stays silent.
      writeState(sessionId, { fires: Array(MAX_FIRES).fill(nowMs), keys: state.keys, zeroYield: 0 });
      return;
    }

    if (!mayFire(state, nowMs)) return;

    // Consume the fire BEFORE the search, so a slow or failed search never
    // causes a retry storm on subsequent prompts.
    state.fires.push(nowMs);
    writeState(sessionId, state);

    if (!fs.existsSync(SEARCH)) return;

    const cwd = data.cwd && fs.existsSync(data.cwd) ? data.cwd : PROJECT_DIR;
    const query = prompt.length > 400 ? prompt.slice(0, 400) : prompt;

    let results;
    try {
      results = runSearch(query, cwd);
    } catch {
      state.zeroYield = (state.zeroYield || 0) + 1;
      writeState(sessionId, state);
      return; // timeout, Milvus lock, parse error - stay silent
    }

    const overlap = gateOverlapExclusions(prompt, sessionId, cwd);
    const hits = selectHits(results, alreadyLoadedSources(cwd), state.keys, overlap);
    if (hits.length === 0) {
      // Nothing cleared the bar - silence beats noise, and the backoff makes
      // the next quiet fire wait longer.
      state.zeroYield = (state.zeroYield || 0) + 1;
      writeState(sessionId, state);
      return;
    }

    // Remember what was surfaced so later fires never repeat it.
    state.keys = state.keys.concat(hits.map((h) => h.key)).slice(-200);
    state.zeroYield = 0;
    writeState(sessionId, state);

    logSurfaced(query, hits, cwd);

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: render(hits, cwd),
        },
      })
    );
  } catch {
    // Never block the prompt.
  }
});
