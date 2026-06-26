---
name: memory-recall
description: >
  Search and recall prior AI-OS memory when the user's request could benefit
  from past sessions, previous decisions, project context, debugging notes,
  or "have we seen this before" history. Use this before answering from guesswork
  when the question involves memory, continuity, past client/project work, or
  prior reasoning. Does not trigger for purely current-code inspection where
  grep/read is enough, or when the user explicitly asks to ignore memory.
---

# Memory Recall

Recall useful past context from the AI-OS memory stack without confusing a
tooling failure for missing memory.

## Outcome

- A concise answer grounded in `context/MEMORY.md`, daily logs, learnings, and semantic MemSearch results.
- Source references by file/date where possible.
- If semantic search is unavailable, a clearly labelled **degraded mode** response that says which markdown sources were checked.

## Context Needs

| File | Load level | Purpose |
|------|------------|---------|
| `context/MEMORY.md` | Full | Tier 0 current working memory |
| `context/memory/{today}.md` | Full when present | Today's active session log |
| `context/learnings.md` | `## memory-recall` section | Skill-specific lessons and corrections |

## Skill Relationships

- Upstream: `meta-memory-write` maintains `context/MEMORY.md`; `meta-wrap-up` finalises daily session logs.
- Downstream: Any skill can use this when prior context would change the answer.
- Trigger conflict: For current file/code state, use normal read/search tools first. For remembered decisions, use this skill.

## Step 1: Load Tier 0

Read `context/MEMORY.md`, today's daily log in `context/memory/`, and the
`## memory-recall` section of `context/learnings.md` if it exists.

If Tier 0 fully answers the question, answer from it and cite the source. Do not
run semantic search for a trivial lookup that is already loaded.

## Step 2: Run Semantic Search

When Tier 0 is not enough, run the project wrapper from the repo root:

```bash
bash scripts/memsearch-search.sh "<query>" 10
```

From the root workspace, the wrapper searches root AI-OS memory only by default.
From inside a client folder, it scopes recall to that client. Force a boundary
when needed:

```bash
bash scripts/memsearch-search.sh "<query>" 10 --scope root
bash scripts/memsearch-search.sh "<query>" 10 --scope client --client acme
bash scripts/memsearch-search.sh "<query>" 10 --scope all
```

Do not run raw `memsearch search`, `memsearch expand`, `memsearch index`, or
`memsearch stats` in Codex. The AI-OS authority guard blocks those commands so
the recall path cannot bypass canonical collection resolution, markdown
fallback, or Milvus lock handling.

Choose a query that captures the user's real question, not just their exact words.
The wrapper resolves the AI-OS canonical collection and reranks results. If
MemSearch can start, the wrapper also runs markdown recall and fuses both result
sets so exact specific matches can outrank broad semantic matches. If MemSearch
cannot start because Milvus is blocked, locked, or missing, the wrapper returns
sandbox-safe markdown fallback results only.

Semantic indexing is for root/client memory and learning files. Client brand
context is available only through client-scoped markdown fallback. Root brand
context and transcript archives are explicit deep-search/reference surfaces, not
routine memory recall.

For semantic recall in Codex, run the command with escalated permissions from
the first attempt:

- `sandbox_permissions`: `require_escalated`
- justification: `MemSearch uses Milvus Lite, which needs its local LOCK file and a 127.0.0.1 port even for read-only semantic search.`

If escalation is not available, run the same command normally anyway. It will
return deterministic markdown results with `search_mode: "markdown_fallback"`.

## Step 3: Use Markdown Fallback When Needed

The fallback can also be run directly:

```bash
bash scripts/memory-search.sh "<query>" 10 --scope all
```

This searches root `context/MEMORY.md`, `context/memory/`,
`context/learnings.md`, plus the same memory surfaces under every `clients/*`
folder when scope includes clients. Client `brand_context/` is included only
when client scope is included. Root `brand_context/`, transcript archives, and
plugin `.memsearch/memory/` shadow captures are diagnostic or reference material
only; they are not routine authoritative AI-OS recall sources.

Treat markdown fallback as a valid recall layer, not a last-ditch manual scrape.
It is less semantic than MemSearch, but it is faithful to AI-OS because it reads
the same authoritative markdown sources.

## Step 4: Expand Context

Use the returned source paths, dates, and line hints to read the most relevant
source sections directly. If direct `memsearch expand <chunk_hash>` is useful,
run it with the same Codex escalation rule as search.

Prefer the original markdown source over quoting raw search snippets. Search is
for finding; source files are for answering.

## Step 5: Degraded Mode

Use degraded mode only when both the semantic path and `scripts/memory-search.sh`
are unavailable or insufficient.

In degraded mode:

1. Say **degraded mode** plainly.
2. Read `context/MEMORY.md`, `context/memory/*.md`, and `context/learnings.md`.
3. Run:
   ```bash
   bash scripts/lib/memory-meta.sh "<topic>"
   ```
4. Answer from markdown sources only and say semantic search was not used.

Do not say "no memory found" just because Milvus could not open. That is a tool
availability issue, not evidence that the memory is empty.

## Step 6: Return The Recall

Structure the answer by relevance:

- Lead with the useful remembered fact or decision.
- Cite the source inline, using file/date names.
- Add temporal context when it matters, especially if the source is older than 14 days.
- For partial or absent results, say where you looked and what could fill the gap.

Keep it short unless the user asks for a full history.

## Rules

- 2026-06-25: In Codex, every MemSearch semantic command needs escalated permissions from the first attempt because Milvus Lite needs both a local lock file and a loopback port, even for read-only search.
- 2026-06-25: If MemSearch returns `Operation not permitted`, `Failed to bind to address`, `Open local milvus failed`, `DataDirLockedError`, or a `LOCK` error, treat it as tool availability. Retry escalated or use labelled degraded mode; never treat it as empty memory.
- 2026-06-25: Use `scripts/memory-search.sh` as the Tier 1.5 fallback before manual degraded-mode reading. It is the sandbox-safe AI-OS recall layer.
- 2026-06-25: Raw MemSearch commands are blocked in Codex. Use `scripts/memsearch-search.sh` for recall and `scripts/memsearch-reindex.sh` for indexing.
- 2026-06-25: `scripts/memsearch-search.sh` must use hybrid recall: semantic MemSearch plus exact markdown recall fused together, because semantic-only results can be too broad.
- 2026-06-25: Multi-client recall must be generic across every `clients/*` workspace. Root recall defaults to root AI-OS memory only; client-folder recall defaults to that client; force `--scope root|client|clients|all` when the boundary matters.
- 2026-06-25: Do not index client `brand_context/` trees semantically; some contain design systems and app assets. Client brand context is available in client-scoped markdown fallback only.
- 2026-06-25: Do not include transcript archives in routine semantic indexing or standard markdown fallback. Keep transcripts behind explicit deep-search so regular memory recall stays bounded and root searches do not surface client meeting material.
- 2026-06-25: Do not treat `.memsearch/memory/` plugin shadow captures as authoritative AI-OS memory. They can be inspected for diagnostics, but routine recall and indexing should use root/client `context/MEMORY.md`, `context/memory/`, and `context/learnings.md`.

## Self-Update

If the user flags a missed source, a wrong fallback, or a confusing memory answer,
update the `## Rules` section in this SKILL.md immediately with the correction.
Do not only log it to learnings.

## Troubleshooting

- `memsearch not installed`: use degraded mode and suggest `bash scripts/setup-memory.sh`.
- `Operation not permitted` or `Failed to bind to address 127.0.0.1`: in Codex, rerun with escalated permissions.
- `DataDirLockedError` or another process holds the lock: an index/search process is active. Do not start another index; use degraded mode and retry semantic search later.
