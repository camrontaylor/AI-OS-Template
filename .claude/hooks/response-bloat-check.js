#!/usr/bin/env node
// Stop hook (non-blocking, observability only).
// Records final replies that carry the padding patterns the AGENTS.md
// "Response Discipline" kill-list bans, plus the AI-tell phrasing the AGENTS.md
// "Anti-Slop Standard" bans (signal "ai_slop"). It NEVER blocks the session: it
// always exits 0. This is the measurement layer the prose rules alone never had
// - it answers "is the discipline actually landing?" with data.
//
// Sibling of footer-presence-check.js; same log-only pattern, same reason for
// not hard-enforcing: the patterns have legitimate exceptions (a genuinely
// long analysis, a one-clause concession) that a regex cannot perfectly tell
// from a violation, so it surfaces suspects for human review instead of
// forcing a rewrite that could nag on a correct reply.
//
// SCOPE: a Stop hook only sees the FINAL user-facing reply, not the
// interstitial "Let me..." narration between tool calls. So it measures
// correction post-mortems, recaps, structure-on-tiny, and the long tail well;
// interstitial preamble is a prompt-layer-only fix (the kill-list handles it).
//
// Output: one JSON line per flagged reply to .claude/hooks_info/bloat-misses.log
// (gitignored). Review with:
//   tail .claude/hooks_info/bloat-misses.log
//   # count by signal:
//   cat .claude/hooks_info/bloat-misses.log | python3 -c "import sys,json,collections; c=collections.Counter(s for l in sys.stdin for s in json.loads(l)['signals']); print(c.most_common())"

const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const msg = (data.last_assistant_message || "").trim();
    if (!msg) return; // nothing to check
    const chars = msg.length;
    const signals = [];

    // 1. CORRECTION POST-MORTEM (the #1 complaint). A concession opener plus a
    // self-diagnosis verb in a reply long enough to be an autopsy. A one-clause
    // concession (short) is fine and is NOT flagged. Regex tuned to the exact
    // phrasings mined from 62 real instances across the transcripts.
    const concessionOpener =
      /^\W*(you(\s+(are|were)|'?re)\s+(absolutely\s+)?(right|correct)(\s+to)?|good\s+(push|catch)|fair\s+(hit|challenge|point)|honestly[,?]?\s*no)\b/i;
    const selfDiagnosis =
      /(oversold|overstated|over-?(engineered|built|scoped|complicated|reduced)|misread|conflated|\blazy\b|my\s+(mistake|failure|bad)\b|i\s+was\s+wrong|where\s+i\s+went\s+wrong|i\s+own\s+it|what\s+was\s+wrong|what'?s\s+actually\s+true|i\s+glossed|i\s+softened|i\s+dodged|i\s+jumped|i\s+let\s+[^.]*\bbleed|i\s+(have\s+)?been\s+(handing|giving|feeding|sending)\s+you|i\s+should\s+have\b|i\s+failed\s+to\b|i\s+keep\s+(doing|making|giving)\b)/i;
    // Narrating the fix after a correction ("Let me fix both now: ...") - a
    // statement of intent the reply should replace with the corrected work
    // itself. Same banned family as the post-mortem; folded in per the user's
    // "no apology-preamble, no narrating the fix" pairing. Only counts inside a
    // conceded reply, so it cannot false-fire on ordinary "let me" narration.
    const narratedFix =
      /\blet\s+me\s+(fix|redo|correct|rebuild|rewrite|do)\b|\blet\s+me\s+[^.]{0,40}\bnow\b|here'?s\s+what\s+i'?ll\s+do\b/i;
    const conceded = concessionOpener.test(msg);
    if (conceded) signals.push("concession"); // tracked to see concede/mortem ratio
    if (conceded && chars > 250 && (selfDiagnosis.test(msg) || narratedFix.test(msg))) {
      signals.push("correction_postmortem");
    }

    // 2. RECAP / POSTAMBLE. Final reply that opens by re-announcing finished
    // work instead of the through-line outcome.
    const recapOpener =
      /^\W*(done[.,\s-]|here'?s where (this|things|it) landed|here'?s the final state|final state[:.]|net delivered|everything survived|here'?s where this all landed)/i;
    if (recapOpener.test(msg)) signals.push("recap");

    // 3. STRUCTURE-ON-TINY. Headings or a bullet stack on a reply short enough
    // to be a sentence or two - scaffolding worn to look thorough.
    const bulletCount = (msg.match(/^\s*[-*]\s+/gm) || []).length;
    const hasHeading = /^\s*#{1,6}\s+\S/m.test(msg);
    if (chars < 600 && (hasHeading || bulletCount >= 3)) {
      signals.push("structure_on_tiny");
    }

    // 4. LONG TAIL. Not a violation by itself - the fat-tail replies that carry
    // most of the char bloat. Tagged so the log can track median vs tail length.
    if (chars > 2500) signals.push("long_tail");

    // 5. AI SLOP. Highest-confidence AI-tell vocabulary plus the binary-contrast
    // pattern, per the AGENTS.md "Anti-Slop Standard". Logged only, never blocks:
    // a quoted example or a legit "harness the engine" can false-fire, so it
    // surfaces suspects for review like every other signal here. The full
    // catalog lives in tool-humanizer; this is the always-on measurement layer.
    const slopWords =
      /\b(delv(e|es|ed|ing)|tapestry|multifaceted|foster(s|ed|ing)?|underscore(s|d)?|paramount|utiliz(e|es|ed|ing)|game[-\s]?changer|paradigm shift|cutting[-\s]edge|supercharge[ds]?|ever[-\s]evolving|meticulous|transformative)\b/i;
    const binaryContrast = /\bit'?s not (just |merely )?[^.,\n]{1,45},?\s+it'?s\b/i;
    if (slopWords.test(msg) || binaryContrast.test(msg)) signals.push("ai_slop");

    if (signals.length === 0) return; // clean reply, nothing to record

    const dir = path.join(__dirname, "..", "hooks_info");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    const rec = {
      ts: new Date().toISOString(),
      session: data.session_id || null,
      chars,
      signals,
      head: msg.slice(0, 100).replace(/\s+/g, " "),
    };
    fs.appendFileSync(
      path.join(dir, "bloat-misses.log"),
      JSON.stringify(rec) + "\n",
    );
  } catch {
    // Never throw from a hook.
  }
});
