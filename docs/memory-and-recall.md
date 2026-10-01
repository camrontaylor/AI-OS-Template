# Memory and recall

AI-OS saves useful context in readable files. `context/MEMORY.md` is the short
working note; `context/memory/` holds daily session records; `context/learnings.md`
holds corrections and lessons. Client workspaces have their own context.

At the end of a session say **“Wrap up and save the decisions and next action.”**
Next time ask **“Recover our last checkpoint and show me what to do next.”**
Check the saved note when a decision matters. Memory is a record to consult, not
proof that a fact is still current or that every chat was captured.

Claude hooks can capture session events. Codex follows the shared startup and
wrap-up instructions. They are different capture paths, with one workspace format.
Your agent can read and search the files without enabling semantic memory.

Optional memory search by meaning uses local PGLite/pgvector and BGE-M3 embeddings.
Its first setup downloads a model and can take several minutes. Hosted Postgres is optional.
Use `bash scripts/setup-memory.sh` to set it up, or
`bash scripts/setup-memory.sh --check` for diagnostics.
Technical details: [memory retrieval](memory-retrieval.md).
