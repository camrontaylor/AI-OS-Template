# Updating to v0.2.0 — What's Changed and How to Migrate

This is a significant update. We've reorganised how the system works under the hood to make it faster, more compatible with other AI tools, and better at handling multiple projects at once. Your data — brand context, memory, projects, learnings — is all safe and doesn't need to change. But the system files around it have moved.

This guide walks you through updating manually, step by step.

---

## Why we made these changes

Three things drove this update:

1. **Cross-tool compatibility.** Until now, everything lived in `CLAUDE.md` - a single 500+ line file that only Claude Code could read. We've split the instructions so the shared operating rules live in `AGENTS.md` (which compatible AI tools can read) and Claude-specific behaviour stays in `CLAUDE.md` (which is now much smaller and just imports `AGENTS.md`). Same brain, more ways to access it.

2. **Multiple projects at once.** Previously, the GSD planning system (the `.planning/` folder) sat at the root of your install, which meant you could only run one structured project at a time. Now each project owns its own `.planning/` folder inside its project directory. You can have multiple GSD projects running in parallel.

3. **Silent, fast startup.** The old system ran a long checklist every time you opened Claude — reading files, scanning skills, checking for stale context, running reconciliation. Now startup is silent. Claude reads what it needs and gets to work. Everything else is deferred to when it's actually needed.

---

## What's new

- **Command Centre** — a full task board UI with Kanban view, project dashboards, cron scheduling, and client management. It now lives at `command-centre/` in the repo root.
- **Branching workflow** — `/new-feature` starts a feature branch, `/release` cuts a version. A branch-guard hook gently reminds you to use feature branches for code changes.
- **Cron system** — scheduled jobs now run in-process (they stop when the server stops, no orphaned tasks). Full Windows support.
- **4 new skills** — `ops-cron` (scheduled jobs), `tool-stitch` (fetch UI designs), `viz-interface-design` (dashboard/admin UI), `viz-stitch-design` (design generation).
- **CI pipeline** — automated checks on pull requests, with path-based filtering so content changes don't trigger code checks.
- **Version tracking** — `CHANGELOG.md` and `VERSION` file so you can see what changed between updates.

---

## Before you start

You'll need about 10 minutes. Nothing here is destructive — you're copying things, not deleting them.

Make sure you know where your AI-OS folder is. We'll call it `AI-OS` in these instructions, but yours might be named differently.

---

## Step 1: Back up your personal data

These are the files that belong to you — your brand, your memory, your projects, your API keys. They don't exist in the template, so if you lose them, they're gone.

Copy these folders and files somewhere safe (your Desktop, a backup folder, wherever you like):

```
brand_context/                  — your brand voice, positioning, ICP, writing samples
context/memory/                 — all your session history
context/learnings.md            — feedback and lessons the system has learned
context/USER.md                 — your preferences and working style
context/SOUL.md                 — your personality config (only if you customised it)
projects/                       — all your project outputs, briefs, and source code
cron/jobs/                      — any scheduled jobs you've set up
clients/                        — client workspaces (only if you use multi-client)
.env                            — your API keys
.mcp.json                       — your MCP server connections (if you have any)
.claude/skills/_catalog/installed.json  — which skills you chose during setup
```

**If you created or heavily customised any skills**, also back up those individual skill folders from `.claude/skills/`.

---

## Step 2: Move your .planning folder (if you have one)

This is the big structural change. Previously, when you ran a GSD project (Level 3), the `.planning/` folder lived at the root of your AI-OS install. That meant one project at a time.

Now, each project owns its `.planning/` folder inside its own directory under `projects/briefs/`.

**Check if you have a `.planning/` folder at the root of your AI-OS install.** If you don't, skip to Step 3.

If you do have one:

1. **Figure out which project it belongs to.** Open `.planning/PROJECT.md` — it'll have the project name. Find the matching folder in `projects/briefs/` if there is one (there may not be - in which case - you can create one). For example, if the project is "website-rebuild", the folder is `projects/briefs/website-rebuild/`.

2. **Move the `.planning/` folder into that project folder:**
   ```
   Before:
   AI-OS/
   ├── .planning/           <-- sitting at the root
   └── projects/briefs/website-rebuild/

   After:
   AI-OS/
   └── projects/briefs/website-rebuild/
       └── .planning/       <-- now lives inside its project
   ```

   On Mac/Linux you can do this in the terminal if easier (moves the folder):
   ```bash
   mv .planning projects/briefs/YOUR-PROJECT-NAME/.planning
   ```

   Or just drag it in Finder/Explorer.

3. **If you can't figure out which project it belongs to**, or there's no matching project folder, create one:
   ```bash
   mkdir -p projects/briefs/my-project
   mv .planning projects/briefs/my-project/.planning
   ```
   You can rename `my-project` to whatever makes sense.

After this, there should be no `.planning/` folder at the root of your install.

---

## Step 3: Clone the latest version

Rather than trying to merge all the changes into your existing install (which will cause conflicts because of the CLAUDE.md restructure), the cleanest path is to start fresh and bring your data back in.

1. **Rename your current install** so it's out of the way but still accessible:
   ```bash
   mv AI-OS AI-OS-backup
   ```

2. **Clone the latest version:**
   ```bash
   git clone https://github.com/camrontaylor/AI-OS-Template.git AI-OS
   ```
   The public template is the source. No token is needed. Do not use any third-party classroom token.

---

## Step 4: Restore your data

Copy everything you backed up in Step 1 back into the new install. The folder structure is the same — your data goes in the same places it was before. OR ask Claude to do it - you can say the below actions need taking place (requires skip-permissions mode)

```bash
cd AI-OS

# Brand context
cp -r ../AI-OS-backup/brand_context/* brand_context/

# Memory and learnings
cp -r ../AI-OS-backup/context/memory/* context/memory/
cp ../AI-OS-backup/context/learnings.md context/learnings.md
cp ../AI-OS-backup/context/USER.md context/USER.md
cp ../AI-OS-backup/context/SOUL.md context/SOUL.md

# API keys and MCP config
cp ../AI-OS-backup/.env .env
cp ../AI-OS-backup/.mcp.json .mcp.json 2>/dev/null

# Your skill selections
cp ../AI-OS-backup/.claude/skills/_catalog/installed.json .claude/skills/_catalog/installed.json

# All your projects (including .planning folders you moved in Step 2)
cp -r ../AI-OS-backup/projects/* projects/

# Scheduled jobs (if you have any)
cp -r ../AI-OS-backup/cron/jobs/* cron/jobs/ 2>/dev/null

# Client workspaces (if you use multi-client)
cp -r ../AI-OS-backup/clients/* clients/ 2>/dev/null
```

If you backed up custom skills, copy those back into `.claude/skills/` too.

---

## Step 5: Launch through centre

The launcher is now the main entry point. It will detect whether this workspace still needs first-run setup, repair missing local files silently when needed, and then open the UI:

```bash
bash scripts/centre.sh
```

On Windows, use:

```powershell
powershell -File scripts\centre.ps1
```

If you want to run the maintenance scripts manually, `bash scripts/install.sh` still runs the guided installer, and `bash scripts/setup.sh` still refreshes dependency checks.

---

## Step 6: Launch the Command Centre

The Command Centre is a web-based dashboard that shows your tasks, projects, scheduled jobs, and client workspaces in one place. It runs locally on your machine — nothing is sent to external servers.

**Using the `centre` alias (easiest):**

If you chose to install the optional shortcut during the guided first launch, open a new terminal window (important — the shortcut will not be available in the same terminal that installed it) and type:

```bash
centre
```

That's it. It reuses the saved launcher state, repairs missing bootstrap files silently when needed, starts the server, and opens your browser automatically.

On Windows, the guided install can write `centre` into both Windows PowerShell and PowerShell 7 profiles. Open a new PowerShell window after the installer finishes. `bash scripts/setup.sh` does not install the launcher.

If the `centre` command isn't recognised, it usually means your shell has not picked up the new shortcut yet. Try one of these:
- Close and reopen your terminal
- Run `source ~/.zshrc` (Mac), `source ~/.bashrc` (Linux), or `. $PROFILE` (Windows PowerShell) to reload your shell config

**Launching manually (if the alias doesn't work):**

Navigate to the Command Centre folder and start it with npm:

```bash
cd command-centre
npm install    # only needed the first time
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

The Command Centre needs to stay running in its own terminal window. Open a separate terminal for Claude Code.

If you still have an old `projects/briefs/command-centre/` folder from a previous install, that's now just a legacy copy. The active app is `command-centre/` at the repo root, so you can delete the old folder later once you've confirmed the new launcher works.

---

## Step 7: Check Claude is working

Open Claude Code in your new install (in a separate terminal from the Command Centre):

```bash
cd AI-OS
claude
```

A healthy first session should:
- Start silently (no long greeting or checklist — that's the new behaviour)
- Pick up your memory and open threads when you say hello
- Have access to all your brand context and skills
- Show the GSD status line at the bottom if you have active projects

If Claude greets you with the first-run onboarding flow, it means your `brand_context/` files didn't copy over. Check that they're in place and not empty.

---

## Step 8: Clean up

Once you're happy everything works, you can delete the backup:

```bash
rm -rf AI-OS-backup
```

No rush on this — keep it around for a few days if you want to be safe.

---

## What changed under the hood (for the curious)

### The CLAUDE.md split

The old `CLAUDE.md` (517 lines) did everything — operating rules, skill registry, context matrix, service registry, runtime behaviour. Now:

- **`AGENTS.md`** (446 lines) holds the shared operating rules. Any AI tool can read this.
- **`CLAUDE.md`** (92 lines) holds Claude-specific runtime behaviour and imports AGENTS.md with `@AGENTS.md`.

If you'd added custom instructions to `CLAUDE.md`, those operating-level changes now belong in `AGENTS.md`. Claude-specific runtime tweaks (startup behaviour, memory format, greeting style) stay in `CLAUDE.md`.

### Hooks moved from Python to Node.js

The notification hooks that connect Claude to the Command Centre used to run via Python. They're now Node.js scripts in `.claude/hooks/`. This is handled by the new `settings.json` — you don't need to do anything.

### New hooks

Several new hooks were added:
- **Session sync** — keeps the Command Centre in sync with your Claude sessions
- **Branch guard** — gently reminds you to use feature branches for code changes (advisory only, never blocks you)
- **GSD status line** — shows project progress in your terminal

### settings.json changes

The `.claude/settings.json` file has new entries for all the hooks above, plus an experimental agent teams setting. If you'd manually edited this file, compare your backup against the new version — the hook command format changed from `python3 .claude/hooks_info/ccnotify.py` to `node .claude/hooks/run-ccnotify.js`.

### GSD project structure

Old (one project at a time):
```
AI-OS/
├── .planning/                    <-- shared, one at a time
└── projects/briefs/my-project/
```

New (multiple projects in parallel):
```
AI-OS/
└── projects/briefs/my-project/
    └── .planning/                <-- each project owns its own
```

This means you can have several GSD projects running simultaneously. The `/archive-gsd` command now just flips the brief status — it doesn't need to move anything.

---

## If something goes wrong

- Your backup is still at `AI-OS-backup/` (unless you deleted it in Step 8)
- The update script (`bash scripts/update.sh`) also keeps automatic backups in `.backup/` every time it runs
- Open a Claude session and ask — the system knows about its own architecture and can help diagnose issues
