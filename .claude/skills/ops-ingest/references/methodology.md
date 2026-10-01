## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/ops-ingest/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-ingest/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /ops-ingest — Raw human input → structured work

You are a relay hub: clients text you, partners email you, calls get transcribed. Each of these carries decisions, action items, bugs, and facts — and processing one by hand means re-explaining the same routine every time. This skill is that routine, written down.

**The contract:** local records and drafts follow the authorized request. External issue creation requires explicit filing authorization; replies are drafts unless sending is explicitly requested.

<a id="files"></a>
## Files

| Path | What |
|---|---|
| `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-ingest/people.yaml` | Person → project/repo/project-record/reply-channel routing (private, gitignored) |
| `projects/ops-ingest/{YYYY-MM-DD}_{name}/raw/{YYYY-MM-DD}_call-<slug>.md` (or `message-<slug>`) | Standalone source record |
| `people.yaml.example` | Config schema with a worked example |

All records stay in the active workspace's dated ingest project folder.

<a id="step-0--get-the-input-and-classify-it"></a>
## Step 0 — Get the input and classify it

In order: content in the prompt → clipboard (`pbpaste`) → ask.

Classify by shape, not by what the user called it:

| Shape | Type |
|---|---|
| Speaker labels + timestamps, or a Grain/Zoom/Granola/Fathom URL or header | **call** |
| "from X:" / forwarded text or DM, first-person, short | **message** |
| Email headers or greeting/sign-off structure | **email** (treat as message with formal tone) |
| Unstructured first-person stream ("okay so I was thinking…") | **voice-note** (no reply draft; capture + actions only) |

Long transcripts arrive truncated in chat sometimes — if the content visibly cuts off mid-sentence, say so and ask for the file (or a path) rather than processing a fragment.

<a id="step-1--identify-who-and-which-project"></a>
## Step 1 — Identify who and which project

Read `people.yaml`. Match participants/senders against `name` and `aliases`.

- **Matched** → you now have the repo, project record, reply channel, and tone notes. Say which routing you're using in one line ("Routing: Jane → acme-app").
- **Unmatched** → ask once: "Who is this and what project does it belong to?" Then offer to append them to `people.yaml` so the question never repeats. If the user declines to add them, process the input with explicit destinations instead of routed defaults.
- **Multiple projects in one call** (common on partner calls) → split extraction by project; route each piece separately.

<a id="step-2--extract"></a>
## Step 2 — Extract

Read the whole input first. Then pull out, with a short verbatim quote or paraphrase anchoring each:

1. **Decisions made** — anything settled, including "we're NOT doing X."
2. **Action items — mine** — things the user owes someone. Include any stated deadline.
3. **Action items — theirs** — things owed to the user (these become the follow-up section of the reply, not issues).
4. **Bugs & feature requests** — anything that should become a GitHub issue. One issue per item, never a grab-bag.
5. **Questions to answer** — asked but unanswered in the input.
6. **Facts worth keeping** — durable context (pricing mentioned, a person's situation, a tool they use) → project record; a genuinely reusable reference → Keep note (only if the `keep` CLI is authed; skip silently otherwise).

**Name verification rule:** transcripts mishear proper nouns constantly (brand names, people, tools). Before a name lands in an issue title, project record, or reply, verify the spelling against the routing config, the repo, or a quick search — never trust the transcript's spelling of a name you can check.

<a id="step-3--show-the-routing-plan"></a>
## Step 3 — Show the routing plan

One compact table before acting:

| # | Item | Destination |
|---|---|---|
| 1 | "Bulk-export button on the reports page" | Issue → `myorg/acme-app` |
| 2 | Decision: monthly billing default | dated ingest project record |
| 3 | Reply to Jane | draft below |

Proceed with authorized local records and drafts. External writes depend on explicit task authorization. Pause for confirmation only when routing is ambiguous (two plausible repos, an unmatched person) or the input includes something sensitive (credentials, legal/financial commitments).

<a id="step-4--execute"></a>
## Step 4 — Execute

**Issues** — search for duplicates first (`gh issue list --search`), then prepare a local issue draft; use `gh issue create` only when filing is explicitly authorized in the mapped repo. Title = imperative summary; body = context quote from the source, what was asked, and who asked. Apply `issue_labels` from config if set. Never assign anyone but the user.

**Project record** — one date-stamped file per ingest, using this standalone structure:

```markdown
# message-jane-bulk-export (2026-09-04)
source: text message from Jane
project: Acme App

<a id="summary"></a>
## Summary
…

<a id="decisions"></a>
## Decisions
…

<a id="action-items"></a>
## Action items
- [ ] mine: …
- [ ] theirs: Jane to …

<a id="filed"></a>
## Filed
- myorg/acme-app#123 — Bulk-export button on the reports page
```

Slug: `call-` or `message-` + person + topic. No automatic commit or remote push; follow explicit version-control instructions.

**Todos** — action items of "mine" also land wherever the person's explicitly configured `project_record` tracks tasks, if one is configured.

**Reply draft** — in the user's voice for that channel (config `tone` + channel norms: text = brief and casual; email = fuller). Structure when it fits: acknowledge → what I'm doing about it → what I need from you → when they'll hear back. End with the draft in a paste-ready block (compose with `/tool-paste` rules for the channel — e.g. no URLs in an X post body). **Never send it.**

<a id="step-5--report"></a>
## Step 5 — Report

Close with a compact recap: TLDR of the input (2–3 sentences), decisions, both action-item lists, links to filed issues, the project record path, and the reply draft. This recap is the deliverable — someone who never saw the input should understand what happened and what's next.

<a id="composes-with"></a>
## Composes with

- `tool-paste` — channel formatting for the reply draft
- `str-deep-research` — when an extracted question needs real research before it's answerable
- `ops-project-management` — when a call produces enough work to deserve a project card, not just issues

<a id="notes-on-quality"></a>
## Notes on quality

- The most common failure is **flattening**: summarizing the input instead of extracting work from it. The test: could the user act on your output without rereading the source?
- Second most common: **issue grab-bags**. "Improvements from call with Jane" is not an issue. One item, one issue, one clear title.
- "Theirs" action items are as valuable as "mine" — they're the follow-up ledger. Don't drop them because no tool call captures them.
- A voice-note ingest with zero action items is fine: capture it, say so, stop. Not every input contains work.
