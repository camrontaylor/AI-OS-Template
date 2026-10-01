---
name: Weekly Memory Gaps
time: '09:30'
days: sun
active: 'false'
memoryCapture: false
model: sonnet
notify: on_finish
description: 'Identifies coverage gaps in session logs and stale active threads'
timeout: 10m
retry: '0'
---
You are running as a scheduled job for AI-OS.

Task: Analyse memory coverage gaps and produce a gap report before the weekly curator runs.

Steps:

1. Run the coverage inventory:
   - `bash scripts/lib/memory-meta.sh`
   - Capture the full output.

2. Read `context/MEMORY.md` in full. Get today's date.

3. Identify issues:

   **Date gaps** — any interval >2 days with no session log in `context/memory/`. List each gap with start date, end date, and length in days.

   **Stale active threads** — entries in `## Active Threads` of `context/MEMORY.md` that haven't been updated in >7 days (infer from the thread's content or the daily logs). List each stale thread.

   **Orphaned pending decisions** — entries in `## Pending Decisions` with no session log mentioning them in the past 14 days.

4. Write a gap report to `context/memory/{today}_gap-analysis.md`:

   ```markdown
   # Memory Gap Analysis — {today}

   ## Coverage
   - Session logs: {first_date} to {last_date} ({N} days)
   - Auto-captures: {first_date} to {last_date} ({N} days)
   - MEMORY.md: {char_count}/2500 chars

   ## Date Gaps (>{2} days without any log)
   - {start} → {end}: {N} days
   (or "None detected")

   ## Stale Active Threads (>7 days without update)
   - "{thread excerpt}" — last seen in logs: {date or "not found"}
   (or "None detected")

   ## Orphaned Pending Decisions (>14 days without mention)
   - "{decision excerpt}" — last seen: {date or "not found"}
   (or "None detected")
   ```

5. Output a one-line summary:
   `Gap analysis ({today}): {N} date gaps, {N} stale threads, {N} orphaned decisions. Report saved to context/memory/{today}_gap-analysis.md.`

Rules:
- Do not modify context/MEMORY.md — this job only reads and reports
- Do not delete or prune anything — that is the weekly-memory-curator's job (runs at 10:00)
- If scripts/lib/memory-meta.sh does not exist, skip step 1 and proceed with manual date scan
