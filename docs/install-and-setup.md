# Install and setup

## Basic use

Download or clone this repository, name the folder **AI-OS**, and open it in your agent.
Sign into your own Codex or Claude Code account. Ask **“Help me set up AI-OS”**, or describe a task.
You do not need a shared GitHub token, Team OS connection or service key to use the instructions and skills.

For version history and updates, clone instead of downloading a ZIP:

```bash
git clone https://github.com/camrontaylor/AI-OS-Template.git AI-OS
```

If your agent does not discover a skill automatically, ask it to read that skill's
`.claude/skills/{name}/SKILL.md`. Codex uses the relative links in `.agents/skills/`.
After moving the whole folder or changing skills, repair discovery if needed:

```bash
python3 scripts/sync-agent-skills.py
```

## Optional Command Centre

The launcher needs **Git, Python 3 and Node.js/npm**. Its web app requires Node.js
22.13 or newer; use a currently supported Node.js release. The launcher checks what
is present but does not install every missing prerequisite. Chat and scheduled execution
also need **Claude Code installed and signed in**.

From the AI-OS folder:

```bash
bash scripts/centre.sh
```

Windows PowerShell:

```powershell
powershell -File scripts\centre.ps1
```

Follow the guided setup. Optional steps are memory search, a private GitHub backup,
GSD for larger projects, and a `centre` shortcut. The web app opens at
http://localhost:3000. Leave the launcher terminal running.

Missing prerequisite? Install it from its official source, reopen the terminal,
and run the launcher again. The script names the missing tool.
See [troubleshooting](troubleshooting.md).
