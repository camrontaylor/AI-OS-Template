---
name: comms-message
description: "Draft, review, or sharpen an actual written message to a client or contact. Not for marketing copy, public content, or strategy docs unless the output is a direct message to a named contact."
when_to_use: 'Invoke when the request sounds like: "thoughts on this message", "how should I reply", "write this to the client", "follow up with", "send Nick", "email/DM/comment to"'
---

# Client Message

Use this for real written communication that may be sent to a client, partner,
lead, supplier, or stakeholder. The job is to protect the relationship, make the
ask clear, and keep the user's voice intact.

## Outcome

- For quick message checks: a direct recommendation plus a ready-to-send draft
- For delicate or high-stakes messages: a brief read on risk, then 1-3 draft options
- For larger message packs, email threads, or reusable templates: save output to `projects/comms-message/{YYYY-MM-DD}_{descriptive-name}.md`

## Context Needs

| File | Load level | Purpose |
|------|------------|---------|
| Root `context/USER.md` | full if available | Match the user's plain, direct style |
| Current workspace `context/MEMORY.md` | scan | Catch the active client, project, and current sensitivities |
| Current workspace `context/learnings.md` | `## comms-message` plus relevant general entries | Apply local message feedback |
| Root `context/learnings.md` | `## comms-message` plus relevant general entries | Apply cross-client message lessons |
| `context/memory/` daily logs | search when needed | Pull useful backlog history into sensitive messages |
| `context/notion/` synced notes | search when available | Find old client messages, call notes, and draft history |
| `brand_context/voice-profile.md` | tone only, if the message is from a brand | Keep brand voice consistent |
| Client overview files | scan when in a client folder | Avoid wrong facts about the client or project |
| Relevant project/thread notes | as needed | Ground the reply in the real work |

## Skill Relationships

- Upstream: `memory-recall` can help when the message depends on past decisions, old client context, or "what did we say last time?"
- Adjacent: `mkt-copywriting` is for public/sales copy. Use `comms-message` for one-to-one client communication.
- Adjacent: `ops-agent-email` can send or read email, but `comms-message` decides what the message should say.
- Downstream: `meta-wrap-up` logs durable communication preferences and commits skill changes.
- Trigger conflict: if the user says "email copy" for a campaign, use `mkt-copywriting`; if they say "email Nick/client/customer back", use `comms-message`.

## Step 1: Load Context

Read the `## comms-message` section in the current workspace
`context/learnings.md` before writing. If you are in a client folder, that
client's memory, learnings, and project notes are the source of truth for client
facts. Use root AI-OS context for the user's general voice and working style,
not to override the client folder.

For quick wording checks, do not over-research. Use the message, the current
folder, and obvious context. For messages involving scope, money, delays,
conflict, commitments, legal risk, or a client-specific fact, read the relevant
client memory or project notes first.

If the context is missing, say the assumption in one short line and still give a
usable draft.

## Step 2: Check Backlog History

Backlog history means the user's past memory, learnings, daily logs, and project
notes. Use it when old context could change the tone, facts, promise, or risk of
the message.

For quick low-risk wording checks, keep this light:

- Read the current workspace `## comms-message` learnings.
- If in a client folder, scan that client's `context/MEMORY.md`.
- Do not run a broad search unless something in the message is fact-sensitive.

For sensitive messages, search deeper before writing:

- scope, price, budget, proposal, or payment
- delays, mistakes, conflict, or repair
- promises, dates, deadlines, approvals, or ownership
- a named client/contact where relationship history matters
- any message that mentions past work, current status, or "as discussed"

Use `memory-recall` or the local memory search wrappers to find prior context.
Look for past wording preferences, client-specific context, prior promises,
banned phrases, tone corrections, synced Notion notes, and examples of messages
that worked.

Keep this history mostly invisible. Use it to make a better message; do not dump
the research back to the user unless it explains a specific wording choice.

## Step 3: Classify The Message

Decide what kind of communication this is:

- Follow-up: needs a clear next step without sounding needy
- Reply: should answer the point and keep the thread moving
- Ask: should make the request easy to say yes or no to
- Boundary: should be firm without sounding cold
- Scope/budget: should protect the work while keeping trust
- Delay/problem: should name the issue, own the next step, and reduce uncertainty
- Relationship note: should sound human and low-friction

Name the type only when it helps the user understand the edit. Do not turn every
small message into analysis.

## Step 4: Review The Draft

When reviewing user-written wording, check:

- Is the ask clear?
- Does it sound like the user?
- Could any phrase imply blame, pressure, guilt, or uncertainty?
- Is there a simpler way to say it?
- Is the next step obvious?
- Does the message accidentally negotiate against the user?

Lead with the useful take, not a score. If one phrase is the issue, name it and
replace it.

## Step 5: Write The Message

Default style:

- Plain
- Warm but not gushy
- Direct
- Low-pressure
- Short enough to send as-is
- No corporate filler
- No em dashes or en dashes
- No fake urgency
- No over-explaining the user's intent

For delicate messages, give:

1. The safest version
2. A warmer version if useful
3. A firmer version if useful

Do not ask multiple setup questions unless the message cannot be written safely.
Ask one clarifying question only when a wrong assumption could damage the
relationship, budget, or scope.

## Step 6: Save Output

For a single quick message, do not save to disk by default. The output is the
chat draft.

For substantial outputs, message packs, reusable templates, or any client-facing
doc the user may need later:

1. Create `projects/comms-message/` if needed
2. Save to `projects/comms-message/{YYYY-MM-DD}_{descriptive-name}.md`
3. Always save substantial output to disk. This is not optional.
4. After saving, show the user the full absolute file path so they can click it directly.

## Step 7: Ask For Feedback

After a major message pack or a message where the user clearly edits the tone,
ask what should be remembered for next time.

Log durable feedback to `context/learnings.md` under `## comms-message` with the
date and context. If the user flags a direct skill issue, update this skill's
`## Rules` section immediately.

## Eval

Run this manual eval before changing message classification, tone rules, or save
behavior:

1. Quick client-message check: pass if the skill gives a short read and a
   ready-to-send draft in chat without forcing a file save.
2. Delicate scope or budget message: pass if the skill names the relationship
   risk, protects the user's position, and offers a safe draft without blame or
   fake urgency.
3. Client-folder sensitive message: pass if the skill checks the current
   client's memory/learnings before using root context and avoids adding
   unsanctioned facts.
4. Larger message pack: pass if the skill saves to
   `projects/comms-message/{YYYY-MM-DD}_{descriptive-name}.md` and returns the
   full path.

The eval fails if the draft sounds like marketing copy, adds unsanctioned facts,
uses a client folder without checking context for risky claims, or logs quick
one-off messages as files unnecessarily.

## Rules

- 2026-06-29: Use this skill for actual written communication to clients across all folders, not only the current client folder.
- 2026-06-29: For quick client-message wording checks, return a ready-to-send version in chat and do not force a file save.
- 2026-06-29: Avoid heavy phrases like "misaligned expectations" unless the relationship context calls for formal language.
- 2026-06-29: In client folders, local client context wins for facts, status, names, promises, and relationship history. Root context only supplies the user's general voice and working style.
- 2026-06-29: Use backlog history for client messages when past context could affect tone, facts, scope, budget, promises, approvals, or relationship risk. Keep quick low-risk checks light.
- 2026-06-29: For messages the user sends as himself, preserve his phrasing, length, and casual voice unless he asks for a stronger rewrite. Do not add unsanctioned facts or identify a client/contact before the user has done so.
- 2026-06-29: When synced Notion notes contain prior messages to the same client, use them as history for facts and cadence, not as a style template to copy blindly.
- 2026-06-29: When turning internal strategy, research, or handoff notes into a client message, do not include the internal reasoning stack. Only include what the client needs now: the concrete output, one caveat if needed, and one clear next ask.
- 2026-06-30: When the user is evaluating multiple client-message drafts, save each iteration as its own markdown file or clearly separated version. Do not overwrite prior message options unless the user explicitly asks to replace one.
- 2026-06-30: When iterating on a message and the user prefers an earlier version, use that earlier version as the base. Accumulate context unless the user explicitly asks to remove it. Do not "improve" by compressing away the reason, caveat, ask, timing, or relationship context that made the prior version work.
- 2026-07-01: In client-facing consultant strategy docs, do not shift design responsibility to the client with open-ended "what do you want to do?" framing. Present the recommended model and proposed path first, then ask only for confirmation, exceptions, priorities, access, or approvals.
- 2026-07-01: Before drafting client-facing vendor or proof-question pages, verify current vendor docs/pricing and relevant local project research first. Separate documented capabilities from client-specific proof gates so the artifact does not turn known answers into damaging uncertainty.
- 2026-07-01: For long-running client threads, do not make the newest message sound like a standalone task if there is a known journey underneath it. Carry the relevant history in the framing, then keep the client copy concise.
- 2026-07-01: Avoid client-facing "prove this can work" language for setup-dependent systems. It sounds unnatural and can overpromise before real data, access, paid plan, or implementation approval exists. Use "check what is missing", "confirm what setup is needed", or "account for this before setup questions move forward" instead.
- 2026-07-01: In output artifacts, avoid narrator/meta lines that describe the artifact itself, such as "This page turns...", "This document outlines...", or "This question set supports...". Saved docs, Notion pages, briefs, reports, decks, dashboards, and reusable drafts should read as the real artifact, not as an assistant explaining the artifact. Native chat replies may include brief context when useful.
- 2026-07-01: For client-facing Ops Map or evidence-source wording, use normal consulting language such as "reviewed the HubSpot evidence already available to me." Do not foreground AI, scraping, staff emails, reverse-engineering, or tool mechanics unless the client asks directly. If asked, answer plainly and keep the focus on approved project data, working analysis, and validation.
- 2026-07-17: When the user asks for a fixed-count vendor question list and explicitly forbids assumptions or strategic reframing, deliver exactly that count in concise question form. Do not replace the requested list with a smaller recommended set, a different phase boundary, or a new communication strategy.
- 2026-07-20: Closing asks are one plain sentence of concrete asks. Never stack consultant taxonomy (first-phase approach, include/defer, read-only, writeback later, go-ahead to first live sync), even when an earlier draft contained it. If a clause does not ask for something real in plain words, cut it. Camron flagged this as information dense but useless.
- 2026-07-20: When Camron rewrites any line of a draft, his version sets the register for the whole draft, not just that line. Rewrite every remaining sentence to match it: spoken plain English, each question phrased the way he would say it on a call.
- 2026-07-20: Never use self-diminishing or absence-implying framing in client copy: no "disappearing", no "the bit I have not walked you through", no admitting neglect or gaps in attention. The consultant is present and in control; state what is happening and what is next. Weigh every phrase for the image it projects, not just for plainness. Camron flagged "rather than disappearing until it is polished" as careless and pattern-reliant.

## Self-Update

If the user flags an issue with the output - wrong tone, too formal, too soft,
too pushy, missing context, bad format, or a phrase they dislike - update the
`## Rules` section in this SKILL.md immediately with the correction. Do not just
log it to learnings; fix the skill so it does not repeat the mistake.

## Troubleshooting

- If the user only asks "thoughts?" on a client message, give the main risk and a cleaner draft.
- If the user wants a message in a channel's style, match the channel: Slack can be shorter, email can carry a little more context, Notion comments should be clean and scannable.
- If the message involves a promise, deadline, price, or scope change, make the commitment explicit and avoid vague language.
- If the message is emotionally loaded, remove blame first, then make the next step clear.
