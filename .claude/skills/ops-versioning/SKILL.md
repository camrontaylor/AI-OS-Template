---
name: ops-versioning
description: Keeps versions of documents and content invisible and automatic. Use when the user says make a new version of this, save this before I change it, save a copy first, snapshot this, show me the versions, list versions, go back to last week's, go back to the one from yesterday, revert this, undo that, restore an older version, or compare versions. Works on any document, copy, research, brief, or plain text file. The user never needs git, branches, ports, filenames, or any command; plain words map to the action. Negative triggers: NOT for websites or apps or anything deployed (those use the Live Project flow, the ops-website skill); NOT for code releases or version bumps (ops-release); NOT for the agentic-os repo itself.
---

# ops-versioning

Makes saving and restoring versions of documents and content invisible. The user speaks
plain words; this skill maps each phrase to a script and never makes them learn git,
branches, ports, or filenames. The deterministic mechanics live in `scripts/`. Read
`references/model.md` for the one-page plain-English model. On invoke, also read
`SKILL.local.md` in this folder if it exists; its rules take precedence.

## Outcome
Any document or content file the user makes can be frozen, listed, compared, and rolled
back, with zero technical knowledge. Restoring always saves the current copy first, so
nothing is ever lost. History is append-only and visible in a plain list.

## Context Needs
| Source | Load | Why |
|--------|------|-----|
| `context/learnings.md` | Only the `## ops-versioning` section | Past fixes and gotchas for this skill |

No `brand_context/` files are needed; this skill moves files, it does not write copy.

## Dependencies
| Tool | Required? | Provides | Without it |
|------|-----------|----------|------------|
| bash | Required | Runs the scripts | Skill cannot run |
| git  | Optional  | Nicer side-by-side diffs | Falls back to plain `diff -u`; snapshots still work fully |

## Skill Relationships
- `ops-website` owns websites and apps: working vs live, gated ship, and live rollback.
  Anything deployed or inside a project repo goes there, not here.
- Code releases and version bumps (tags, release notes) are a separate release flow, not this skill.
- This skill owns documents and content: markdown, copy, research, briefs, plain text.

## How it decides
Two engines, picked automatically. The user never chooses.
- Document or content file (a single `.md`, copy, research, brief, plain text): use the
  file-snapshot engine below. A frozen copy is saved next to the file in a hidden
  `.versions/` folder, stamped with date, time, and a short label.
- Website, app, or anything inside a deploy or live project (for example under
  `projects/live/.../site`, or any folder whose repo has a remote): do NOT snapshot.
  Route to the Live Project flow and tell the user, in plain words, that websites roll
  back through that flow (the `ops-website` skill), not through file copies. `snapshot.sh`
  enforces this: it refuses inside a deploy repo and explains why, unless `--force`.

## Make a new version
Plain phrases: "make a new version", "save this before I change it", "save a copy first",
"snapshot this", "freeze this".
- Run `bash scripts/snapshot.sh "PATH" "[label]"`. The label is optional and is
  just a few words about why (for example "before rewrite"); the user does not type it,
  you supply it from what they said.
- The `.versions/` folder is created on first use. You never mention it by name.
- **Automatic rule:** before you overwrite or heavily edit any existing saved output, take
  a snapshot of it FIRST, even if the user did not ask. Saving the old copy is free and is
  the whole point. Do this silently as part of the edit.
- Report back in the plain words the user used, leading with what happened, not a number:
  "Saved a copy of this as it is right now (you have N saved copies)." Keep the number as a
  small aid in parentheses, not the headline. Never show the internal filename unless asked.

## Go back to an older version
Plain phrases: "go back to last week's", "the one from yesterday", "go back to version 2",
"revert this", "undo that", "restore the older one", "how it was before", "the original",
"the way it used to read", "before I changed it" (PAST tense - this is restore), "scrap this
and go back", "throw this away, use the old one", "start over from yesterday's", "ditch these
changes".
- Watch the tense: "before I change it" (FUTURE) means save first; "before I changed it"
  (PAST) means restore the older copy.
- "Scrap", "throw away", "ditch", "start over" here mean restore an older copy, NOT a delete.
  Restore always saves the current copy first, so nothing is thrown away even when they ask
  to "scrap" it. Never read these words as a delete request.
- First show the versions so you and the user agree which one: `bash scripts/list.sh "PATH"`.
- Then restore: `bash scripts/restore.sh "PATH" SELECTOR`. The selector is whatever the
  user meant, translated: a number from the list; the words `previous`, `last`, `back`, or
  `undo` to step back one (the newest saved version that differs from what they have now, so
  "go back" and "undo" work even right after a save); or a date piece like `2026-06-15`.
- `restore.sh` ALWAYS saves the current file first (label "auto before restore"), then
  swaps in the older one. Tell the user plainly: "Put back the older copy. I saved your
  current one first, so you can switch back any time."
- Nothing is ever deleted. If they change their mind, restore again.

## See or compare versions
Plain phrases: "show me the versions", "list versions", "what versions do I have",
"what changed", "compare this to last week's", "what is different from yesterday",
"did anything change", "what did I change", "is this different from before", "show me both".
- List: `bash scripts/list.sh "PATH"` prints each saved version with its date, label,
  and size, oldest first, and marks the one that matches the file as it is now. If there
  are none it says "no versions yet".
- Compare: `bash scripts/diff.sh "PATH" [selector]` shows what changed between a saved
  version and the file now (default: the most recent saved version). Summarise the
  difference in plain words; do not dump raw diff output at a non-technical user unless
  they ask to see it. When they ask to see the change itself ("show me what changed"),
  show only the changed lines in plain before/after form, not a raw diff.

## Setup
Auto and idempotent. Run `bash scripts/setup.sh`. It checks that bash is present and warns
(does not fail) if git is missing, since git only makes diffs nicer. Safe to run any time;
nothing is installed.

## Eval
Run the ops-versioning eval before changing snapshot, list, restore, diff, deploy-routing,
or saved-version index behavior:

```bash
bash scripts/skill-evals.sh ops-versioning
```

The eval creates a temporary document, snapshots it, changes it, snapshots again,
restores the first version, and verifies the current copy was saved before restore.
It fails if history is missing, restore loses the present copy, or the file does not
return to the selected saved version.

## Rules
- 2026-06-22: Never delete or change a saved version. History is append-only, matching the
  AI-OS no-hard-delete value.
- 2026-06-22: Always snapshot the current file BEFORE restoring an older one, so an undo
  never loses the present copy.
- 2026-06-22: Snapshot an existing saved output BEFORE overwriting it, even if the user did
  not ask. Saving the old copy first is the default.
- 2026-06-22: Websites, apps, and anything in a deploy or live project route to the Live
  Project flow (the `ops-website` skill), never to file snapshots.
- 2026-06-22: Never make the user type a command, learn git, or know a filename. Translate
  their plain words into the right script call and report results in plain words.
- 2026-06-22: Quote every path; files with spaces in the name must work.

## Self-Update
When a real gap shows up (a phrase that should have triggered a snapshot but did not, a
selector the user expected to work, a place the deploy-vs-document split guessed wrong),
add a dated bullet under `## Rules` here and a note under `## ops-versioning` in
`context/learnings.md`. Keep this file under 200 lines. Do not add scope (no binaries, no
new engines) without the user agreeing first.

## Troubleshooting
- "no versions yet" when you expected some: you are pointed at the wrong file path, or the
  snapshots live next to a different copy of the file. Confirm the exact path.
- A snapshot did not happen and you got a Live Project warning: the file is inside a
  website or app repo. That is correct behaviour; use the `ops-website` flow, or pass
  `--force` only if you truly want a plain file copy there.
- Diff looks plain and one-sided: git is not installed, so it fell back to `diff -u`. Run
  `bash scripts/setup.sh` to confirm, then `brew install git` for nicer diffs. Snapshots
  and restores are unaffected.
- Two saves in the same minute: the second filename gets `-2` automatically; both are kept.
- Restore put back the wrong one: nothing is lost. Run `list`, then `restore` the one you
  meant; your latest current copy was saved by the previous restore.
- Saved copies live on this machine: the `.versions/` folder is intentionally git-ignored, so
  it does not clutter commits or pull requests. The file you are working on still saves and
  backs up the usual way; only the in-between frozen copies stay local.
