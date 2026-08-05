# Sharing AI-OS With Your Team

The short version: AI-OS keeps two things apart on purpose.

- The **system** is shared - the rules, skills, scripts, docs, and the app. It lives in git.
- The **brain** is private - your memory, your client work, your brand info, your API keys. Git ignores all of it automatically, so it never leaves your machine.

So sharing is mostly already done. You only ever hand someone the system, never the brain. Each teammate gets their own private brain the moment they run setup.

## One time: make the shared copy

From your AI-OS folder, run:

    bash scripts/make-team-copy.sh

This builds a clean copy under `.backup/exports/` with all personal data stripped out (your `clients/`, your `projects/`, your memory, your profile, your private rules, your keys). It has fresh git history, so nothing personal hides in old commits either.

Then push it to a private repo your team can access:

    cd .backup/exports/AI-OS-team-starter-YYYYMMDD-HHMMSS
    git remote add origin <your-private-repo-url>
    git push -u origin main

Invite your teammates to that repo.

## For each teammate: 3 steps

1. Clone it: `git clone <your-private-repo-url> && cd AI-OS-team-starter`
2. Run setup: `bash scripts/centre.sh`
3. Paste their own API keys when asked, then run the `start-here` skill to build their own brand voice and memory. In Claude Code, type `/start-here`.

That is the whole setup. They now have their own assistant, their own private brain, sharing your skills and rules.

If you want their `update.sh` to follow your team repo instead of the public template, have them run this once inside their clone:

    bash scripts/team-join.sh <your-private-repo-url>

## Updates

When you improve a skill or a rule, check first, then publish:

    bash scripts/team-status.sh                     # what would go out, and does it leak
    bash scripts/team-publish.sh <team-repo-url>    # publish it

`team-status.sh` is read-only. It builds the shared tree in a temp folder, runs the leak check, and tells you what a publish would change. Run it before every publish. If it reports a leak, fix the source file - never publish past it.

`team-publish.sh` rebuilds the shared system from your tracked files, strips everything personal, and pushes. The URL is optional once a `team` remote is configured. Never push your working repo straight to the team repo, because your working repo has the personal history in it.

Teammates just run `git pull`. Their memory, keys, and client work are never touched, because git ignores all of it. No merge surprises in the common case.

Publishing to a team repo is an external action, so it goes through the normal approval gate.

## What this does NOT do

Everyone gets their **own** brain. The team does not share one memory and does not see each other's sessions. That is on purpose - memory is kept private and per person.

To share knowledge across the team, share it through the committed system (skills, docs) or by putting work in a shared client folder and committing that, never through the live memory files.

If you want a proper home for shared team knowledge, turn on the `team-knowledge` optional pack. It creates a `team_context/` folder for shared decisions and operating notes, kept separate from anyone's personal memory:

    bash scripts/optional-enable.sh team-knowledge

See [optional-capabilities.md](optional-capabilities.md) for the full list of packs, including the `shared-clients` scaffold.

## What never leaves your machine

The boundary is one list, `TEAM_STRIP` in `scripts/lib/team.sh`. It strips `clients/`, `projects/`, `context/USER.md`, `context/operator/`, `CLAUDE.local.md`, `.claude/launch.json`, personal `.plist` files, local capability markers, and `skills-library/` (that one carries vendored packs whose licences do not allow republishing). Your `context/SOUL.md` does ship by default, so the whole team shares one house voice. There is a commented line in that file if you would rather teammates start with a blank persona.

## Keeping the shared copy fresh later

`make-team-copy.sh` builds a fresh starter each time. To re-cut it after you have improved the system, push your new commits to the shared repo and teammates pull - you do not need to re-run the script. Re-run it only if you want a brand new clean starter (for a new team, say); by default it goes under `.backup/exports/`, or you can point it at a specific empty folder: `bash scripts/make-team-copy.sh /path/to/some-new-folder`.
