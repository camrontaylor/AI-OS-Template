# Skills and capabilities

A skill is a reusable method: instructions, examples and checks for a kind of work.
This template contains **94 skills**, shared by Codex and Claude Code.
Ask for the outcome in normal language. The agent should find the relevant skill
and read its instructions. Browse [the catalog](skills-catalog.md) for starting points.

Skills cover finance, marketing, research, strategy, visual work, operations and
workspace maintenance. Their presence makes the method available; it does not
connect an account or install an external service. Some tasks need app access,
credentials, browser tools or a media provider. Plans and drafts often have a manual fallback.

The canonical files are in `.claude/skills/`. Codex discovery links to them through
`.agents/skills/`. Client-local skills and permitted overrides take precedence in that client.
Personal corrections belong in `SKILL.local.md`; shipped definitions stay stable.

Ask **“What skills could help with this task?”** or **“Build a skill for this workflow.”**
To inspect the local inventory, run `bash scripts/list-skills.sh`.
See [building skills](building-skills.md) for maintenance.
