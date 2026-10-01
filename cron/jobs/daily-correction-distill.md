---
name: Daily Correction Distill
time: '23:15'
days: daily
active: 'false'
memoryCapture: false
model: sonnet
notify: on_finish
description: 'Promote confirmed corrections into the active Solo workspace learnings'
timeout: 5m
retry: '0'
---

Follow the active workspace's scope and Team rules. This is Solo-only. If Team is
connected, skip local maintenance and end with `[SILENT]`.

Resolve the shared AI-OS root and the active root/client workspace. Determine the
host's local date, then run the shared maintenance script with `corrections`,
`--scope` set to that workspace and `--date` set to that date. Run it again with
`--check` to verify that all recorded corrections were promoted.

Do not visit sibling clients, infer corrections from transcripts, overwrite skill
methods, or start other jobs. A malformed entry needs human review; report the
source path and format requirement without quoting sensitive content. A command
that stopped in Team mode must never be retried with a Solo override.

If the result reports no recorded corrections or all were already saved, end with
`[SILENT]`. Otherwise report the number promoted and the local learnings path.
