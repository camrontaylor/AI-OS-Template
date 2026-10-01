# Start using AI-OS

1. Put this repository in a folder called **AI-OS**, somewhere easy to find, such as your Desktop.
2. Open that folder as a project in **Codex** or **Claude Code**.
3. Say **“Help me set up AI-OS.”** Answer the business and preference questions, or start a task directly.
4. Ask for one small result. For example: **“Draft a short introduction to my business and save it.”**
5. Review the result. Give feedback, then say **“Wrap up and save the next action.”**

Your work goes in `projects/`. Your business information goes in `brand_context/`.
Preferences and memory go in `context/`. Each client can have its own workspace.

In Claude Code, `/start-here` opens the same setup flow. In Codex, use the plain request above.
You do not need to open the Command Centre or connect an app to begin.

To clone from a terminal:

```bash
cd ~/Desktop
git clone https://github.com/camrontaylor/AI-OS-Template.git AI-OS
cd AI-OS
```

Then launch an installed `codex` or `claude` CLI, or open the folder in the desktop app.
