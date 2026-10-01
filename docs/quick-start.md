# Start using AI-OS

1. Put this repository in a folder called **AI-OS**, somewhere easy to find, such as your Desktop.
2. Open that folder as a project in **Codex** or **Claude Code**.
3. Say **“Help me set up AI-OS.”** Answer the business and preference questions, or start a task directly.
4. Ask for one small result. For example: **“Draft a short introduction to my business and save it.”**
5. Review the result. Give feedback, then say **“Wrap up and save the next action.”**

Your work goes in `projects/`. Your business information goes in `brand_context/`.
Preferences and memory go in `context/`. Each client can have its own workspace.

The starter includes these folders from the first download:

```text
AI-OS/
├── AGENTS.md / CLAUDE.md    Instructions for your agent
├── context/                Your profile, preferences and memory
│   ├── SOUL.md
│   ├── USER.md
│   ├── MEMORY.md
│   ├── learnings.md
│   ├── memory/
│   └── transcripts/
├── brand_context/          Your business and brand information
├── projects/               Your work and finished outputs
├── .claude/skills/          The installed skills
├── scripts/                Setup and maintenance tools
└── clients/                Separate workspaces for your clients or brands
```

To create a client workspace, say **“Add a client called [name].”** The agent
builds that client's folders and connects the shared skills.

Personal customisations such as `AGENTS.local.md`, `CLAUDE.local.md` and
`SKILL.local.md` are optional files you add when needed. API keys go in your
local `.env`; the repository includes `.env.example` as its blank starter.

In Claude Code, `/start-here` opens the same setup flow. In Codex, use the plain request above.
You do not need to open the Command Centre or connect an app to begin.

To clone from a terminal:

```bash
cd ~/Desktop
git clone https://github.com/camrontaylor/AI-OS-Template.git AI-OS
cd AI-OS
```

Then launch an installed `codex` or `claude` CLI, or open the folder in the desktop app.
