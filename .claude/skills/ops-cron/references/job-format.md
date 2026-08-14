# Job File Format

Every scheduled job is a markdown file in `cron/jobs/` with YAML frontmatter and a freeform prompt body.

Starter templates are in `cron/templates/` — copy one to `cron/jobs/` and edit it.

---

## YAML Frontmatter

```yaml
---
name: "Morning Kickoff"
time: "09:00"
days: "weekdays"
active: "true"
model: "sonnet"
# Optional
notify: "on_finish"
description: "Researches trending topics and saves a daily briefing"
timeout: "10m"
retry: "0"
---
```

### Required fields
- `name` — human-readable name, shown in logs
- `time` — when to run (see time formats below)
- `days` — which days to run (see days values below)
- `active` — `"true"` or `"false"`. Set false to pause without deleting.

### Optional fields
- `model` — defaults to `sonnet`. Options: `haiku`, `sonnet`, `opus`
- `notify` — when to send OS notifications. Default: `"on_finish"`
  - `"on_finish"` — notify on success AND failure
  - `"on_success"` — notify only when the job completes successfully
  - `"on_failure"` — notify only on errors or timeouts
  - `"silent"` — never notify
- `description` — one-line description shown in job listings. Default: empty
- `timeout` — max runtime before the job is killed. Default: `"30m"`. Format: `"5m"`, `"1h"`, `"90s"`
- `retry` — number of retries on failure. Default: `"0"`. Each retry gets the full timeout.

### Time formats

| Format | Example | Meaning |
|--------|---------|---------|
| Exact time | `"09:00"` | Runs once at 9:00 AM |
| Multiple times | `"09:00,13:00,17:00"` | Runs at each listed time |
| Every N minutes | `"every_1m"` | Every minute (testing only!) |
| Every N minutes | `"every_5m"` | Every 5 minutes |
| Every N minutes | `"every_10m"` | Every 10 minutes |
| Every N minutes | `"every_30m"` | Every 30 minutes |
| Every N hours | `"every_1h"` | Runs on the hour, every hour |
| Every N hours | `"every_2h"` | Runs at 00:00, 02:00, 04:00, ... |
| Every N hours | `"every_4h"` | Runs at 00:00, 04:00, 08:00, ... |

Full reference with all options: see `cron/templates/schedule-reference.md`

Interval format (`every_Nh`) runs when the hour is divisible by N and the minute is :00.

### Days values

| Value | Meaning |
|-------|---------|
| `daily` | Every day |
| `weekdays` | Monday–Friday |
| `weekends` | Saturday–Sunday |
| `mon` | Specific day (use lowercase 3-letter abbreviation) |
| `mon,wed,fri` | Multiple specific days (comma-separated) |

---

## Prompt Body

Everything after the second `---` is the prompt sent to `claude -p`. Write whatever you want — multi-step, multi-skill, direct instructions.

### Rules for good job prompts

1. **Self-contained.** Each execution has no memory of the last. State everything needed.
2. **Specific file paths.** "Read brand_context/voice-profile.md" not "check voice context".
3. **Explicit output location.** "Save to projects/str-trending-research/{today's date in YYYY-MM-DD format}_daily.md"
4. **Date-aware.** Use "today's date" — Claude resolves it at runtime.
5. **Error handling.** Say what to do if something fails.
6. **Reference skills by methodology.** If using a skill, tell Claude to follow that skill's methodology and reference the skill file path so it loads the right approach.

### Example: Single task

```markdown
You are running as a scheduled job for AI-OS.
Read CLAUDE.md for system context.

Task: Research trending AI automation topics on Reddit and X.
Save to: projects/str-trending-research/{today's date in YYYY-MM-DD format}_daily.md

If web search fails, exit without creating the output file.
```

### Example: Multi-step with skills

```markdown
You are running as a scheduled job for AI-OS.
Read CLAUDE.md for system context. Read context/SOUL.md for voice.

Do the following in order:

1. Read yesterday's memory file and note open threads.
2. Use the str-trending-research methodology (read .claude/skills/str-trending-research/SKILL.md
   for the full approach). Research trending AI topics from the last 24 hours.
3. Draft 2 content ideas connecting trends to our positioning.
   Read brand_context/positioning.md for our angles.
4. Save everything to: projects/ops-cron/{today's date}_morning-kickoff.md

If web search fails, skip trending and use existing context only.
```

---

## How Jobs Get Executed

The managed runtime evaluates jobs once per minute in whichever host currently owns leadership: the Command Centre server or the CLI daemon. For each job file:

1. Parse the YAML frontmatter
2. Skip if `active: "false"`
3. Check if `time` matches the current time (exact, comma-list, or interval)
4. Check if `days` matches the current day
5. **Concurrency and dedupe check** — if this job is already queued or running for the same minute and workspace, skip the duplicate.
6. Enqueue a task and `cron_run`, then run: `claude -p "{prompt}" --model {model} --dangerously-skip-permissions` with the configured `timeout` (default 30m). If the process exceeds the timeout, it is killed.
7. If the job fails and `retry` > 0, re-run up to N times. Each retry gets the full timeout.
8. Write a status file to `cron/status/{filename}.json` with result (`success`/`failure`/`timeout`), duration, timestamp, and run/fail counters
9. **Silent check** — if the job succeeded and its output contains `[SILENT]`, skip the notification (the job signalled there's nothing to report)
10. Send an OS notification based on the `notify` setting (`on_finish`, `on_failure`, or `silent`) — unless suppressed by `[SILENT]`
11. Log output to `cron/logs/{filename}.log` with START/END timestamps

The runtime lock, daemon PID, heartbeat, and daemon log live in `.command-centre/`.

## The `[SILENT]` Convention

Jobs can conditionally suppress their desktop notification by ending their output with `[SILENT]`. This is useful for monitoring jobs where "nothing to report" is the normal case.

To use it, add a line to the job's prompt body:

> "If there are no issues to report, end your response with `[SILENT]`."

The job still runs, still logs, and still writes its status file — only the notification is skipped. `[SILENT]` is only respected on successful runs; failures and timeouts always notify (if the `notify` field allows it).

---

## Cost Estimation

| Model | Typical cost per execution |
|-------|-----------------------------|
| haiku | $0.01–0.05 |
| sonnet | $0.05–0.25 |
| opus | $0.25–2.00 |

A sonnet job running once daily for a month = $1.50–7.50/month.
A sonnet job running every 2 hours (12x/day) for a month = $18–90/month.
