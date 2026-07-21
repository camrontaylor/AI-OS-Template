---
name: str-resources
description: "Capture any URL (video, blog, newsletter, podcast, article, PDF): pulls the full content, extracts frameworks and insights, and saves to AI-OS projects, the Notion Notes database, and relevant client workspaces. Not for content creation or YouTube-only requests (tool-youtube)."
when_to_use: 'Invoke when the request sounds like: "/resources", "save this resource", "capture this", "save this article", "save this newsletter", "log this resource"'
argument-hint: "<url> [context or note]"
allowed-tools: Bash, Read, AskUserQuestion
user-invocable: true
---

# /resources — Universal resource capture

Routes any URL to the right capture path, then runs the full save workflow.

## Context Needs

| File | Load level | Why |
|---|---|---|
| Active scope `context/learnings.md` | `## str-resources` | Capture, routing, and Notion lessons |
| Active client `context/current-state.md` | summary, when present | Decide whether the resource is client-specific |

Do not load brand context unless the user also asks to turn the resource into
published content.

| Resource type | How it's captured |
|--------------|------------------|
| YouTube video | Routes to `tool-youtube` Capture Mode |
| Blog / article | Fetches full text via Firecrawl or WebFetch |
| Newsletter | Fetches full text via Firecrawl or WebFetch |
| Podcast | Fetches show notes + transcript if available |
| PDF | Reads via Read tool or WebFetch |
| Any other URL | WebFetch + content extraction |

---

## Step 0 — Detect resource type

Look at the URL:
- `youtube.com`, `youtu.be` → route to `tool-youtube` Capture Mode (Steps 1-7 there handle everything)
- All other URLs → continue below

---

## Step 1 — Fetch content

Use `WebFetch` on the URL. Extract the main article text; strip nav, ads, and footer content.

For JS-heavy sites or sites that block WebFetch: use the Firecrawl Python SDK if `FIRECRAWL_API_KEY` is in `.env`:
```bash
python3 -c "
from firecrawl import FirecrawlApp
app = FirecrawlApp()
result = app.scrape_url('<url>', params={'formats': ['markdown']})
print(result.get('markdown', ''))
"
```

Newsletters (Substack, Beehiiv, ConvertKit web-view URLs) work cleanly with WebFetch.

---

## Step 2 — Extract all value

From the full text, pull out:
- The core idea, argument, or framework
- Key processes or step-by-step methodologies
- Actionable insights and concrete tactics
- Quotable lines that capture the idea precisely
- Content type: framework, case study, tactic, opinion, tutorial, research
- Author / publication

---

## Step 3 — Critical analysis

Go beyond summary. Assess:
- **Fit for AI-OS**: does this change how any skill should work? does it suggest a new one?
- **Fit for MSF**: does this relate to AI methodology, operator positioning, client work, services-as-software?
- **Fit for Personal**: career, growth, mindset, tools worth adopting
- **What to do with it**: file as reference, act on it now, share with a client, build something from it

---

## Step 4 — Save to AI-OS

Create `projects/str-resources/YYYY-MM-DD_{slug}.md` with:
- YAML frontmatter (title, source, author, captured date, notion URL)
- Full framework or argument breakdown with evidence from the text
- Application table: AI-OS / MSF / Personal
- Critical analysis section
- Full cleaned text at the bottom

---

## Step 5 — Save to Notion Notes database

First fetch `collection://19ec6192-c266-8046-8e22-000ba054e4ea` to verify the current connector can access the Notes data source. If Notion returns `object_not_found` or the data source is not visible, do **not** create a standalone/private page and do **not** write into an unrelated database. Continue the AI-OS/client saves, then report: "Notion Notes database is not accessible to this connector" and include the failed data source ID.

If accessible, use `notion-create-pages` with data_source_id `19ec6192-c266-8046-8e22-000ba054e4ea`:
- **Name**: article/post title, **Context Type**: Resource, **URL**: source
- **Description**: one sentence, **Key Insights**: top 4-5 insights
- **Action Items**: concrete next steps, **Content Type**: Actionable or Reference
- **Date**: today, **Status**: Ready

---

## Step 6 — Save to client workspaces

- **A client** (`clients/{slug}/context/reference/`): if relevant to that client's methodology or positioning
- **Personal** (`clients/personal/context/resources.md`): pointer entry with one-line insight + links

---

## Step 7 — Update learnings

Add to `context/learnings.md` under `## Resource Capture`:
- What the resource was in one line
- Key framework name if any
- Whether it changes how a skill should work

---

## Notion sync (Notion to AI-OS)

Resources added directly in Notion (Status = "Queued") get picked up automatically by a daily cron job. To check what is waiting:

```bash
python3 .claude/skills/str-resources/scripts/notion-poll.py
```

This prints a list of URLs with their Notion page IDs. For each, run `/resources <url>` then mark it Ready in Notion, or let the daily cron handle it automatically.

To set up the daily cron: run `ops-cron` and describe "check Notion Notes for queued resources and process each through str-resources."

---

## Rules

- Always save to AI-OS on capture. Save to Notion when the configured Notes data source is accessible; if it is not, report the connector access issue instead of using the wrong database.
- YouTube URLs must route to tool-youtube, not be processed inline here
- Status in Notion should be "Queued" when added manually, "Ready" after processing
