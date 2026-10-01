# AI-OS Template

Give your AI assistant a place to keep your business context, follow your processes,
and carry useful decisions into the next session.

AI-OS is a folder you keep on your own computer. It contains readable instructions,
notes, skills and project files. Open it in Codex or Claude Code and ask for an
outcome: a proposal, a campaign, a research summary, a client deliverable or a code change.
The agent uses the relevant context and skills, saves the work, and records what
the next session needs.

## Get started

1. **Download AI-OS.** Give your agent this link:
   https://github.com/camrontaylor/AI-OS-Template

   Then ask:
   > Download this repository into a folder on my Desktop called AI-OS.

   You can also use **Code → Download ZIP** on GitHub, unzip it, and rename the folder
   `AI-OS`. A Git clone is the better choice if you want Git version history and updates.

2. **Open the AI-OS folder in Codex or Claude Code.** Use your own account in the chosen tool.

3. **Say “Help me set up AI-OS.”** The agent asks about your business, audience and
   working preferences. Claude Code also supports `/start-here`. You can skip this
   interview and begin a task directly.

4. **Try one small task.** For example:
   > Draft a short introduction to my business. Save it, show me the file, and flag any claims that need evidence.

No shared token, Team OS account, dashboard or paid integration is required for
basic file-based work. Your chosen AI tool may require a subscription or API billing.

Prefer to clone it yourself?

```bash
cd ~/Desktop
git clone https://github.com/camrontaylor/AI-OS-Template.git AI-OS
cd AI-OS
```

## What is included

| Part | What it does |
|---|---|
| Business context | Your voice, positioning, audience, examples and preferences |
| Memory | Saved decisions, feedback and unfinished work across sessions |
| 93 skills | Repeatable methods for marketing, strategy, research, finance, visual work and operations |
| Projects | A predictable home for briefs, drafts and finished deliverables |
| Client workspaces | Separate context and outputs for each client, with shared skills |
| Command Centre | An optional grayscale browser interface for chats, files and scheduled work |
| Setup and maintenance scripts | Local setup, skill discovery, updates, recovery and optional scheduling |

Browse the [included skills](docs/skills-catalog.md). A skill is a set of instructions;
account access, image/video rendering and automation still need the appropriate tools.
All nine example scheduled jobs start **paused**.

## How it works

You describe the work. The agent reads the relevant instructions and context,
chooses a skill, does the work, checks it, and saves the result. At the end of a
session, ask it to wrap up and save the decisions and next action. In a later
session, ask it to recover that checkpoint.

The files are yours to inspect and edit. Memory improves continuity; it is not a
guarantee that every agent remembers every chat. Current facts still need checking.

Codex reads `AGENTS.md` and discovers the shared skills through `.agents/skills/`.
Claude Code reads `CLAUDE.md` and `.claude/skills/`. Other file-aware agents can use
the workspace, but automatic skill discovery, hooks and slash commands vary by tool.
The Command Centre chat and scheduled executor use Claude Code.

## Optional: open the Command Centre

You can do ordinary AI-OS work directly in your agent. The Command Centre gives you
buttons and screens for conversations, skills, saved files and recurring jobs.

From the AI-OS folder, run:

```bash
bash scripts/centre.sh
```

On Windows PowerShell:

```powershell
powershell -File scripts\centre.ps1
```

First launch checks the setup, installs app dependencies, and offers optional
memory search, private backup, GSD and a `centre` shortcut. It requires Git,
Python 3 and Node.js/npm. Claude Code must be installed and signed in to run chat tasks.
The launcher opens http://localhost:3000. Keep its terminal running while using it.

Read the [simple Command Centre guide](docs/command-centre-guide.md) for daily use.

## Your data and costs

This public repository contains blank starter profiles and no personal session history,
client data, credentials or local databases. Your working data is created in your copy.

AI-OS is local-first, not offline-only. Your agent can send prompts and selected file
content to its model provider. Connected apps, scheduled jobs and hosted services
can incur costs. Connect only what the work needs.

**Keep your working repository private.** Context, brand files and project outputs
can be tracked in Git. Do not push personal work to a public fork or this template.
Secrets belong in your local `.env`, which is ignored by Git. A private backup is
optional; it is separate from this public download.

Read [cost and privacy](docs/cost-and-privacy.md) and [backups and updates](docs/backups-and-updates.md).

## Guides

- [Start here](docs/quick-start.md)
- [What AI-OS is](docs/what-ai-os-is.md)
- [First-use setup](docs/start-here-first-run.md)
- [Install and setup](docs/install-and-setup.md)
- [Memory and recall](docs/memory-and-recall.md)
- [Skills and capabilities](docs/skills-and-capabilities.md)
- [Projects](docs/projects-guide.md) and [client workspaces](docs/multi-client-guide.md)
- [Background jobs](docs/background-jobs.md)
- [Troubleshooting](docs/troubleshooting.md)
- [All documentation](docs/README.md)

The companion [AI-OS Notion docs](https://app.notion.com/p/AI-OS-Docs-388c6192c2668144b92bd6abcd456a74)
contain the broader working documentation. Where a draft describes a feature this
release does not include, the files and guides in this repository are authoritative.

## Development and attribution

See [contributing](CONTRIBUTING.md), [security](SECURITY.md) and
[third-party notices](THIRD_PARTY_NOTICES.md). The AI-OS license is [MIT](LICENSE);
bundled third-party skill materials retain their supplied notices.

Built and maintained by Camron Taylor. This is the current template replacing the legacy edition.
