---
name: Weekly Memory Curator
time: '10:00'
days: sun
active: 'false'
memoryCapture: false
model: sonnet
notify: on_finish
description: 'Consolidates and prunes context/MEMORY.md to keep it under 2,500 chars'
timeout: 10m
retry: '0'
---
You are running as a scheduled job for AI-OS.

Task: Curate the working memory scratchpad — remove stale entries, consolidate duplicates, enforce the cap.

Steps:

1. Read `context/MEMORY.md` in full.

2. Get today's date. Identify stale entries:
   - Any entry in `## Active Threads` that references work with clear "done/shipped/resolved/closed" language
   - Any entry in `## Environment Notes` referencing a URL or tool version that appears to have been superseded by a newer entry
   - Any entry in `## Pending Decisions` where the decision was clearly made (outcome mentioned in a later entry)

3. Consolidate duplicate or near-identical entries:
   - If two entries in the same section say essentially the same thing, merge them into one tighter line

4. Remove stale entries (after consolidation). Keep count.

5. Check character count:
   - PowerShell: `(Get-Item context/MEMORY.md).Length`
   - Bash: `wc -c < context/MEMORY.md`
   - If over 2,500: tighten verbose entries further until under cap

6. Write the updated `context/MEMORY.md`.

7. Output a summary:
   ```
   Weekly curator ({today}):
   - Removed: {N} stale entries
   - Merged: {N} duplicate entries
   - MEMORY.md: {char_count}/2,500 chars ({pct}%)
   ```

Rules:
- Never remove an entry that is still clearly active or unresolved — when in doubt, keep it
- Never create new sections
- Never store secret values
