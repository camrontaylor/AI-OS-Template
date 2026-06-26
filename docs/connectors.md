# Connectors Map

One place to see everything AI-OS can reach: `.env` API services, CLI MCP servers, and Claude Desktop native connectors. This is the durable companion to the AGENTS.md Service Registry, which only covers the `.env` API keys.

_Last reconciled: 2026-06-26._

## Layer 1 - `.env` API services (key-based)

Documented in full in the **AGENTS.md Service Registry** and `.env.example`. Keys live in `.env` (gitignored). Current keys:

| Key | Service | Notes |
|-----|---------|-------|
| `FIRECRAWL_API_KEY` | Firecrawl | scraping, brand asset extraction |
| `OPENAI_API_KEY` | OpenAI | Reddit/web search in str-trending-research |
| `XAI_API_KEY` | xAI | X/Twitter search |
| `YOUTUBE_API_KEY` | YouTube Data API | channel listing, transcripts |
| `FAL_KEY` | fal.ai | multi-model image/video generation for ad creative |
| `FIGMA_TOKEN` / `FIGMA_FILE_KEY` | Figma API | pixel-exact ad template export |
| `NOTION_API_KEY` | Notion | sync, database queries, meeting notes |
| `NOTION_TASKS_DB_ID` | Notion Tasks database | optional thread/task parking lot |
| `GOOGLE_WORKSPACE_CLI_CLIENT_ID` / `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET` | Google Workspace | Calendar / Drive CLI OAuth |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_USERS` | Telegram | bot channel (allowlist-gated) |
| `ZILLIZ_URI` / `ZILLIZ_TOKEN` | Zilliz Cloud | remote Milvus for MemSearch (Windows) |
| `AGENTMAIL_API_KEY` | AgentMail | agent-owned inbox for magic links / OTPs |

**Python runtime note.** `tool-youtube` runs a local Python script, not just an API call, and needs **Python 3.10 or newer**. The easiest way is `uv`, which its commands already use (`uv run ...`); `uv` reads the `requires-python = ">=3.10"` line and picks a matching Python for you. Install `uv` from https://docs.astral.sh/uv/ if you do not have it. The rest of the key-based services are pure API calls and do not care about your Python version.

## Layer 2 - CLI MCP servers (`~/.claude.json`)

Configured at the Claude Code CLI level (not in the repo). Reach them via the MCP tools in any session.

| Server | What it provides |
|--------|------------------|
| `parallel-search` | web search / fetch (preferred research tool) |
| `parallel-task` | multi-step research tasks |
| `mobbin` | UI/UX reference library |
| `pencil` | (design/asset tool) |

Note: nothing is configured in the repo `.mcp.json` or `.claude/settings.json` mcpServers; these are user-global.

## Layer 3 - Claude Desktop native connectors

Managed by the Claude Desktop app (not by AI-OS config). They appear in-session as MCP tools. Confirm and prune these in the desktop app's connector settings, not here.

| Connector | Used for |
|-----------|----------|
| Notion | docs, databases, meeting notes |
| Webflow | site/CMS work (also the `webflow-skills` plugin) |
| Figma | design read/write |
| Vercel | deploys, logs (also the `vercel` plugin) |
| Box | file storage |
| Google Calendar | scheduling |
| Slack / productivity | messaging, tasks |
| Harness tools | computer-use, Claude-in-Chrome, pdf-viewer |

## Installed marketplace plugins (`~/.claude/plugins/`)

Each adds a `plugin:*` skill block to the `/` picker. Enable/disable in `~/.claude/settings.json` `enabledPlugins` or via `/plugin`.

| Plugin | Status (2026-06-22) |
|--------|---------------------|
| memsearch | enabled (recall) |
| telegram | enabled (channel) |
| webflow-skills | enabled |
| vercel | enabled |
| paper-desktop | **disabled** (unused) |

## Keeping this current

Per the AGENTS.md **Skill & MCP Reconciliation** rules, when a new MCP server or connector is added, log it here. When an `.env` key is added, add it to the AGENTS.md Service Registry (Layer 1) and reflect it here. This file is the single answer to "what is AI-OS connected to right now."

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
