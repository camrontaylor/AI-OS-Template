---
name: Daily Memory Distill
time: '23:00'
days: daily
active: 'false'
memoryCapture: false
model: sonnet
notify: on_finish
description: 'Promotes durable facts from today''s session log into context/MEMORY.md'
timeout: 10m
retry: '0'
---
You are running as a scheduled job for AI-OS.

Task: Distill today's session log into the curated working scratchpad.

Steps:

1. Find today's date (YYYY-MM-DD format). Locate today's session log:
   - Check `context/memory/{today}.md` first (manual wrap-up log).
   - If it does not exist, check `context/memory/{today}.aos.md` (Command Centre auto-capture).
   - If neither exists, output "No session today — nothing to distill." and stop.

2. Read the located session file in full. Extract durable facts from the session blocks:
   - URLs, staging/prod endpoints, tool versions, config locations → `## Environment Notes`
   - Work still in progress, open questions, things to revisit next session → `## Active Threads`
   - Decisions waiting on input or with options still open → `## Pending Decisions`
   - Skip anything ephemeral (task-specific details, debugging steps, already-resolved items)

3. Read `context/MEMORY.md` in full. Check the current character count:
   - PowerShell: `(Get-Item context/MEMORY.md).Length`
   - Bash: `wc -c < context/MEMORY.md`

4. For each extracted fact:
   - Run a substring dedup check — skip if a near-identical entry already exists
   - If the new content would push over 2,500 chars: consolidate existing entries first (merge similar lines, remove entries with "done/shipped/resolved" markers), then re-check
   - If still over after consolidation: skip the lowest-priority entry and note it in the job output
   - Append under the appropriate section

5. Remove any threads in `## Active Threads` that were clearly resolved today (marked "done", "shipped", "closed").

6. Write the updated `context/MEMORY.md`.

7. Output a one-line summary:
   `Distilled {today}: {N} facts added, {N} resolved threads removed. MEMORY.md: {char_count}/2500 chars.`

Rules:
- Never store secret values — reference env var names only
- Never create new sections — use only the three existing ones
- Mid-session writes to MEMORY.md take effect next session (frozen snapshot pattern) — this is intentional
