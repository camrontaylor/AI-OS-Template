---
name: ops-cron
description: "Schedule recurring tasks with AI-OS's managed cron runtime (jobs live in cron/jobs/). Not for one-off tasks or in-session reminders."
when_to_use: 'Invoke when the request sounds like: "schedule a job", "cron job", "run this every morning", "automate daily", "recurring task", "check scheduled jobs", "list jobs", "start crons", "stop crons", "cron status", "cron logs"'
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

1. Create `cron/jobs/{job-name}.md`
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

Scheduled jobs run with `--dangerously-skip-permissions` so they can execute unattended without approval prompts. This is intentional — cron jobs must complete autonomously.

Never suggest Task Scheduler, launchd, or crontab.

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

## Unattended Scheduling on a Laptop (nightly wake batch)

The daemon can only run a job while the Mac is awake. AI-OS still owns the schedule; macOS just has to be awake at run time. To fire every job reliably without keeping the Mac awake all night:

1. **One nightly wake (plugged in).** `sudo pmset repeat wakeorpoweron MTWRFSU 23:35:00` wakes the Mac once a night. This wakes the hardware only; it does not schedule jobs.
2. **Schedule jobs in the pre-wake window.** Set each job's `time` at or before the wake time, on its day(s). The daemon's catch-up runs the whole batch at the wake, in scheduled-time order, then the Mac sleeps again.
3. **Order within a batch follows `time`.** Give order-dependent jobs distinct, increasing times (for example gaps 23:31 before curator 23:32); the catch-up sorts by scheduled time before enqueueing.
4. **Failsafes.** If the Mac is closed at the wake, the batch runs the moment it is next opened. The daemon survives a reboot via a last-sweep marker in `.command-centre/cron-last-sweep.json`, so an overnight restart does not drop the batch.

Needs the Mac plugged in (scheduled wakes are blocked on battery). launchd (`com.aios.cron-daemon`) keeps the daemon alive and pmset only wakes the hardware; neither replaces AI-OS scheduling.

## Heartbeat Integration

At session start:

1. Check `.command-centre/cron-runtime-lock.json` and `.command-centre/cron-daemon.pid`
2. If a runtime is active, read `cron/status/` and report the latest relevant run
3. If jobs exist and the runtime is stopped, mention the `start-crons` command only when scheduling matters

---

## Eval

Run this eval before changing job format, daemon commands, or scheduling rules:

```bash
bash scripts/test-notion-resource-health.sh
npm run test:cron --prefix command-centre
bash scripts/status-crons.sh
```

The eval passes when job files keep valid YAML frontmatter, schedule parsing
matches `cron/templates/schedule-reference.md`, daemon status/log commands stay
non-destructive, Notion resource health exits non-zero when blocked, explicit
cron text like `Status: BLOCKED` records a failed run, and external writes
inside jobs remain approval-gated by their own job prompts. It fails if a job
can run without a clear prompt, if stopping the daemon deletes job files, if a
blocked cron run is recorded as success, or if fixed-time catch-up behavior is
broken.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- 2026-06-22: Laptop unattended runs use the nightly wake batch. Schedule jobs at or before the pmset wake time (default 23:35) so one nightly wake runs them all; keep the Mac plugged in; give order-dependent jobs distinct increasing times. See "Unattended Scheduling on a Laptop (nightly wake batch)".
- 2026-06-30: Cron jobs that explicitly output `Status: BLOCKED` or `Status: FAILED` must be recorded as failed even when the Claude process exits 0. The cron wrapper must load `AI_KEYS_ENV_FILE` before the Claude OAuth fast path so headless Claude receives integration keys such as `NOTION_API_KEY`.

---

## Self-Update

If the user reports a job failure or scheduling issue, update `## Rules` with the fix and today's date. Also log the feedback to `context/learnings.md` under `## ops-cron`.
