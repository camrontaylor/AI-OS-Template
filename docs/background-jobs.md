# Background jobs

A scheduled job repeats a task at a chosen time. It needs Claude Code, a running
scheduler and an awake host. The browser tab itself is not the scheduler.

All ten included example jobs start **paused**. Review the prompt, schedule,
model and scope before enabling one. Jobs can use model/API usage and paid services.

In Command Centre, open **Scheduled** to inspect, edit, run, pause or resume a job.
The job files live in `cron/jobs/`. Status and logs show what happened; a schedule
alone is not proof that work finished.

The Command Centre starts an in-process scheduler while its app is running.
For background scheduling without the UI, use `bash scripts/start-crons.sh`.
Check with `bash scripts/status-crons.sh`, view logs with `bash scripts/logs-crons.sh`,
and stop it with `bash scripts/stop-crons.sh`. Windows equivalents use `.ps1`.
When both hosts are running, the runtime leader lock prevents duplicate scheduling.

Ask **“Help me schedule this workflow, explain the cost and show me the job before enabling it.”**
Schedule fields are documented in `cron/templates/schedule-reference.md`.
