---
name: meta-memory-write
description: >
  Saves durable facts to context/MEMORY.md, the curated working scratchpad
  read at session start. Triggers on "remember this", "remember that",
  "note that", "save this to memory", "update memory", "log this",
  "forget about", "remove from memory". Three actions: add (append under
  the correct section after dedup check), replace (substring match + swap),
  remove (confirm with user first). Enforces a 2,500 character cap with
  consolidation when over. Does NOT trigger for daily session logging
  (handled by Returning Mode auto-tracking), learnings updates (handled
  by meta-wrap-up), or one-off in-conversation reminders.
---

# Memory Write

Saves durable facts to `context/MEMORY.md` - the curated working scratchpad that gets read at session start as a frozen snapshot.

## Outcome

- A durable fact is added to, updated in, or removed from `context/MEMORY.md`
- Character cap (2,500) is enforced - consolidation happens before the cap is breached
- Confirmation message shown: `Saved - will be active from next session.`
- `context/MEMORY.md` exists with the three-section scaffold if it was missing

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `context/MEMORY.md` | Full | The file being written to - must be read before every action to dedup and check the cap |

If the file doesn't exist, create it with the standard scaffold before writing.

---

## Step 1: Determine Action

Parse the user's request into one of three actions:

| User phrasing | Action |
|---------------|--------|
| "remember this", "note that", "save this", "log this", "add to memory" | **add** |
| "update memory about X", "change the X entry", "X is now Y" | **replace** |
| "forget about X", "remove X from memory", "delete the X entry" | **remove** |

If ambiguous, ask before proceeding.

---

## Step 2: Read MEMORY.md

Read `context/MEMORY.md` in full. If it doesn't exist, create it with this scaffold:

```markdown
<!-- Cap: 2,500 chars. Curated working scratchpad. Maintained by meta-memory-write skill. Mid-session writes take effect on the next session (frozen snapshot pattern). -->
# Working Memory

## Active Threads

## Environment Notes

## Pending Decisions
```

---

## Step 3: Pick Target Section

Decide which section the fact belongs in:

| Section | Use for |
|---------|---------|
| `## Active Threads` | Current work, open questions, things to revisit |
| `## Environment Notes` | URLs (staging, prod), tool versions, project structure, config file locations |
| `## Pending Decisions` | Decisions waiting on input, options still under consideration |

If the fact doesn't fit any of the three, ask the user where it belongs rather than creating a new section. Sections are intentionally limited to keep the scratchpad focused.

---

## Step 4: Dedup Check

Scan the file for substring matches against the new fact:

- **Exact match exists** → skip the write, tell the user the fact is already saved
- **Similar entry exists** → prefer **replace** over **add**, even if the user said "remember this"
- **No match** → proceed to cap check

---

## Step 5: Cap Check

Compute current byte count of `context/MEMORY.md`.

- **Bash:** `wc -c < context/MEMORY.md`
- **PowerShell:** `(Get-Item context/MEMORY.md).Length`

If adding the new fact would push the file over **2,500 characters**:

1. Consolidate existing entries:
   - Merge similar lines under the same section
   - Remove threads that are clearly resolved (look for "done", "shipped", "closed" markers)
   - Tighten verbose entries into single-line facts
2. Re-check the count
3. If still over after consolidation, tell the user: "MEMORY.md is full. Which entry should I drop to make room for `{new fact}`?"

---

## Step 6: Write the Change

Apply the action using the Edit tool with precise old_string/new_string:

- **add** → insert under the target section heading. Use a bullet (`- `) prefix. Keep to one line per fact.
- **replace** → swap the matched substring with the new value.
- **remove** → **first show the user the exact line and ask "Remove this?"** Only delete after explicit confirmation.

Never store secret values - only reference names (e.g., `FIRECRAWL_API_KEY in .env`, not the key itself).

---

## Step 7: Confirm

After the write succeeds, reply with exactly:

```
Saved - will be active from next session.
```

If the action was **remove**, reply: `Removed - will be active from next session.`

If the dedup check caused a skip, reply: `Already saved - no change needed.`

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- Never exceed 2,500 characters in `context/MEMORY.md`. Consolidate first; if that fails, ask the user what to drop.
- Always check for duplicates before adding. Substring match across the whole file.
- Prefer **replace** over **add** when updating an existing fact.
- Never quote secret values in MEMORY.md - reference env var names only.
- Always confirm with the user before **remove** - show the exact line being deleted.
- Mid-session writes persist to disk but only take effect on the next session. Tell the user this in the confirmation message so they understand why.
- Do not create new sections beyond Active Threads / Environment Notes / Pending Decisions. If a fact doesn't fit, ask the user where it belongs.

---

## Eval

Run the memory-write eval before changing the MEMORY.md scaffold, cap rules,
dedup behavior, section rules, or remove flow:

```bash
bash scripts/skill-evals.sh meta-memory-write
```

The eval checks that the skill still requires the three canonical sections,
enforces the 2,500-character cap, performs a duplicate check before add,
prefers replace over duplicate add, requires explicit confirmation before
remove, stores env var names instead of secret values, and keeps mid-session
writes on the next-session snapshot contract.

---

## Self-Update

If the user flags an issue with how memory is written - wrong section, missed dedup, bad consolidation - update the `## Rules` section in this SKILL.md immediately with the correction and today's date. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

---

## Graceful Degradation

- **MEMORY.md missing** → create with the standard scaffold, then write
- **MEMORY.md corrupted or malformed** → ask the user before doing anything destructive
- **Ambiguous section target** → ask the user; don't guess
- **Bash `wc -c` not available (rare on Windows)** → fall back to PowerShell length check
