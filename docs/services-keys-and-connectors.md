# Connect services only when you need them

Ordinary work with your files does not need a service key. A connected app lets the
agent read or act in that service, such as Notion, GitHub, Drive or Calendar.
Available connections depend on your chosen agent; a tool reference is not an active connection.

Ask the agent what is connected and what the task needs. Use your agent's normal
connector setup, or follow the relevant tool guide in `.claude/skills/_shared/tools/`.
Use supplied exports or a draft when a service is unavailable.

If a skill needs an API key, copy `.env.example` to a local `.env` and add only the
values you need. Never paste secrets into public files or commit them.
The examples list optional services, not a checklist you must complete.

Before sending, publishing or changing a live account, specify what you want done
and where. An authorized request is the scope; ambiguous targets and tool-required
confirmations still need attention. Review the actual result after execution.
