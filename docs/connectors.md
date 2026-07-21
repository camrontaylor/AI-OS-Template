# Connectors Map

One place to see everything AI-OS can reach: `.env` API services, CLI MCP servers, Composio app connections, and agent app/native connectors. This file is the canonical connection inventory; `AGENTS.md` keeps only the routing and safety rules.

_Last reconciled: 2026-07-16._

## Layer 1 - `.env` API services (key-based)

Key names are mirrored in `.env.example`. Values live only in `.env` (gitignored). Current keys:

| Key | Service | Notes |
|-----|---------|-------|
| `FIRECRAWL_API_KEY` | Firecrawl | scraping, brand asset extraction |
| `OPENAI_API_KEY` | OpenAI | Reddit/web search in str-trending-research |
| `XAI_API_KEY` | xAI | X/Twitter search |
| `YOUTUBE_API_KEY` | YouTube Data API | channel listing, transcripts |
| `FAL_KEY` | fal.ai | multi-model image and short-video ad generation |
| `FIGMA_TOKEN` / `FIGMA_FILE_KEY` | Figma API | deterministic template export and file targeting |
| `HEYGEN_API_KEY` | HeyGen | avatar/UGC video |
| `AGENTMAIL_API_KEY` | AgentMail | agent-owned inbox, magic links, and login codes |
| `NOTION_API_KEY` | Notion | sync, database queries, meeting notes |
| `GOOGLE_WORKSPACE_CLI_CLIENT_ID` / `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET` | Google Workspace | Calendar / Drive CLI OAuth |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USERS` | Telegram | bot channel (allowlist-gated) |
| `ZILLIZ_URI` / `ZILLIZ_TOKEN` | Zilliz Cloud | remote Milvus for MemSearch (Windows) |
| gcloud auth | Google Stitch | UI design generation |

## Layer 2 - CLI MCP servers (`~/.claude.json`)

Configured at the Claude Code CLI level (not in the repo). Reach them via the MCP tools in any session.

| Server | What it provides |
|--------|------------------|
| `parallel-search` | web search / fetch (preferred research tool) |
| `parallel-task` | multi-step research tasks |
| `mobbin` | UI/UX reference library |
| `pencil` | (design/asset tool) |

Note: nothing is configured in the repo `.mcp.json` or `.claude/settings.json` mcpServers; these are user-global.

## Layer 3 - Composio app connection broker

Composio is the shared broker for SaaS app accounts when native Claude/Codex access is missing, when a client should connect their own account, or when multi-account OAuth and triggers matter. It does not replace local/runtime tools like shell, files, browser control, project skills, hooks, or design-context MCPs.

Current local state:

| Item | Status |
|------|--------|
| CLI | Installed at `~/.composio/composio`; version `0.2.31` |
| Claude skill | Installed as `~/.claude/skills/composio-cli` symlinked to `~/.agents/skills/composio-cli` |
| Codex skill | Installed as `~/.codex/skills/composio-cli` symlinked to `~/.agents/skills/composio-cli` |
| Auth | Logged in to the `personal` org; live tool search verified on 2026-07-06 |

Connected-account snapshot from `composio connections list` (updated 2026-07-08):

| Status | Toolkits |
|--------|----------|
| Active | `apify`, `apify_mcp`, `dataforseo`, `figma`, `firecrawl`, `googleads`, `granola_mcp`, `instagram`, `linkedin`, `mem0`, `parallel`, `twitter` |
| Needs reconnect before use | `gmail`, `github`, `googledocs`, `googledrive`, `googlesheets`, `googlecalendar`, `googlemeet`, `google_analytics`, `google_maps`, `google_search_console`, `hubspot`, `neon`, `notion`, `perplexityai`, `slack`, `supabase`, `youtube` |

Routing rule:

1. Use native Claude/Codex connectors when the active runtime already has a working connector for the target app.
2. If native access is unavailable, use `composio search`, `composio execute`, or `composio link <toolkit>` for supported app accounts.
3. If Composio is not authenticated, prompt the user to run `composio login` or provide a Composio user API key through the CLI login flow.
4. If neither native nor Composio access exists, ask the user to connect the app before using local markdown, pasted data, or base-model knowledge as a substitute.

Use Composio for SaaS and client-owned app access such as Gmail, Outlook-style mail when supported, Slack, GitHub, HubSpot, Notion, Google Workspace, calendar, CRM, task, trigger, and webhook-style workflows. Keep native connectors for local files, shell, browser/computer-use, Figma design context, app plugins, and repo-specific MCP servers.

**Web scraping stack (Firecrawl + Apify, both active + always-approved):** the escalation order for any "read a page / pull web data" task is default web tools first, then Firecrawl only when needed, then Apify for specific-source scrapers. The full ladder is the AGENTS.md "Web Data & Scraping Routing" section - this is the connector-side record that both toolkits are live in Composio (`FIRECRAWL_SCRAPE`/`_CRAWL`/`_EXTRACT`/`_SEARCH`, `APIFY_ACTS_GET`/`_GET_ACTOR`/dataset tools), verified with live calls on 2026-07-08.

## Layer 4 - Agent app and native connectors

Managed by the active agent app (Claude Desktop or another compatible runtime), not by AI-OS config. They appear in-session as MCP tools, app tools, or lazy-loaded plugin tools. Confirm and prune these in the app's connector settings, not in this repository.

Routing rule: when a user names one of these targets, use the matching connector first. Do not treat local markdown, a pasted draft, or base-model knowledge as a substitute for a live connector read/write unless the connector is unavailable and you say that fallback out loud.

| Connector | Used for |
|-----------|----------|
| Notion | docs, databases, meeting notes, task dashboards |
| Webflow | site/CMS work (also the `webflow-skills` plugin) |
| Figma | design read/write |
| Vercel | deploys, logs (also the `vercel` plugin) |
| Box | file storage |
| Google Calendar | scheduling |
| Slack / productivity | messaging, tasks |
| Harness tools | computer-use, Claude-in-Chrome, pdf-viewer |

## Layer 5 - Installed marketplace plugins (`~/.claude/plugins/`)

Each adds a `plugin:*` skill block to the `/` picker. Enable/disable in `~/.claude/settings.json` `enabledPlugins` or via `/plugin`.

| Plugin | Status (2026-06-22) |
|--------|---------------------|
| memsearch | enabled (recall) |
| telegram | enabled (channel) |
| webflow-skills | enabled |
| vercel | enabled |
| paper-desktop | **disabled** (unused) |
| caveman | enabled, **project-scoped to AI-OS only** (installed 2026-07-09) - terse-output mode, `/caveman [lite\|full\|ultra]`. Default mode is **off** for this repo via `.caveman.json` (`{"defaultMode": "off"}`) so it never overrides `SOUL.md`/voice rules automatically; invoke manually per session for heavy dev-grind work. |

## Layer 6 - Local CLI dev tools (no MCP, no API key, machine-global)

Not connectors in the MCP/Composio sense - standalone CLIs installed via npm, used ad hoc from the terminal.

| Tool | Installed | What it does |
|------|-----------|--------------|
| `codeburn` | `npm install -g codeburn` (2026-07-09) | Reads local Claude Code/Cursor/Codex session logs, reports token/cost spend and waste patterns. `codeburn optimize` for a fix list. Fully local, no API key, no data leaves the machine. |

## Keeping this current

Per the AGENTS.md **Skill & Connector Reconciliation** rules, add every new MCP server, app connector, or API service here. Mirror key names in `.env.example`. This file is the single answer to "what is AI-OS connected to right now."

## Readiness Checks

Run the static connector readiness check with:

```bash
bash .claude/skills/meta-systems-check/scripts/check.sh
```

It verifies that the connector map exists, required skill scripts are present,
and key names are documented. It does not read `.env` or prove live credentials.

For release/debug work that should also test the Command Centre runtime:

```bash
bash .claude/skills/meta-systems-check/scripts/check.sh --deep
```

## Notifications

`scripts/notify.sh "Title" "Message" [priority]` is the one sender every AI-OS
script uses. It always fires a macOS notification, and ALSO pushes to the
phone via Pushover once `PUSHOVER_TOKEN` and `PUSHOVER_USER` exist in `.env`
(one-time setup, ~10 minutes: install the Pushover iOS app, create an account
at [pushover.net](https://pushover.net), copy the User Key, create an "AI-OS"
application token, paste both into `.env` using the block in `.env.example`).
Priority 1 bypasses quiet hours; priority 2 repeats until acknowledged.
Chosen over ntfy.sh (weak 2026 iOS app) and Telegram (more setup, unused app)
per the 2026-07-16 research pass.

## Key Inventory and Rotation Runbook

Added after the 2026-07-16 audit (two secrets incidents in one month, no
rotation procedure). Key NAMES only; values live in `.env` and are never
written into docs, reports, memory, or chat.

Where keys live:

| Location | What it holds | Notes |
|----------|---------------|-------|
| `AI-OS/.env` | The one full key set (every name in `.env.example`) | Gitignored. The single source. |
| `clients/*/.env` | Client-specific OVERRIDES only | Full copies were replaced with placeholder stubs 2026-07-16; shared keys inherit from root. |
| `~/.config/ai-keys.env` | Keys the headless cron wrapper loads for scheduled Claude runs | Keep in sync with root `.env` for the keys cron jobs need (Notion first). |
| `~/.claude.json` and plugin configs | MCP server credentials managed by each tool | Rotate inside the owning tool. |

How to rotate any key (the generic runbook):

1. Generate the new key at the provider (the signup URL is in the matching
   `.env.example` comment block).
2. Update the value in `AI-OS/.env`. If the key is used by cron jobs, update
   `~/.config/ai-keys.env` too.
3. Revoke the OLD key at the provider only after step 2, so nothing breaks in
   between.
4. Run `bash .claude/skills/meta-systems-check/scripts/check.sh` - the key
   check confirms the name is still exported where expected.
5. If the old value ever appeared in a file (report, memory log, chat paste),
   search for it with `grep -rl "<first 6 chars>"` and redact before the next
   autosave. The autosave secrets gate (`scripts/base-autosave.sh`) holds
   credential-shaped files back from commits, but redaction is still on you.

Current key names (mirror of `.env.example`): AGENTMAIL_API_KEY, FAL_KEY,
FIGMA_FILE_KEY, FIGMA_TOKEN, FIRECRAWL_API_KEY, GOOGLE_WORKSPACE_CLI_CLIENT_ID,
GOOGLE_WORKSPACE_CLI_CLIENT_SECRET, HEYGEN_API_KEY, NOTION_API_KEY,
OPENAI_API_KEY, TELEGRAM_ALLOWED_USERS, TELEGRAM_BOT_TOKEN, XAI_API_KEY,
YOUTUBE_API_KEY, ZILLIZ_TOKEN, ZILLIZ_URI.

Known pending rotations: none. The previously exposed Morph key was resolved
2026-07-21 by removing the `filesystem-with-morph` MCP entirely from `.mcp.json`
and `.codex/config.toml`; the key value is no longer anywhere in the workspace,
so there is nothing left to rotate. (The MYOB credential was resolved 2026-07-16: moved into
the macOS Keychain, service MYOB, account camron, and the Notion page that
held it was archived. The plaintext exposure was local-disk only, Jul 13-16,
never committed to git; rotating it at MYOB remains an option, not a task.)

## Env Block Template

When handing the user a new key to fill, use this house format in one copy-paste code block (leave each value empty for the user to fill). The separator after the service name is a colon or a hyphen, never an em or en dash.

```
# Service: what it is (https://signup-or-docs-url)
# Used by: skill-name (what it enables)
# Pricing or fallback note
SERVICE_KEY=
```
