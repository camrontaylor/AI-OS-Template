## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/ops-loopify/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-loopify/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# Native workflow method

<a id="define-task-scope-and-stop-condition"></a>
## Define task, scope, and stop condition

Capture work to repeat, workspace/client, intended outputs, timezone, cadence or completion signal, cost bounds, timeout, and notification intent. Use only user-requested recurring work. Read existing job definitions to avoid duplicate schedules.

<a id="choose-managed-schedule-or-bounded-loop"></a>
## Choose managed schedule or bounded loop

Use ops-cron for fixed recurring schedules supported by its current job-format reference. For until-condition tasks within a session, use a bounded iteration count and elapsed-time deadline. Dynamic backoff is part of the job body when supported; do not assume vendor wakeup tools or create OS cron.

<a id="make-the-body-idempotent"></a>
## Make the body idempotent

Define a stable run key, checkpoint, freshness check, and duplicate-output policy. Prefer append-only records or atomic replacement of the job’s own files. Checkpoint before external writes; retries must not resend or recreate work. Specify exponential backoff and a small retry cap.

<a id="create-and-verify-the-job"></a>
## Create and verify the job

For recurring work invoke ops-cron with its existing cron/jobs contract and current host requirements. Show the concrete prompt, schedule/timezone, outputs, timeout, and service dependencies. Activation follows the user’s authorization and ops-cron workflow. Test one safe run, inspect cron/status and logs, and report actual host state.
