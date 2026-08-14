# Question Research Frameworks

Use this reference when the question is non-trivial, current, client-facing, technical, strategic, or high-stakes.

## Source Foundation

This framework adapts the source-tier, confidence, contradiction, and customer-facing answer patterns from Anthropic's `knowledge-work-plugins@customer-research`, found via `meta-find-skills` as the strongest verified public starting point for broad question research.

Quality signals checked on 2026-07-02:

- Official Anthropic source: `anthropics/knowledge-work-plugins`
- Skills.sh listing showed `customer-research` with 2K installs and 758 weekly installs
- Repository listing showed 11.1K GitHub stars
- The skill's workflow includes source tiers, confidence scoring, contradictions, escalation, and knowledge capture

This AI-OS skill generalizes that pattern beyond customer support into all operator questions.

## Question Taxonomy

Classify the question by what kind of answer would actually help:

| Type | User is really asking | Good answer shape |
|------|------------------------|-------------------|
| Factual | What is true? | Direct answer, source, confidence. |
| Feasibility | Can this be done? | Yes/no/conditional, native support, workaround path, blockers. |
| Recommendation | What should I do? | Recommendation, reasoning, tradeoffs, counter-case. |
| Comparison | Which is better? | Criteria, option table, decision rule. |
| Diagnostic | Why is this happening? | Likely causes, evidence, next checks. |
| Strategic | What does this mean? | Synthesis, assumptions, implications, next move. |
| Client-safe | What can I tell them? | Verified answer plus wording that avoids overpromise. |
| Research brief | What do we know about this area? | Decomposition, source map, findings, gaps. |

## Depth Ladder

### Quick Answer

Use for stable, low-risk questions.

Return:

- answer
- one caveat only if useful
- no research recap

### Verified Answer

Use for current, technical, client-facing, or fact-sensitive questions.

Do:

- verify from primary/current sources
- cite sources or local files
- separate facts from inference
- state confidence
- identify the one thing to check next if needed

### Deep Research

Use for broad, costly, contested, or high-stakes questions.

Do:

1. Reframe the core question.
2. Split into 3-7 sub-questions.
3. Identify the best source tier for each sub-question.
4. Search/read enough to answer each sub-question.
5. Look for disconfirming evidence.
6. Resolve contradictions.
7. Synthesize the bottom line.

## Source Tiers

| Tier | Source type | Confidence | Notes |
|------|-------------|------------|-------|
| 1 | User-provided docs, local code, current client files | High for the user's situation | Confirm dates and scope. |
| 2 | Official docs, vendor docs, standards, laws, source repos | High for public facts | Prefer for technical and platform claims. |
| 3 | Connected apps, CRM notes, Notion, email, meeting notes | Medium to high | Good for relationship and project history, but may be incomplete. |
| 4 | Reputable secondary sources, expert blogs, analyst reports | Medium | Useful context, not primary proof. |
| 5 | Community reports, forums, Reddit, social posts | Low to medium | Good for lived experience and edge cases. |
| 6 | Inference, analogy, general best practice | Low | Label as inference. |

## Confidence Rubric

Use one of these labels:

- **High:** primary/current sources answer it clearly, or multiple strong sources agree.
- **Medium:** likely answer from one good source or several partial sources.
- **Low:** mostly inference, old sources, conflicting evidence, or missing project details.
- **Unknown:** the answer needs access, data, expert confirmation, or a source not available.

Explain confidence in one sentence. Do not hide behind the label.

## Feasibility Questions

For "can we build/do this?" answer with:

```markdown
Short answer: Yes/No/Yes with conditions.

What is possible:
- ...

Main constraint:
- ...

Best build path:
1. ...
2. ...
3. ...

Before promising:
- Confirm ...

Client-safe wording:
> ...
```

Always separate:

- native platform support
- custom code inside the platform
- external service/workaround
- plan or access requirement
- commercial or operational risk

## Decision Questions

For "should I?" questions:

1. Name what is actually being decided.
2. Surface hidden assumptions.
3. Give the recommendation.
4. Give the strongest counter-case.
5. State what evidence would change the recommendation.

Keep it useful, not theatrical.

## Contradiction Handling

When sources disagree:

- Check dates first.
- Prefer primary sources over summaries.
- Prefer the source closest to the user's exact environment.
- Quote or cite the disagreement briefly.
- Give a conservative answer if a client might rely on it.

## Output Templates

### Compact Verified Answer

```markdown
Short answer: ...

Why:
- ...
- ...

Confidence: ...

What to check before acting:
- ...
```

### Client-Safe Answer

```markdown
Short answer: ...

What I would tell the client:
> ...

What sits behind that:
- ...

Before committing scope:
- ...
```

### Deep Research Brief

```markdown
# [Question]

## Short Answer

## What I Checked

## Findings

## Constraints And Caveats

## Confidence

## What Would Change The Answer

## Sources

## Recommended Next Move
```
