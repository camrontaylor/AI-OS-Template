# AI-OS Meta Docs

These docs explain how AI-OS is meant to work, why it is designed this way, and
how future agents should tell the difference between healthy evolution and
accidental regression.

`AGENTS.md` is still the runtime contract. These meta docs are the design source:
they explain intent, architecture, operating loops, and regression tests.

## Start Here

| Doc | Purpose |
|---|---|
| [Design Philosophy](design-philosophy.md) | The principles behind AI-OS: agent-first, local-first, self-improving, approval-gated. |
| [System Architecture](system-architecture.md) | How instructions, skills, clients, hooks, memory, cron, and reports fit together. |
| [Memory Architecture](memory-architecture.md) | How hot memory, daily logs, learnings, markdown fallback, MemSearch, and Milvus Lite relate. |
| [Health And Regression](health-and-regression.md) | What AI-OS must monitor, what counts as drift, and how to prove the system is healthy. |
| [Evolution Log](evolution-log.md) | Why major design choices changed over time, so old problems are not reintroduced. |

For a user-facing version of the memory search and tooling decisions, see
[`../memory-search-and-observability.md`](../memory-search-and-observability.md).
For a practical maintainer guide, see
[`../design-and-contributing.md`](../design-and-contributing.md).

## How Agents Should Use This

When changing AI-OS:

1. Read `AGENTS.md` for the rule.
2. Read the relevant meta doc for the intent.
3. Update the meta doc when the design changes.
4. Add or update a health check when a failure mode should not depend on memory.
5. Treat a recurring manual fix as a design gap, not as normal maintenance.

## Current Source Of Truth Map

| Concern | Runtime Source | Meta Source |
|---|---|---|
| Agent behavior | `AGENTS.md` | [Design Philosophy](design-philosophy.md) |
| Memory | `context/`, `clients/*/context/`, scripts | [Memory Architecture](memory-architecture.md) |
| Skills | `.claude/skills/`, generated `docs/skills-catalog.md`, `skills-library/` | [System Architecture](system-architecture.md) |
| Clients | `clients/*/`, `scripts/update-clients.sh` | [System Architecture](system-architecture.md) |
| Health | `meta-systems-check`, audit scripts, cron jobs | [Health And Regression](health-and-regression.md) |
| Change rationale | git history, project reports, daily logs | [Evolution Log](evolution-log.md) |

## External References

- [Milvus Lite documentation](https://milvus.io/docs/milvus_lite.md)
- [Milvus Lite GitHub repository](https://github.com/milvus-io/milvus-lite)
- [MemSearch architecture](https://zilliztech.github.io/memsearch/architecture/)
- [MemSearch design philosophy](https://zilliztech.github.io/memsearch/design-philosophy/)
