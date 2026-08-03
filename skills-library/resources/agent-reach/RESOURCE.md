# Resource: Agent-Reach

## Snapshot
- Source: `Panniantong/Agent-Reach` (https://github.com/Panniantong/Agent-Reach)
- License: MIT
- Commit evaluated: HEAD as of 2026-07-23 (not pinned - re-clone for a fresh SHA if revisited)
- Size: 94 files, 90 text-bearing
- Vendored: **NOT vendored.** Metadata-only record - reclone from the source URL if the content
  itself is ever needed again.
- Evaluated: 2026-07-23
- Evaluated by: `meta-skill-intake` (assess) -> `meta-bake-it-in` (absorb)

## What it is
A Python "internet capabilities for agents" toolkit: routes to the currently-most-stable access
method per platform (YouTube transcripts + Groq-Whisper fallback, Twitter/X, Reddit, web search via
Exa, GitHub, RSS, Chinese platforms out of scope for AI-OS). Install-and-route wrapper over ~7
third-party CLIs, not an MCP reader itself (its MCP server exposes exactly one cosmetic tool,
`get_status`).

## Security scan
- Tool: `scripts/lib/absorb-scan.py`
- Grade: **REVIEW on the final run** (scanner's first pass said HIGH; both drivers were false
  positives, verified at the source - always confirm before trusting a HIGH):
  - 1 "secret" = `agent_reach/guides/setup-twitter.md:56` - an env-var assignment example using
    the Chinese word for "your" as the placeholder value, which the English-only secret
    heuristic missed
  - 1 "secret" = `tests/test_cookie_extract_perms.py:97` - an f-string template inside a *security
    test's own docstring* (it tests that a malicious cookie value can't break out of shell
    interpolation - a good sign, not a leak)
- Real findings: 10 exfil-shaped hits are all the literal placeholder string
  `http://user:pass@ip:port` in proxy-config docs (benign); 18 agent-config-write hits confirm it
  installs itself into `~/.claude/skills/` and `~/.agents/skills/`, and writes browser cookies to
  `~/.config/xfetch/session.json` / `~/.config/bird/credentials.env`; 2 supply-chain hits are
  documented Node.js install lines (`curl ... | bash`).

## Disposition
**PARTIALLY-ABSORBED.** The toolkit stays parked; one fact + one held proposal came out of it.

## What was kept
- Reddit-routing fact (anonymous `.json` is 403-blocked, API gated since late 2025 -> route via
  Apify) -> folded into [`AGENTS.md`](../../../AGENTS.md) "Web Data & Scraping Routing", tagged
  `(absorbed from MadsLorentzen/ai-job-search + Panniantong/Agent-Reach, 2026-07-23)`.
- **Held, not built:** Groq-Whisper transcription fallback for caption-less video/audio
  (`agent_reach/transcribe.py` - yt-dlp audio -> ffmpeg -> free `whisper-large-v3`). Real gap in
  `tool-youtube` (today it only pulls existing captions), but needs local `yt-dlp`+`ffmpeg` and a
  free `GROQ_API_KEY` for a capability with no past-use evidence yet. Build the day a caption-less
  video/podcast need actually appears.

## Why parked
Adopting it means installing ~7 third-party CLIs duplicating AI-OS's managed Firecrawl/Apify paths.
Several routes for login-gated platforms (Twitter, Reddit, Facebook, Instagram) scrape the
operator's own logged-in browser session via OpenCLI/cookie-reuse - real account-ban risk for an
agency, strictly worse than the managed, headless Apify path.

## If revisited
The Jina Reader technique (`r.jina.ai/<URL>` -> free clean markdown) was considered and dropped:
`curl` is denied in AI-OS's permissions, and `WebFetch` already returns clean reads, so the rung
adds nothing.

## Full record
[`projects/meta-bake-it-in/2026-07-23_ai-job-search-codebase-memory-agent-reach.md`](../../../projects/meta-bake-it-in/2026-07-23_ai-job-search-codebase-memory-agent-reach.md)
