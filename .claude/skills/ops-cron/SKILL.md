---
name: ops-cron
description: >
  Schedule recurring tasks with AI-OS's managed cron runtime. Jobs live in
  cron/jobs/ and are executed by the same scheduling core in two hosts: the
  Command Centre server while it is running, or a manual CLI daemon started
  with start-crons. Triggers on: "schedule a job", "cron job", "run this every
  morning", "automate daily", "recurring task", "scheduled job", "check
  scheduled jobs", "list jobs", "run job manually", "start crons", "stop
  crons", "cron status", "cron logs". Does NOT trigger for one-off tasks or
  in-session reminders.
---

# Scheduled Jobs

Use this skill whenever the user wants recurring automation. The runtime is managed by AI-OS itself, not by Task Scheduler, launchd, or crontab.

## How It Works

- Job files live in `cron/jobs/`
- The same scheduling core handles job discovery, schedule matching, catch-up, dedupe, queueing, and execution
- The scheduler can run in-process inside the Command Centre or in a headless CLI daemon
- Root jobs and `clients/*` jobs share one runtime and one leader lock per workspace
- `Run now` uses the same enqueue and execution path as scheduled runs

## Outcome

- Job file in `cron/jobs/`
- Automatic execution while the chosen host is alive
- Logs in `cron/logs/`
- Per-job status in `cron/status/`
- Runtime PID, lock, heartbeat, and daemon logs in `.command-centre/`

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `context/learnings.md` | `## ops-cron` section | Known issues with specific jobs |

No brand context needed.

---

## Step 1: Determine the Action

| Action | User says | What to do |
|--------|----------|------------|
| **Create** | "schedule a job", "run X every morning" | Build the job file, then explain the runtime options |
| **List** | "list jobs", "what's scheduled" | Read `cron/jobs/` and `cron/status/`, then show name, workspace, schedule, active flag, last run, result, duration, and run/fail counts |
| **Start runtime** | "start crons", "start scheduled jobs" | Run `bash scripts/start-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1` |
| **Stop runtime** | "stop crons", "stop scheduled jobs" | Run `bash scripts/stop-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-crons.ps1` |
| **Runtime status** | "cron status", "is cron running" | Run `bash scripts/status-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\status-crons.ps1` |
| **Runtime logs** | "cron logs", "show daemon logs" | Run `bash scripts/logs-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\logs-crons.ps1` |
| **Pause job** | "stop the X job", "disable X" | Set `active: "false"` in the job file |
| **Resume job** | "re-enable X", "turn X back on" | Set `active: "true"` in the job file |
| **Remove** | "remove the morning job" | Delete the job file |
| **Run now** | "run X now", "trigger X manually" | Run `bash scripts/run-job.sh {name}` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-job.ps1 {name}` |
| **Compatibility wrapper** | "install cron", "uninstall cron" | Explain that `install-crons` and `uninstall-crons` are deprecated wrappers around `start-crons` and `stop-crons` |

## Step 2: Understand the Job

Ask up to 4 focused questions:

1. What should it do?
   - Clarify the task, outputs, and success criteria.
2. Which skills should it use?
   - Check `.claude/skills/` for matching methodologies and ask the user which ones to chain.
3. When and how often should it run?
   - Map to `time` and `days`.
4. Which model, notification mode, and timeout?
   - `haiku` for cheap/simple work, `sonnet` for the default, `opus` for complex jobs.

## Step 3: Build the Prompt

Write a self-contained prompt body that:

- Starts with `You are running as a scheduled job for AI-OS.`
- Tells Claude to read `CLAUDE.md` for system context
- References exact skill files when methodology matters
- References exact brand context files when tone, positioning, or ICP matter
- Uses numbered steps for multi-step work
- Specifies the output path explicitly
- Includes error handling

## Step 4: Create the File and Confirm

1. Create `cron/jobs/{job-name}.md` following the frontmatter contract and prompt rules in `references/job-format.md` (read it first; it also has the per-model cost table used below).
2. Show:
   - the full file path
   - schedule summary
   - estimated cost per run and per month
3. Ask if they want to adjust anything before activation

## Step 5: Explain the Host Choice

Give the user the right runtime model:

- **UI user:** keep the Command Centre server running; the scheduler dies with it
- **CLI user:** start the daemon manually with `start-crons`; stop it with `stop-crons`
- **Both together:** only one host becomes leader; the other stays passive

Scheduled jobs run unattended with no approval prompts: root workspace jobs use `--dangerously-skip-permissions`, and client workspace jobs use `--permission-mode dontAsk` scoped to that client. This is intentional, because cron jobs must complete autonomously.

Never suggest Task Scheduler, launchd, or crontab, because jobs assume the workspace leader-lock and status files only this runtime provides.

---

## Time Reference

| User says | `time` value | Runs |
|-----------|-------------|------|
| "at 9am" | `"09:00"` | Once daily at 9:00 |
| "at 9am and 5pm" | `"09:00,17:00"` | Twice daily |
| "every 5 minutes" | `"every_5m"` | 288x/day |
| "every 10 minutes" | `"every_10m"` | 144x/day |
| "every 30 minutes" | `"every_30m"` | 48x/day |
| "every hour" | `"every_1h"` | 24x/day on the hour |
| "every 2 hours" | `"every_2h"` | 12x/day |
| "every 4 hours" | `"every_4h"` | 6x/day |
| "three times a day" | `"09:00,13:00,17:00"` | Ask which times |

Full reference: `cron/templates/schedule-reference.md`

---

## Manual Trigger

Run any job immediately, ignoring its schedule:

```bash
bash scripts/run-job.sh morning-kickoff
```

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-job.ps1 morning-kickoff
```

Use `--client {client-id}` when the slug exists in multiple workspaces.

---

## Runtime Notes

- Fixed-time schedules support catch-up after downtime; interval schedules do not
- Deduplication is per job, per client, per minute
- Retries reuse the same execution helper as the first attempt
- `cron/status/{job}.json` tracks result, duration, last run, run count, and fail count
- `.command-centre/cron-runtime-lock.json` tracks the current leader
- `.command-centre/cron-daemon.pid` and `.command-centre/cron-daemon.log` support `status`, `stop`, and `logs`

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user reports a job failure or scheduling issue, update `## Rules` with the fix and today's date. Also log the feedback to `context/learnings.md` under `## ops-cron`.
