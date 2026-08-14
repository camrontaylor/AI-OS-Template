# AI-OS

Turn Claude Code, Codex, Cursor, Hermes, or another compatible agent harness
into your AI operating system.

AI-OS gives the agent rules, memory, brand context, skills, projects, and client
workspaces so it can work with continuity instead of starting cold every
session.

---

## Quickstart

```bash
git clone https://github.com/camrontaylor/AI-OS-Template.git AI-OS
cd AI-OS
bash scripts/centre.sh
```

That is the whole install. No token, no account, nothing to buy. The repo you just
cloned is the clean template: the system, the skills, and the docs, with no one
else's memory, clients, or keys in it. Your own memory and brand context get built
on your machine as you use it, and they stay there.

On first launch, `centre.sh` runs the guided bootstrap automatically. It checks your system, prepares the local files AI-OS needs, repairs missing dependencies when needed, and asks the one-time setup questions.

When it finishes, open Claude Code and run `/start-here`. If you use another
compatible harness, ask it to follow the first-run guide in
`docs/start-here-first-run.md`.

On Windows, use:

```powershell
powershell -File scripts\centre.ps1
```

### Launching the command centre

After the first guided launch, you can keep using:

```bash
centre
```

That's it. The `centre` command reuses the saved launcher state, repairs missing bootstrap files silently when needed, starts the Next.js dev server, and opens `http://localhost:3000` in your browser.

`install.sh` and `setup.sh` still exist for manual maintenance:
- `bash scripts/install.sh` runs the guided installer directly.
- `bash scripts/install.sh --repair` repairs only the local bootstrap files.
- `bash scripts/setup.sh` refreshes dependency checks without launching the UI.

On Windows, the guided install can optionally add `centre` to both Windows PowerShell and PowerShell 7 profiles. If you prefer not to install the shortcut, keep using `powershell -File scripts\centre.ps1`.

Compatibility note: AI-OS is agent-first. Claude Code is a first-class runtime,
Codex reads `AGENTS.md` directly, Cursor reads the pointer in
`.cursor/rules/ai-os.mdc`, and other harnesses should follow the same project
contract when they support project instructions.

---

## What You Get

AI-OS is built on three practical layers:

1. **Agent identity** -- personality, user profile, and session memory. This is
   what makes the agent feel like it knows your business.

2. **Skills** -- repeatable methods for work like marketing, research, writing,
   operations, system changes, and client delivery.

3. **Brand context** -- voice, positioning, ideal customer profile, offers, and
   samples so output sounds like the business.

For the practical documentation map, start with the [AI-OS Docs](docs/README.md).
For a full install path, read [Install And Setup](docs/install-and-setup.md).
If this is your first session, use [Getting Started](docs/getting-started.md).
For data and cost expectations, read [Cost And
Privacy](docs/cost-and-privacy.md).
For the design source of truth behind these layers, see the [AI-OS Meta
Docs](docs/meta/README.md). They explain the philosophy, architecture, memory
model, health loops, and regression checks future agents should preserve.

---

## Core Skills (always installed)

| Skill | What it does |
|-------|-------------|
| `meta-skill-creator` | Build custom skills for your business |
| `meta-context-intake` | Classify client context inboxes and produce review-gated promotion plans |
| `meta-wrap-up` | End-of-session memory and learning capture |
| `meta-find-skills` | Find a skill across AI-OS's own sources before reaching outside |
| `meta-memory-write` | Save durable facts to the curated working memory in plain words |
| `meta-systems-check` | Health-check the install and report what works, what is missing, what is broken |
| `memory-recall` | Search past AI-OS memory without mistaking MemSearch sandbox errors for missing history |
| `comms-message` | Draft, review, and rewrite direct client messages across all folders |
| `mkt-brand-voice` | Extract your brand voice from content or build it from scratch |
| `mkt-positioning` | Find angles that make your offer stand out |
| `mkt-icp` | Define your ideal customer so every skill speaks to them |
| `ops-versioning` | Save, list, and roll back versions of any document in plain words, no git needed |

---

## Optional Skills

| Skill | What it does | API key needed |
|-------|-------------|----------------|
| `tool-humanizer` | Strip AI patterns from any output | -- |
| `tool-firecrawl-scraper` | Scrape JS-heavy websites | `FIRECRAWL_API_KEY` |
| `tool-youtube` | Pull YouTube transcripts and channel listings | `YOUTUBE_API_KEY` (channel mode only) |
| `coreyhaines-skills-domain` | Brainstorm and check available .com domains (availability, aftermarket price, trademark, handles) | -- (optional `DOMAINR_API_KEY`, `NAMECHEAP_API_*`) |
| `coreyhaines-skills-read-book` | Read a book or long PDF and extract structured notes | -- |
| `q-question` | Answer questions with the right depth of research, source checks, confidence, and client-safe wording | -- |
| `str-trending-research` | Research trending topics across Reddit, X, and the web | `OPENAI_API_KEY` + `XAI_API_KEY` |
| `str-resources` | Capture URL-based resources into AI-OS projects and Notion when available | -- |
| `str-research-findings` | Save pasted research, discovery notes, and reusable findings into the shared research hub | -- |
| `mkt-copywriting` | Sales copy with 7-dimension scoring | -- |
| `mkt-content-repurposing` | Turn one piece of content into posts for 8 platforms | -- |
| `mkt-ugc-scripts` | Short-form video scripts with hook library | -- |
| `viz-excalidraw-diagram` | Architecture and workflow diagrams | -- |
| `str-ai-seo` | Optimize content for AI search engines and LLM citations | -- |
| `str-sitemap-workshop` | Map a full site architecture with a client, lock every integration, and produce an annotated page map | -- |
| `ops-cron` | Schedule recurring Claude Code tasks | -- |
| `ops-agent-email` | Give the agent its own email inbox for signups and magic-link logins | AgentMail account |
| `ops-client-dashboard` | Read a client task board headless (view, screenshot, overview) | shared dashboard login |
| `meta-worktree` | Audit the folder, branches, and worktrees in plain English and tidy up | -- |
| `viz-ad-creative-fal` | Build Claude-powered multi-model paid ad creative batches using fal.ai for photoreal, typography, and short-video concepts | `FAL_KEY` |
| `viz-ad-creative-figma` | Build Claude-powered deterministic, pixel-exact ad templates and offer cards with Figma export, Figma template flows, or local HTML fallback | `FIGMA_TOKEN` optional |
| `viz-ad-creative-codex` | Build paid ad creative batches through the Codex CLI multi-model path | provider keys |

Parked (re-installable with "add a skill"): `viz-interface-design`, `viz-stitch-design`, `tool-stitch`, `viz-ugc-heygen`, `meta-synthesize-locals` - zero recorded use while external skills covered the same ground (2026-07-16 audit).

---

## GSD (Get Stuff Done)

GSD is a project management framework for Claude Code. It's a separate install (not bundled with AI-OS) that adds structured planning, execution, and verification for complex multi-step projects.

**Install GSD:**
```bash
npx -y @opengsd/get-shit-done-redux@latest --global --claude
```

Use it when you're building something with multiple phases -- a product launch, a new feature, a migration. It handles planning, execution, verification, and session continuity. AI-OS install and update scripts can detect legacy GSD packages/artifacts and ask before cleanup. They never remove `.planning/` folders.

**Key commands:**

| Command | What it does |
|---------|-------------|
| `/gsd-new-project` | Start a new project with deep context gathering |
| `/gsd-plan-phase` | Plan a phase with research, task breakdown, and verification |
| `/gsd-execute-phase` | Execute a plan with atomic commits and state tracking |
| `/gsd-progress` | Check where you are and what's next |
| `/gsd-debug` | Systematic debugging with persistent state |
| `/gsd-quick` | Quick task with GSD guarantees (commits, tracking) |
| `/gsd-verify-work` | Validate features through conversational testing |
| `/gsd-pause-work` | Save context for resuming later |
| `/gsd-resume-work` | Pick up where you left off |
| `/gsd-help` | See all available commands |

GSD and AI-OS complement each other. AI-OS handles brand context and skill-driven content production. GSD handles structured project execution when you're building something with phases and milestones.

---

## Managing Skills

```bash
bash scripts/list-skills.sh                  # See what's installed and available
bash scripts/add-skill.sh mkt-copywriting    # Add a skill
bash scripts/remove-skill.sh <skill-name>     # Remove a skill
```

Dependencies are resolved automatically. If you add a skill that needs another skill, both get installed.

---

## Updating

```bash
bash scripts/update.sh --dry-run
bash scripts/update.sh
bash scripts/update.sh --rollback
```

`--dry-run` previews the update without changing your files. `update.sh` pulls the latest AI-OS layer from upstream -- new skills, improved methodologies, bug fixes. `--rollback` lets you undo a finished update by returning to a recovery point that was saved before the update started.

Your brand context, memory, clients, projects, cron jobs, and API keys are never overwritten. The ownership rules live in `config/update-manifest.json`, which separates the AI-OS layer from the user layer.

If you've customised any skills (via feedback, Rules additions, or direct edits), the update script detects this and shows you a diff for each changed skill. You choose per skill: accept our upstream changes, or keep your version. Either way, your version is backed up.

For future-safe customisation, put your edits in local override files instead of changing AI-OS base files directly:

- `SKILL.local.md` beside a skill's `SKILL.md`
- `CLAUDE.local.md` beside `CLAUDE.md`
- user-owned folders like `clients/`, `context/`, `brand_context/`, `projects/`, and `cron/jobs/`

If new skills are available, the script tells you what was added and how to install them.

**If the update fails with an authentication error**, check that your update remote points to the Camron-owned AI-OS template:

```bash
git remote add upstream https://github.com/camrontaylor/AI-OS-Template.git
bash scripts/update.sh
```

---

## Semantic Memory (optional)

AI-OS can search across pinned memory, daily logs, learnings, and client memory.
The markdown files stay the source of truth. Search helpers only make older
notes easier to find.

For the plain-words guide, read [Memory Search, Vector Databases, and AI
Observability](docs/memory-search-and-observability.md). The short rule: use
local AI-OS memory for your workspace, and add production retrieval or tracing
only when an app or client workflow needs it.

The guided installer and updater offer searchable memory as an optional upgrade.
They do not install it silently.

Manual setup:

```bash
bash scripts/setup-memory.sh
```

Diagnostics only:

```bash
bash scripts/setup-memory.sh --check
```

PowerShell on Windows:

```powershell
powershell -File scripts\setup-memory.ps1
```

The setup script installs the search helper, configures the selected runtime,
and runs the first index. It indexes AI-OS memory files, not every file on your
machine.

On macOS/Linux it uses local search storage. On native Windows it may ask for a
hosted search backend, or you can skip semantic recall and rely on markdown
search.

On native Windows, setup disables the real-time `memsearch watch` background helper with the Windows User environment variable `MEMSEARCH_NO_WATCH=1`. This prevents orphaned watcher processes from keeping project folders open. Restart Claude Code and open terminals after setup so they inherit the setting.

Windows memory search still works. Setup runs an initial index, and later refreshes come from the managed AI-OS cron system: keep Command Centre open, or start the existing daemon with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1`. To refresh manually from macOS/Linux or Git Bash, run `bash scripts/memsearch-reindex.sh`; it resolves the canonical AI-OS collection and lists every memory source in one safe pass.

Manual semantic recall goes through the AI-OS wrapper:

```bash
bash scripts/memsearch-search.sh "your query" 10
```

The wrapper searches by meaning and exact markdown matches. From the root
workspace it defaults to root AI-OS memory only. From inside a client folder it
scopes recall to that client. Force a boundary with `--scope root|client|clients|all`
and `--client slug` when needed. If semantic search is blocked, locked, or
missing, it returns markdown recall only. The fallback can also run directly:

```bash
bash scripts/memory-search.sh "your query" 10 --scope all
```

If old watcher processes are already stuck, clear them with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-memsearch-watchers.ps1
```

**First-run index download:** the initial index downloads a local ONNX embedding model (~17 MB) from Hugging Face (one time, then cached). The progress bar can sit at 0% briefly while the connection is established - that is normal. The step is safe to interrupt; the rest of setup still applies, and you can finish it later with `bash scripts/memsearch-reindex.sh` (downloads resume from cache). The setup scripts disable the `hf_transfer` fast path and raise the download timeout to avoid stalls; override `HF_HUB_ENABLE_HF_TRANSFER` or `HF_HUB_DOWNLOAD_TIMEOUT` if you prefer different values.

The old commands still work as compatibility wrappers:

```bash
bash scripts/setup-memsearch.sh
```

Semantic recall is **optional**. Without it, Tier 0 recall (`MEMORY.md` + today's log) still works. Older memory search, expanded recall, and stronger citations stay unavailable until you enable searchable memory.

---

## API Keys

Most skills work without any API keys. Some are enhanced with external services (web scraping, image generation, video creation). All keys go in your `.env` file.

To see every available key with descriptions and signup links:

```bash
cat .env.example
```

Skills will tell you when they could use a key you haven't added yet, and they always offer a fallback so your work isn't blocked.

---

## Scheduled Jobs (Cron)

Run tasks automatically through a managed runtime shared by the Command Centre and the CLI daemon. Drop a markdown file into `cron/jobs/`, then choose which host should keep the scheduler alive.

### How it works

1. The same cron core discovers jobs from the root workspace and every `clients/*` workspace
2. It evaluates schedules, catch-up windows, dedupe, retries, heartbeat, and leadership in one place
3. Matching jobs enqueue tasks and execute them headlessly via `claude -p`
4. Per-job status still lands in `cron/status/`, logs still land in `cron/logs/`, and runtime state lives in `.command-centre/`
5. Only one runtime host becomes leader at a time, so the UI and daemon never double-fire the same minute

### Choose the host

**Command Centre UI**
- The scheduler runs in-process while the Command Centre server is running
- It stops with the server
- It always starts the queue watcher, but only schedules jobs if it wins the leader lock

**CLI daemon**
- Use this when you want scheduling to continue while the UI is closed
- Start and stop it manually
- It writes PID, lock, heartbeat, and logs to `.command-centre/`

### Manage the daemon

**Mac/Linux**
```bash
bash scripts/start-crons.sh
bash scripts/status-crons.sh
bash scripts/logs-crons.sh
bash scripts/stop-crons.sh
```

**Windows (PowerShell)**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\status-crons.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\logs-crons.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-crons.ps1
```

Compatibility note: `install-crons` and `uninstall-crons` still exist, but they are deprecated wrappers around `start-crons` and `stop-crons`. They no longer register anything with Task Scheduler, launchd, or crontab.

The managed runtime uses your Claude plan credits. Each run costs roughly $0.01-0.05 (haiku), $0.05-0.25 (sonnet), or $0.25-2.00 (opus) depending on the model and task complexity.

### Create a job

Each job is a markdown file in `cron/jobs/` with YAML frontmatter and a prompt body:

```markdown
---
name: "My Daily Research"
time: "09:00"
days: "weekdays"
active: "true"
model: "sonnet"
# Optional
# notify: "on_finish"
# description: "Researches trending topics and saves a daily briefing"
# timeout: "30m"
# retry: "0"
---

You are running as a scheduled job for AI-OS.

Read CLAUDE.md for system context.

Task: [Your task here]

Save output to: projects/[folder]/{today's date}_[name].md
```

Or just ask Claude: "schedule a job to [do something] every morning" -- the `ops-cron` skill handles the rest.

### Schedule options

| Setting | Examples |
|---------|----------|
| **Exact time** | `time: "09:00"` or `time: "09:00,13:00,17:00"` |
| **Every N minutes** | `time: "every_5m"`, `"every_10m"`, `"every_30m"` |
| **Every N hours** | `time: "every_1h"`, `"every_2h"`, `"every_4h"` |
| **Days** | `days: "daily"`, `"weekdays"`, `"weekends"`, `"mon,wed,fri"` |
| **Model** | `model: "haiku"` (cheap), `"sonnet"` (default), `"opus"` (powerful) |

Full reference: `cron/templates/schedule-reference.md`

### Notifications & status

- **OS notifications** -- jobs send a native notification when they finish. Control this with the `notify` field: `"on_finish"` (default, notifies on success and failure), `"on_failure"` (errors and timeouts only), or `"silent"` (never notify).
- **Smart silence** -- monitoring jobs that find nothing to report can suppress their notification automatically. The job's prompt tells Claude to end with `[SILENT]` when there's nothing actionable. The job still logs normally -- you just don't get pinged for "all clear" results.
- **No duplicate runs** -- if a job is still running when the next scheduled trigger fires, the new run is skipped. This prevents slow jobs from piling up. If a previous run crashed without cleaning up, the system detects the stale state and recovers automatically.
- **Status tracking** -- each job writes its result to `cron/status/`. The managed runtime also tracks leadership, heartbeat, PID, and daemon logs in `.command-centre/`.
- **Catch-up on wake** -- if your laptop was closed during a scheduled fixed-time job, it runs automatically when the machine wakes up. Interval jobs (`every_Nh`) resume on the next matching interval without catching up.
- **Timeout** -- prevents runaway jobs. Default is 30 minutes. Configure per job with the `timeout` field (e.g., `"5m"`, `"1h"`, `"90s"`). If a job exceeds its timeout, the process is killed and the result is recorded as `timeout`.
- **Retry** -- set `retry: "1"` (or higher) to automatically re-run a job on failure. Each retry gets the full timeout. Default is 0 (no retries).

### Manage jobs

| Action | How |
|--------|-----|
| **Pause a job** | Set `active: "false"` in the job file |
| **Resume a job** | Set `active: "true"` in the job file |
| **Run a job now** | `bash scripts/run-job.sh {job-name}` on macOS/Linux or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-job.ps1 {job-name}` on Windows |
| **Check logs** | `cat cron/logs/{job-name}.log` |
| **List all jobs** | `ls cron/jobs/` or ask Claude "what's scheduled?" |
| **Start the daemon** | `bash scripts/start-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1` |
| **Stop the daemon** | `bash scripts/stop-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-crons.ps1` |
| **Check runtime status** | `bash scripts/status-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\status-crons.ps1` |
| **Show daemon logs** | `bash scripts/logs-crons.sh` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\logs-crons.ps1` |

Stopping the daemon only stops automatic scheduling. Your job files in `cron/jobs/` are never deleted.

### Important notes

- **No OS scheduler fallback** -- automatic scheduling no longer depends on Task Scheduler, launchd, or crontab.
- **UI behavior** -- if you rely on the Command Centre host, scheduling stops when the server stops.
- **CLI behavior** -- the daemon is manual. Start it when you want background scheduling and stop it explicitly when you do not.
- **Leader lock** -- if the UI and daemon coexist, only one of them schedules jobs. The other host stays passive.
- **Legacy scripts** -- `run-crons` is deprecated and no longer performs scheduling.
- **Existing sessions:** Jobs run as separate headless processes -- they don't interfere with any open Claude Code session.

---

## Windows Notification Theme

Windows notification visuals and default copy live in `scripts/windows-notify.config.json`.

- `app` controls the Windows app identity, display name, Start Menu shortcut name, generated asset cache version, optional attribution, default toast duration, and the default layout (`compact` or `hero`).
- `assets.logoPath` should point to the toast logo image. `assets.shortcutIconPath` should point to the Windows shortcut icon and must be an `.ico` file.
- The repo-tracked asset folder for Windows branding is `scripts/assets/windows-notify/`.
- `assets.heroPaths.*` can point to optional background images for hero mode. If blank or missing, the helper generates the hero background and overlays the event-specific text on top.
- `assets.generatedLogo` controls the fallback logo artwork when the configured toast logo image is missing.
- `assets.variants.*` controls the gradient palette, accent colors, sound, and emoji for each notification variant.
- `copy.interactive.*` and `copy.cron.*` define the default `status`, `subject`, `detail`, `variant`, `duration`, and `layout` for each Windows notification event.
- Supported template placeholders are `{project}`, `{seq}`, `{duration}`, `{rawMessage}`, `{jobName}`, `{timeout}`, `{exitCode}`, and `{catchUpSuffix}`.

Preview the default compact toast with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-notify.ps1 -Variant success
```

Preview hero mode explicitly with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-notify.ps1 -Variant success -Layout hero
```

If you change generated colors, layout, or badge text, either bump `app.assetVersion` in `scripts/windows-notify.config.json` or delete the cached folder under `%LOCALAPPDATA%\AgenticOS\notifications\` so Windows rebuilds the generated assets.

---

## Multiple Clients

If you work with more than one client or brand, just tell Claude: **"add a client called [name]"**. It creates the workspace, and offers to switch you into it.

You can also do it manually:

```bash
bash scripts/add-client.sh "Client Name"
cd clients/client-name
claude
```

Each client has its own brand context, memory, and output. Shared methodology now lives in `AGENTS.md` at the root, with `CLAUDE.md` importing it for Claude Code. Skills and scripts sync automatically when you run `update.sh`.

`clients/` is user-owned. Starter files live in `templates/client/`, and `add-client.sh` copies them into a new client workspace without making upstream own that workspace.

If you ask for one specific client while working from the root, AI-OS pauses and asks whether to switch scope to `clients/{slug}/` before it writes memory, projects, or outputs. The guard discovers clients from `clients/*`, so it scales beyond today's folders.

For the full setup guide, see [docs/multi-client-guide.md](docs/multi-client-guide.md).
For how projects work (single tasks, planned projects, GSD), see [docs/projects-guide.md](docs/projects-guide.md).
For a quick reference, see [docs/cheat-sheet.md](docs/cheat-sheet.md).

---

## Working As A Team

Two separate things, so pick the one you actually want.

**Share the system with your team.** Your private repo stays private. Your team gets a separate clean repo built from the system files only, with clients, projects, your personal profile, your local rules, and the vendored skills library all stripped out. There is a leak check before anything is published.

```bash
bash scripts/make-team-copy.sh [destination] [team-repo-url]   # first time
bash scripts/team-status.sh                                    # check before publishing
bash scripts/team-publish.sh <team-repo-url>                   # later updates
bash scripts/team-join.sh <team-repo-url>                      # teammates run this
```

**Share knowledge with your team.** Turn on the `team-knowledge` pack and you get a `team_context/` folder for shared decisions and operating notes, kept separate from your personal memory.

Full guide: [docs/team-sharing.md](docs/team-sharing.md).

---

## Optional Capabilities

Some architecture ships with AI-OS but stays switched off, so it is there when you need it without adding weight when you don't. Nothing in `.aios/optional/` loads at startup, installs anything, changes routing, or creates folders until you enable it.

```bash
bash scripts/optional-list.sh                        # what is available
bash scripts/optional-status.sh [capability]         # inspect one
bash scripts/optional-enable.sh team-knowledge       # turn one on
bash scripts/optional-disable.sh team-knowledge      # turn it off again
```

| Pack | What it gives you |
|------|-------------------|
| `team-system` | Safe two-repo sharing for the system itself |
| `team-knowledge` | A `team_context/` folder for shared decisions and notes |
| `shared-clients` | Scaffold for shared client work, separate from your private `clients/` |
| `context-farmers` | Scaffold for connector-backed ingestion that lands in an inbox first |

Turning a pack off removes the marker and leaves any work you created in place. Which packs you have enabled is local to your machine and never forced on teammates.

Full guide: [docs/optional-capabilities.md](docs/optional-capabilities.md).

---

## File Structure

```
├── context/
│   ├── SOUL.md            <- Agent personality and behaviour rules
│   ├── USER.md            <- Your preferences and working style
│   ├── learnings.md       <- Accumulated skill feedback (gets smarter over time)
│   └── memory/            <- Daily session logs (auto-links to active projects)
├── brand_context/         <- Your brand data (voice, positioning, ICP)
├── .claude/skills/        <- Installed skill packs
│   ├── comms-message/     <- Direct client message drafting and review
│   ├── q-question/       <- Evidence-backed answers to question prompts
│   ├── viz-ad-creative-fal/   <- Claude + fal.ai multi-model ad creative factory
│   └── viz-ad-creative-figma/ <- Claude + deterministic Figma/HTML ad creative factory
├── command-centre/        <- Local UI and runtime app (versioned with the repo)
├── cron/jobs/             <- Scheduled job definitions
├── templates/client/      <- Starter files copied into new client workspaces
├── projects/              <- All generated output
│   ├── comms-message/     <- Larger client message packs and reusable templates
│   ├── mkt-copywriting/   <- Single task category folders (Level 1)
│   ├── str-research-findings/ <- Shared reusable research findings
│   └── briefs/            <- Multi-deliverable projects (Level 2/3)
│       └── q2-launch/     <- Project folder with brief.md
│           └── .planning/ <- GSD artifacts (Level 3, per project)
├── scripts/               <- Install, update, manage skills, watchdog
├── AGENTS.md              <- Canonical shared instructions
└── CLAUDE.md              <- Claude wrapper that imports AGENTS.md
```

---

## Quality of Life

A few things baked in to make the day-to-day smoother:

- **CC Notify** -- native OS notifications (Mac & Windows) when Claude finishes a task, needs permission, or is waiting for input. No more checking back every 30 seconds.
- **Auto-download** -- binary outputs (images, videos, PDFs) auto-copy to your Downloads folder.
- **Humanizer gate** -- every skill that produces publishable text automatically strips AI writing patterns before saving.
- **Clickable file paths** -- every saved file shows the full path so you can click to open it.
- **Graceful degradation** -- no skill breaks because something is missing. No API key? Free fallback. No brand context? Solid generic output.

---

## Your Data is Safe

These are yours and are never overwritten by updates:

- **brand_context/** -- your voice profile, positioning, ICP
- **context/** -- your memory, learnings, session history
- **clients/** -- client workspaces, client memory, and client brand context
- **projects/** -- everything the system generates for you
- **cron/jobs/** -- your scheduled jobs
- **.env** -- your API keys (gitignored, never leaves your machine)

---

## Need Help?

Open an issue or discussion on the [AI-OS template repo](https://github.com/camrontaylor/AI-OS-Template), or contact the maintainer directly.

Walkthroughs and community support live in the [Agentic Academy classroom](https://www.skool.com/scrapes/classroom/d1cfafed?md=552b0ba753df4c738843913fb3eb8312). You do not need it to install or run AI-OS - the quickstart above is the whole install.

---

Built and maintained by Camron Taylor.
