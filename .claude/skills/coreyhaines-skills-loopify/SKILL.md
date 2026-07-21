---
name: coreyhaines-skills-loopify
description: "Sets up an autonomous agent loop, cron job, or recurring Claude Code workflow, choosing dynamic vs fixed vs one-shot pacing, building idempotent loop bodies, and setting bail-out conditions so it does not run forever. Not for authoring a new skill (coreyhaines-skills-skillify) or adding an integration (coreyhaines-skills-toolify)."
when_to_use: 'Invoke when the request sounds like: "set up a loop", "schedule this task", "run this daily", "run this weekly", "cron this", "make this recurring"'
metadata:
  version: 0.1.0
---

# /loopify - Set up an agent loop

Wizard for going from *"this task should run periodically"* to a working loop with the right pacing, idempotency, and bail-out.

In AI-OS the canonical runtime for a **fixed recurring schedule** is the `ops-cron` skill (managed cron runtime, jobs live in `cron/jobs/`) - use it instead of any raw cron tool. For **in-session dynamic pacing** use the built-in `ScheduleWakeup` primitive, and for a **run-until-condition** loop use the built-in `/loop` skill. Those three map to the three patterns below.

## Context Needs

Load only what the task needs. Missing files never block the work: ask for what
is missing, or produce solid generic output and say what would sharpen it.

| File | Load level | Why |
|---|---|---|
| `context/learnings.md` | `## coreyhaines-skills-loopify` | Past corrections and preferences for this skill |

## Step 0 - Confirm what you're looping

Ask if not obvious from context: *"What task should this loop do each iteration?"*

Then get the essentials:

| Question | Why it matters |
|---|---|
| **How often?** | Determines cron vs dynamic vs one-shot |
| **When to stop?** | Bail-out condition - loops must have one |
| **What's the loop body doing?** | Determines idempotency requirements |
| **Where does output go?** | File / notification / commit / nothing |
| **What's the failure mode if it runs twice?** | Idempotency validation |

## Step 1 - Pick the pattern

Three primary patterns. Route by the answer to "how often":

### Pattern A - Cron (fixed schedule)

**Use when**: task runs at predictable intervals - daily at 8am, weekly on Fridays, hourly on the hour.

Tool: AI-OS's `ops-cron` skill - registers a recurring job (a file in `cron/jobs/`) with a cron expression, and the managed runtime schedules it. Hand it the schedule, timezone, and loop-body prompt:

```
schedule: "0 8 * * *"            # daily at 8am local
timezone: "America/Los_Angeles"
prompt:   "<loop body prompt>"
```

Common cron patterns:
- `0 8 * * *` - daily at 8am
- `0 9 * * 1` - Mondays at 9am
- `0 9 * * 5` - Fridays at 9am
- `0 */2 * * *` - every 2 hours
- `*/15 * * * *` - every 15 minutes

**Trade-offs:**
- ✅ Predictable, human-readable, easy to reason about
- ✅ Best for time-of-day-dependent tasks (morning brief, EOD summary)
- ✅ Survives across sessions - `ops-cron`'s managed runtime fires it whether or not a Claude session is open
- ❌ Runs at the scheduled time even if the last run isn't done - need idempotent body
- ❌ No self-pacing - over-schedules if the task duration varies wildly

### Pattern B - Dynamic pacing (self-scheduled)

**Use when**: task should react to state, not the clock. Monitor-until-condition-met patterns. Waiting on an external event.

Tool: `ScheduleWakeup` - the current run schedules its own next wake-up.

```
ScheduleWakeup({
  delaySeconds: 270,               // stay in cache window (< 5min)
  reason: "checking build status; sleeping under 5min to stay cache-warm",
  prompt: "<same task, re-entered>"
})
```

**Critical delay rules** (from `ScheduleWakeup` docs - internalized in the wizard):

| Delay range | Use for | Cache impact |
|---|---|---|
| **60s-270s** | Active work - polling build, waiting for state that's about to change | Stays in 5-min prompt cache - fast + cheap |
| **300s** ❌ | **DON'T USE THIS** | Worst of both worlds - pay cache miss without amortizing |
| **300s-3600s** | Waiting on something that takes minutes to change | Pay cache miss but justified |
| **1200s-1800s** (20-30 min) | Idle ticks with no specific signal | Default for autonomous loops |

Never pick 300s literally - either drop to 270 (cache stays warm) or commit to 1200+ (cache miss buys longer wait).

**Trade-offs:**
- ✅ Adaptive - sleeps longer when idle, shorter when active
- ✅ Cache-optimal when tuned right
- ❌ Requires the loop body to know when to schedule next (extra logic)
- ❌ Harder to reason about when it'll run

### Pattern C - One-shot loop (until-condition)

**Use when**: task runs until a condition is met, then stops. No recurrence after that.

Tool: `/loop` (built-in) with an exit condition in the prompt itself.

```
/loop
Check if the deploy is healthy. If yes → stop. If no → wait 5 min and check again.
Max 10 iterations. If still failing after 10, alert and stop.
```

**Trade-offs:**
- ✅ Simplest for check-until-condition
- ✅ Bounded - always eventually terminates
- ❌ Not for indefinite recurrence - that's Pattern A or B

## Step 2 - Design the loop body for idempotency

Idempotent = running the loop twice produces the same result as running it once. **Non-negotiable for cron and dynamic patterns** because they'll fire while the previous iteration is still running or partially complete.

Idempotency patterns:

- **Use "already done" markers**: e.g., commit a state file `projects/coreyhaines-skills-loopify/<name>-last-run.txt` with the timestamp of last successful run. Loop body checks the timestamp before doing work.
- **Use dedupe keys**: if the loop writes to a DB or file, key by content-hash or timestamp so re-runs are no-ops.
- **Use transactions**: DB writes in the loop body should be atomic - either all commit or all roll back.
- **Query before mutate**: check current state before applying the change. If already applied, skip.

Show the user the loop body draft, highlighting the idempotency check. If none exists, add one.

## Step 3 - Bail-out condition

Every loop needs one. Options:

| Bail-out | When to use |
|---|---|
| **Max iterations** (e.g., stop after 100 runs) | Cron loops - prevents runaway |
| **State-based** (e.g., stop when metric X drops below Y) | Monitoring loops |
| **Time-based** (e.g., stop after 24 hours) | Bounded monitoring |
| **Error-based** (e.g., stop on 3 consecutive failures) | All loops - catches degradation |

If the loop is truly indefinite (e.g., a weekly cron with no end), still add a manual bail-out by removing the job from `cron/jobs/` (or stopping it via `ops-cron`). Document it in the SKILL/loop notes so the user knows how to stop it.

## Step 4 - Set the schedule

Based on the pattern from Step 1:

**Cron (Pattern A):** register the job with `ops-cron`:
```
schedule: "<expression>"
timezone: "<tz>"
prompt:   "<loop body>"
```
Report the job name / file in `cron/jobs/` so the user can stop it later (remove the job file or stop it via `ops-cron`).

**Dynamic (Pattern B):**
Wrap the loop body prompt so it ends with a `ScheduleWakeup` call:
```
<do the work>
Then: ScheduleWakeup({delaySeconds: <tuned per Step 1>, prompt: "<same body>", reason: "<why this cadence>"})
```

**One-shot (Pattern C):**
Just run `/loop <prompt with exit condition>`.

## Step 5 - Verify the first run

Wait for the first iteration (or trigger it manually via `/loop` with the same prompt for a dry-run). Confirm:

- Output landed where expected
- Idempotency check works (run twice - second should be a no-op)
- Bail-out condition would fire correctly if triggered
- Log/notification appears if configured

## Step 6 - Report + follow-ups

Report:
- Pattern picked (A/B/C) + why
- `ops-cron` job name / file in `cron/jobs/`, or the dynamic wakeup pattern registered
- Bail-out condition set
- Idempotency mechanism in place
- How to stop the loop (remove the `cron/jobs/` job or stop it via `ops-cron`, or "just don't call the wakeup" for dynamic)

Offer:
- *"Save this loop configuration as a skill via `coreyhaines-skills-skillify from-chat`?"*
- *"Want to also register a `weekly-review` or `daily-startup` loop while we're here?"*
- *"Should the loop write to `coreyhaines-skills-second-brain` outputs when it runs?"*

## Common loop recipes

Templates for frequent loop types (fill in as they're used):

- `references/daily-brief.md` - morning routine loop (calendar + priorities + overnight)
- `references/weekly-review.md` - Friday portfolio pulse
- `references/upstream-check.md` - periodic check for changes to an adapted skill's upstream
- `references/vault-compile.md` - periodic raw/ → wiki/ compilation
- `references/metric-monitor.md` - poll a metric until it crosses a threshold, then alert

## Composes with

- **`ops-cron`** - AI-OS's managed cron runtime. `coreyhaines-skills-loopify` is the design wizard (pacing, idempotency, bail-out); `ops-cron` is where the fixed-schedule job actually lives and runs.
- **`coreyhaines-skills-skillify`** - sibling in `-ify` trifecta. Use `coreyhaines-skills-skillify` to author a new SKILL.md - use `coreyhaines-skills-loopify` when the goal is a scheduled task, not a skill.
- **`coreyhaines-skills-toolify`** - sibling. Use `coreyhaines-skills-toolify` for adding an integration - use `coreyhaines-skills-loopify` when the goal is running something on top of an already-integrated tool on a schedule.
- **`coreyhaines-skills-second-brain`** - many loops write to the vault (raw/ or outputs/). The vault auto-commit pattern applies.
- **`coreyhaines-skills-pm`** - daily-brief and weekly-review loops often read from pm before generating output.

## Notes on quality

- **Never pick 300s for `delaySeconds`.** Worst of both worlds. Drop to 270 or commit to 1200+.
- **Every loop needs a bail-out.** Even indefinite ones need a documented manual stop.
- **Idempotency is non-negotiable for cron + dynamic.** Assume the loop will fire twice while a previous iteration is running.
- **Prefer dynamic pacing over over-frequent cron.** Cron every 15 min wastes tokens if the work isn't ready; dynamic pacing scales down when idle.
- **Document the `ops-cron` job name / `cron/jobs/` file.** Otherwise the loop is orphaned and hard to stop.
- **Log every iteration briefly** - even a single line ("2026-06-30 08:00 daily-brief: ran, 3 items") makes debugging drift trivial.
- **Loops that touch external APIs need rate-limit respect.** If the vendor has a 100/day limit, don't schedule 500/day.
- **Bounded > unbounded when uncertain.** If unsure whether to run for a week or a month, start with a week - extend after seeing it work.
