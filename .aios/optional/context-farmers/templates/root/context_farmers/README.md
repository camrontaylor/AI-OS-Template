# Context Farmers

This optional folder is for source adapters that collect useful context from
external systems.

Adapters should write summaries or raw captures to an inbox first. They should
not directly change `context/MEMORY.md`, `context/learnings.md`, or canonical
team docs.

Suggested flow:

1. Adapter fetches from a source with the smallest useful permission scope.
2. Adapter writes to `context_farmers/inbox/`.
3. A human or reviewing agent summarizes and promotes reusable material.
4. Promoted material goes into `team_context/` or a specific project doc.
