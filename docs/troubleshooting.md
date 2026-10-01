# Troubleshooting

| Problem | Try this |
|---|---|
| The agent does not know AI-OS | Open the AI-OS folder as its active project and ask it to read `AGENTS.md`. |
| Start-Here is unavailable | In Codex, say “Help me set up AI-OS.” In Claude, launch from the AI-OS folder before `/start-here`. |
| A skill is not discovered | Ask the agent to read its `.claude/skills/{name}/SKILL.md`; repair links with `python3 scripts/sync-agent-skills.py`. |
| Command Centre will not start | Read the launcher's error. Check Git, Python 3, Node.js/npm, and Claude Code for chat tasks. |
| The browser page is unavailable | Run the launcher again and open the address it prints; normally http://localhost:3000. |
| `centre` is not recognized | Use `bash scripts/centre.sh`, or the PowerShell launcher. The shortcut is optional. |
| A task cannot access an app | Confirm the connection in the active agent. Use supplied files or a draft if access is missing. |
| A job did not run | Check that it is active, the scheduler is running, and the host is awake. Inspect its logs. |
| Yesterday's work is missing | Check `projects/` and the daily memory files. Ask the agent to recover the saved checkpoint. |
| Updates stop with a conflict | Read the recovery report; protect your working data before attempting a merge. |

Describe the problem and paste the relevant error with credentials removed.
Report reproducible template bugs through this repository's Issues page.
