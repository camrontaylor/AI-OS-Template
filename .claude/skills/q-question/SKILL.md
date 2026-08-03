---
name: q-question
description: "Answer a question with the right level of research, evidence, and judgement, scaling depth to the stakes: a quick fact, a verified current claim, or a fully researched answer with sources and confidence. Best when the main intent is a question, especially feasibility, should-I, comparison, or client-facing ones. Not for URL capture, trend research, or drafting client messages (str-resources, str-trending-research, comms-message)."
when_to_use: 'Invoke when the request sounds like: "is this possible?", "can we do X?", "should I do X?", "find out", "look into", "what do you think?", "client asked if", "verify this", "compare these". Scales depth to the stakes'
---

# Question

Answer questions like an operator who has to live with the answer: clear bottom line first, then only as much research, caveat, and evidence as the situation deserves.

## Outcome

- A direct chat answer with a confidence level and the evidence path when research matters.
- For substantial research, a markdown brief saved under `projects/q-question/{YYYY-MM-DD}_{topic}/`.
- For client-facing questions, a safe wording block the user can send without overpromising.
- For uncertain answers, a short list of what would change the answer.

## Context Needs

Client questions: run `bash scripts/agency-gather.sh <slug>` (from the AI-OS root) FIRST. It refreshes and inlines the curated brief, client MEMORY.md, and client learnings in one pass, then manifests the rest for targeted reads. The table below is what to load when gather is unavailable or the question is not client work.

| File | Load level | Purpose |
|------|------------|---------|
| `context/learnings.md` | `## q-question` section | Apply prior feedback about question depth, source quality, and answer format. |
| `context/MEMORY.md` | Summary when relevant | Use active threads, decisions, and project state when history could change the answer. |
| `clients/*/AGENTS.md` | When in a client folder | Follow client-specific constraints, facts, and tone rules. |
| `clients/*/context/` | Targeted scan when a named client/project matters | Avoid wrong facts about the client, scope, status, promises, or relationship history. |
| `references/research-frameworks.md` | Full when research is non-trivial | Use the question taxonomy, source tiers, confidence rubric, and output templates. |

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|------------------|------------|
| `memory-recall` | Required when history matters | Prior decisions, project context, and memory-backed facts. | Say memory was not checked and keep the answer scoped to current context. |
| `str-resources` | Optional | Captures a supplied URL as a durable resource. | Use normal browsing/read tools and do not file the source unless asked. |
| `str-trending-research` | Optional | Fresh community and trend research from the last 30 days. | Use normal web research without engagement-weighted trend claims. |
| `comms-message` | Optional | Turns findings into a client-ready message. | Provide a short wording block only, not a full message workflow. |
| `str-research-findings` | Optional | Saves reusable user-provided findings into the research hub. | Keep the answer in chat unless the user asks to save. |

## Skill Relationships

- Upstream: Adapted from the research pattern in Anthropic's `knowledge-work-plugins@customer-research`, selected through `meta-find-skills` because it has strong public usage signals and useful source-tier/confidence rules.
- Upstream: AI-OS Thinking Discipline in `AGENTS.md` supplies assumption checks and pushback for decisions.
- Downstream: `comms-message`, strategy skills, client work, and implementation planning can use the answer.
- Trigger conflict: If the user wants a URL saved, use `str-resources`. If the user wants current public chatter or trends, use `str-trending-research`. If the user wants a message drafted, use `comms-message`. If the user says "save this finding", use `str-research-findings`. If the user is asking a question and needs an answer, use this skill.

## Before You Start

Classify the question before researching:

- **Direct:** stable, low-risk, answerable from current knowledge.
- **Contextual:** depends on AI-OS memory, a client folder, prior decisions, or project state.
- **Current:** likely changed recently, such as docs, pricing, law, product capability, APIs, tools, or market state.
- **Technical:** needs primary docs, code, platform limits, or architecture judgement.
- **Decision:** asks what to do, not only what is true.
- **Client-facing:** the answer may be repeated to a client, affect scope, or imply a promise.
- **Deep research:** broad, contested, multi-source, high-stakes, or strategically important.

Use the lightest depth that would not mislead the user.

## Step 1: Read Learnings And Local Context

Read `context/learnings.md` under `## q-question` before producing the answer. If the section is missing, proceed and add it during skill creation or wrap-up.

If the question involves a client, current project, prior promise, past decision, or anything phrased like "as discussed", invoke `memory-recall` or directly search the relevant memory/project files before answering.

## Step 2: Decide The Research Depth

Use this depth ladder:

| Depth | Use when | Required work |
|-------|----------|---------------|
| Quick answer | Stable, low-risk, no likely hidden context | Answer directly. No broad research. |
| Verified answer | Current, technical, client-facing, or fact-sensitive | Check primary/current sources and cite them. |
| Deep research | Multi-source, strategic, contested, costly, or high-stakes | Read `references/research-frameworks.md`, decompose the question, compare sources, show confidence and gaps. |

Ask one clarifying question only if a wrong assumption would materially change the answer. Otherwise state the assumption and keep moving.

## Step 3: Build The Evidence Path

For verified and deep answers, choose sources in this order:

1. User-provided context and files.
2. Current client or AI-OS memory when history matters.
3. Official docs, primary sources, source code, product pages, laws, standards, or vendor docs.
4. Reputable secondary analysis, community evidence, reviews, forums, or examples.
5. Inference from patterns or analogous cases.

Do not treat inference as proof. Label it plainly.

For technical questions, prefer official docs and local code over blogs. For current facts, browse. For client-facing feasibility, separate what is natively supported from what is possible with a workaround.

## Step 4: Synthesize The Answer

Lead with the bottom line:

```text
Short answer: [yes / no / yes with conditions / likely / unclear]
```

Then include only the sections the question needs:

- What is true
- What is possible
- Limits or constraints
- Best path
- Confidence
- Sources checked
- What would change the answer
- Client-safe wording

For simple questions, this can be one paragraph. For client-facing or decision questions, include the confidence and caveat even if the answer is short.

## Step 5: Handle Contradictions And Gaps

When sources disagree:

1. Name the disagreement.
2. Prefer the more primary, current, or context-specific source.
3. Explain the practical effect.
4. Give the safest usable answer.

When evidence is weak, say so. Do not pad the answer with generic caveats. Say exactly what is unknown and how to verify it.

## Step 6: Save Output When Needed

Only save when the work produced a durable research brief, reusable decision note, or the user asks to save it. Quick answers stay in chat.

When saving, resolve the AI-OS repo root first:

```bash
git rev-parse --show-toplevel
```

Always save output to disk when creating a brief. This is not optional. Save to:

```text
{AI-OS repo root}/projects/q-question/{YYYY-MM-DD}_{topic-slug}/{YYYY-MM-DD}_question.md
```

After saving, show the user the full absolute file path so they can click it directly.

## Step 7: Ask For Feedback

After a substantial answer or saved brief, ask whether the depth, evidence, and format were useful. If the user corrects the process, update `## Rules` in this skill immediately and log broader feedback under `## q-question` in `context/learnings.md`.

## Rules

- 2026-07-29: When the user supplies a prior analysis or critique to evaluate against an existing client-facing document, do not incorporate its conclusions first. Audit each material claim against the original client evidence and current primary vendor documentation, give the user the verdict, and only then revise the document.
- 2026-07-29: For ERP/CRM feasibility where the connector operates at database level, research the published database schema and the connector's SQL model before treating public REST API coverage as the boundary. Classify read visibility, safe writes, configuration-dependent details, and custom builds separately before drafting a client-facing answer.

- 2026-07-02: This is a broad question skill by design, but depth must scale. Do not turn stable one-line questions into research projects.
- 2026-07-02: For "can we build/do this for a client?" questions, answer in two layers: what is natively supported, and what is possible with custom code, integrations, or external services.
- 2026-07-02: Client-facing answers need safe wording that avoids overpromising before plan, access, data, pricing, or implementation limits are checked.
- 2026-07-02: Current platform, pricing, API, legal, medical, financial, or market claims require current source checks before giving a confident answer.
- 2026-07-06: Feasibility, blocker, "is this possible?", and "what are my options?" questions must not stop at a shallow no/can't/not supported answer. Research how others solve it, check current sources when tool/platform behavior may have changed, separate native support from workarounds and remote/third-party paths, then recommend the best practical option with confidence and a smallest next test.
- 2026-07-21: Evidence Discipline (AGENTS.md) binds any answer relied on beyond the chat: re-ground each load-bearing claim at its source, never a prior summary, snapshot, or memory line; tag every claim as verified fact (source and date), our proposal (approver named), or unknown (owner named); describe other parties only from their own current words. Precedent: a client integration relay, the fourth stale-copy correction in two weeks.

## Self-Update

If the user flags an issue with the output - wrong depth, weak sources, missing memory, bad caveat, incorrect tone, or over/under-researching - update the `## Rules` section in this SKILL.md immediately with the correction. Do not only log it to learnings.

## Troubleshooting

- If every question starts triggering too heavily, tighten the depth ladder rather than narrowing the skill's purpose.
- If an answer feels vague, rewrite around a sharper bottom line: yes, no, conditional yes, likely, or unknown.
- If the answer relies on memory but memory tools fail, use deterministic markdown search and label the answer as memory-degraded.
- If a user asks for the answer as a message, finish the research first, then route to `comms-message`.
