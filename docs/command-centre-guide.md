# Use the Command Centre

The Command Centre is the optional browser interface for AI-OS. It runs on your computer.
You can also do ordinary work directly in Codex or Claude Code without opening it.

## Open it

From the AI-OS folder, run `bash scripts/centre.sh`.
On Windows, run `powershell -File scripts\centre.ps1`.
If you installed the shortcut, type `centre` instead.

The launcher opens http://localhost:3000. Follow its first-time setup questions.
Keep the terminal running while you work. Closing the browser tab does not stop
the app; stopping the launcher terminal does.

## First use

Click **Run Start-Here** and answer the questions about your business.
This saves context for future work. You can skip setup and begin a task.

## Start working

1. Click **New Goal**.
2. Describe what you want, such as **“Write five LinkedIn posts for my business.”**
3. Click **Send**.
4. Read its replies, answer questions and ask for changes in the same conversation.

| Button | What it is for |
|---|---|
| Feed | Your goals and conversations |
| Scheduled | Create, review, pause or run repeating tasks |
| Skills | See the available methods and their instructions |
| Docs | Read or edit workspace files |
| Settings | Appearance, tools and local configuration |

The interface is grayscale in light and dark modes, including media previews.
The chat and scheduled executor use your local Claude Code installation.
Direct Codex sessions use the same workspace files but have their own agent interface.

## Repeating work

The example jobs start paused. Review each job before enabling it.
Automatic jobs need a running scheduler and an awake computer. A separately started
background scheduler can run without the browser UI; closing a tab is not proof that scheduling stopped.
Use [Background jobs](background-jobs.md) to check status and logs.

Keep the dashboard local or on a deliberately configured private network.
A local dashboard can still make external model and app calls.
