# Contributing

Describe the problem and expected behavior in an issue or pull request. Use a
feature branch and target `dev` for normal development. Promote releases from
`dev` to `main` through a pull request; checks must pass. Never force-push `main`.

Keep public changes generic: no client names, personal context, session history,
credentials, machine paths or generated databases. Preserve license notices.
Update the user guide when behavior changes, and test the affected flow.

Run `python3 scripts/test-agent-discovery.py`, `python3 scripts/test-launcher-bootstrap.py`,
`bash scripts/check-distribution-hygiene.sh`, and `python3 scripts/check-public-template.py`.
Command Centre changes also need its relevant tests, type checks and a build.
CI runs the broader runtime checks, including PostgreSQL and Windows setup.

For skills, preserve the canonical source in `.claude/skills/`, update the catalog
and registry, and run `python3 scripts/sync-agent-skills.py`.
Public releases need clean starter context and all example jobs paused.
