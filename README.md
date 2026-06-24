# AI-OS

Turn Claude Code, Codex, or Cursor into a shared AI operating system.

AI-OS is Claude-first and tool-aware. It gives your agent personality, memory, brand context, and skills so it works like a team member, not a chatbot. It remembers your brand voice, learns your preferences over time, and runs proven methodologies instead of winging it every session.

---

## Quickstart

Before you start, install:

- Git
- Node.js and npm
- Python 3
- Claude Code, if you want the full first-run onboarding flow

```bash
git clone https://github.com/camrontaylor/ai-os-template.git ai-os
cd ai-os
bash scripts/centre.sh
```

On first launch, `centre.sh` runs the guided installer automatically. It checks your system, prepares the local files AI-OS needs, installs Command Centre dependencies, and offers optional setup for searchable memory, private GitHub backup, GSD, and the `centre` shortcut. Optional tools such as `uv`, `yt-dlp`, `ffmpeg`, and Homebrew unlock extra features, but they are not required for the core system to start.

When it finishes, open Claude Code. If your first message is setup-focused, Claude runs `/start-here` and walks you through your brand foundation - voice, positioning, and ideal customer profile. If your first message is a real task, Claude does the task first and offers setup afterward.

On Windows, use:

```powershell
powershell -File scripts\centre.ps1
```

### Launching the command centre

If you chose to install the optional shortcut during guided setup, open a new terminal and use:

```bash
centre
```

The `centre` command reuses the saved launcher state, repairs missing bootstrap files silently when needed, starts the Next.js dev server, and opens `http://localhost:3000` in your browser. If you skipped the shortcut, use `bash scripts/centre.sh` instead.

`install.sh` and `setup.sh` still exist for manual maintenance:
- `bash scripts/install.sh` runs the guided installer directly.
- `bash scripts/install.sh --repair` repairs only the local bootstrap files.
- `bash scripts/setup.sh` refreshes dependency checks without launching the UI.

On Windows, the guided install can optionally add `centre` to both Windows PowerShell and PowerShell 7 profiles. If you prefer not to install the shortcut, keep using `powershell -File scripts\centre.ps1`.

Compatibility note: AI-OS remains Claude-first, but the shared project instructions now live in `AGENTS.md`. Claude reads them through `CLAUDE.md`, and Codex can read `AGENTS.md` directly.

---

## What You Get

AI-OS is built on three layers:

1. **Agent Identity** -- Personality (SOUL.md), your profile (USER.md), and session memory. This is what makes it feel like working with someone who knows your business.

2. **Skills** -- Modular capabilities that can be added or removed. Each skill follows a tested methodology and self-improves as you give feedback -- corrections go directly into the skill, not just a note.

3. **Brand Context** -- Your voice, positioning, and ideal customer profile. Skills load only what they need, so output stays focused and on-brand.

---

## Core Skills (always installed)

| Skill | What it does |
|-------|-------------|
| `meta-skill-creator` | Build custom skills for your business |
| `meta-wrap-up` | End-of-session memory and learning capture |
| `meta-memory-write` | Save durable facts to the working memory scratchpad |
| `meta-synthesize-locals` | Keep your local skill customizations tidy after updates |
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
| `str-trending-research` | Research trending topics across Reddit, X, and the web | `OPENAI_API_KEY` + `XAI_API_KEY` |
| `mkt-copywriting` | Sales copy with 7-dimension scoring | -- |
| `mkt-content-repurposing` | Turn one piece of content into posts for 8 platforms | -- |
| `mkt-ugc-scripts` | Short-form video scripts with hook library | -- |
| `viz-excalidraw-diagram` | Architecture and workflow diagrams | -- |
| `str-ai-seo` | Optimize content for AI search engines and LLM citations | -- |
| `viz-interface-design` | Design dashboards, admin panels, and SaaS UIs | -- |
| `ops-cron` | Schedule recurring Claude Code tasks | -- |
| `tool-stitch` | Fetch UI designs from Google Stitch projects | gcloud auth |
| `viz-stitch-design` | Design and iterate on UI screens with Google Stitch | gcloud auth |
| `viz-nano-banana` | Generate infographics, sketchnotes, and illustrated diagrams | `GEMINI_API_KEY` |
| `viz-ad-creative-codex` | Build launch-ready ad creative batches natively in Codex with image generation, onboarding, creative matrix, QA, and performance readouts | -- |
| `viz-ad-creative-fal` | Build Claude-powered multi-model paid ad creative batches using fal.ai for photoreal, typography, and short-video concepts | `FAL_KEY` |
| `viz-ad-creative-figma` | Build Claude-powered deterministic, pixel-exact ad templates and offer cards with Figma export, Figma template flows, or local HTML fallback | `FIGMA_TOKEN` optional |
| `viz-ugc-heygen` | Create talking-head and avatar UGC videos | `HEYGEN_API_KEY` |

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
bash scripts/update.sh
```

This pulls the latest changes from upstream -- new skills, improved methodologies, bug fixes. Your brand context, memory, projects, and API keys are never overwritten.

If you've customised any skills (via feedback, Rules additions, or direct edits), the update script detects this and shows you a diff for each changed skill. You choose per skill: accept our upstream changes, or keep your version. Either way, your version is backed up.

If new skills are available, the script tells you what was added and how to install them.

Updates come from the public template repo through an `upstream` remote. Your own private backup repo should be `origin`.

```bash
git remote add upstream https://github.com/camrontaylor/ai-os-template.git
bash scripts/update.sh
```

---

## Semantic Memory (optional)

AI-OS includes a semantic recall layer (Tier 1) that lets Claude Code or Codex search across past sessions, transcripts, learnings, and brand context -- not just today's log.

The guided installer and updater offer this as the recommended memory upgrade, but never install it silently. Claude Code is the default because AI-OS is Claude-first. You can choose Claude Code, Codex, both, or skip for now.

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

The script installs the `memsearch` CLI with `uv tool install "memsearch[onnx]"`, configures the vector backend, configures the selected agent runtime, and runs the initial index. It indexes only AI-OS memory files: `context/memory/`, `context/transcripts/`, `context/learnings.md`, `brand_context/`, and `.memsearch/memory/` when present.

On macOS/Linux it uses local Milvus Lite. On native Windows it uses a free [Zilliz Cloud](https://cloud.zilliz.com) cluster. For the free Zilliz option, choose AWS `eu-central-1` (Frankfurt) or GCP `us-west-1` (Oregon); other regions may require a paid plan. If `ZILLIZ_URI` and `ZILLIZ_TOKEN` are missing, the PowerShell setup opens Zilliz Cloud in your browser and asks you to paste the values. Git Bash prints the same guidance and can open the browser when PowerShell is available.

On native Windows, setup disables the real-time `memsearch watch` background helper with the Windows User environment variable `MEMSEARCH_NO_WATCH=1`. This prevents orphaned watcher processes from keeping project folders open. Restart Claude Code, Codex, and open terminals after setup so they inherit the setting.

Windows memory search still works. Setup runs an initial index, and later refreshes come from the managed AI-OS cron system: keep Command Centre open, or start the existing daemon with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-crons.ps1`. To refresh manually, run `memsearch index context/memory/ context/transcripts/ context/learnings.md brand_context/` (append `.memsearch/memory/` if it exists).

If old watcher processes are already stuck, clear them with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-memsearch-watchers.ps1
```

**First-run index download:** the initial index downloads a local ONNX embedding model (~17 MB) from Hugging Face (one time, then cached). The progress bar can sit at 0% briefly while the connection is established - that is normal. The step is safe to interrupt; the rest of setup still applies, and you can finish it later with `memsearch index <paths>` (downloads resume from cache). The setup scripts disable the `hf_transfer` fast path and raise the download timeout to avoid stalls; override `HF_HUB_ENABLE_HF_TRANSFER` or `HF_HUB_DOWNLOAD_TIMEOUT` if you prefer different values.

The old commands still work as compatibility wrappers:

```bash
bash scripts/setup-memsearch.sh
```

Semantic recall is **optional**. Without it, Tier 0 recall (`MEMORY.md` + today's log) still works. Older semantic recall, transcript drill-down, expanded memory search, and stronger citations stay unavailable until you enable searchable memory.

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

For the full setup guide, see [docs/multi-client-guide.md](docs/multi-client-guide.md).
For how projects work (single tasks, planned projects, GSD), see [docs/projects-guide.md](docs/projects-guide.md).
For a quick reference, see [docs/cheat-sheet.md](docs/cheat-sheet.md).

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
│   ├── viz-ad-creative-codex/ <- Codex-native no-key ad creative factory
│   ├── viz-ad-creative-fal/   <- Claude + fal.ai multi-model ad creative factory
│   └── viz-ad-creative-figma/ <- Claude + deterministic Figma/HTML ad creative factory
├── command-centre/        <- Local UI and runtime app (versioned with the repo)
├── cron/jobs/             <- Scheduled job definitions
├── projects/              <- All generated output
│   ├── mkt-copywriting/   <- Single task category folders (Level 1)
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
- **projects/** -- everything the system generates for you
- **.env** -- your API keys (gitignored, never leaves your machine)

---

## Need Help?

Head to the your community. Post your question and the team or another member will help you out.

---

Built on AI-OS
