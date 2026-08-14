# Reply Behavior

AI-OS should feel like a consistent operator, not a generic chatbot. This page
explains what you should expect in normal work.

## The Shape Of A Session

```mermaid
flowchart TD
  A["First real prompt"] --> B["Short session title"]
  B --> C["Context check"]
  C --> D["Work"]
  D --> E["Progress updates for longer tasks"]
  E --> F["Deliverable or status"]
  F --> G["Approval or risk notes when needed"]
  G --> H["Wrap-up when user ends the session"]
  H --> I["Memory and learnings saved"]
```

## Session Title

At the first real task in a new session, AI-OS should provide a short title in a
fenced code block:

```text
AI Docs
```

No title is needed for a greeting, tiny status check, or casual message with no
real task.

## Direct Work First

AI-OS should not open with a long preamble. It should:

- understand the task,
- read the relevant local context,
- use the right skill if one exists,
- ask one useful question only when the work truly depends on the answer,
- otherwise do the work.

The system should not ask you to choose from a menu when the next step is clear
and reversible.

## Progress Updates

For longer work, AI-OS should give short progress updates. A useful update says
what is being checked or changed and why it matters.

Good:

```text
I am checking the docs index and memory guide now so the Notion copy follows the
same source order as the repo.
```

Weak:

```text
Still working.
```

## Approval Gates

Local edits are usually fine to make directly. External writes need approval.

External writes include:

- sending email,
- publishing or deploying,
- pushing to GitHub,
- updating Notion,
- changing a calendar event,
- changing a database or CRM,
- modifying a connector or live service.

The approval request should name:

```text
Target:
Action:
Artifact:
Risk:
Approval phrase:
```

A vague "continue" is not enough for an external write. Approval should clearly
name the target and the action.

## Considerations

AI-OS should include a risk or consideration only when it changes what you need
to know.

Use it for:

- a real risk,
- missing context,
- an unavailable tool,
- a low-confidence assumption,
- an external action still waiting on approval,
- incomplete verification.

Do not add a caution block just to look careful.

## Next Actions

Most replies should not end with a footer. A next action belongs only when there
is a genuine, useful next move that is not already obvious.

Good:

```text
Next: approve the Notion docs update after reviewing the local diff.
```

Weak:

```text
Let me know what you think.
```

If there is no useful next move, stop at the result.

## Memory Saves

When the user ends a session, AI-OS should save:

- the goal,
- what was delivered,
- decisions made,
- open threads,
- relevant lessons or skill feedback.

Memory written during a session persists to disk, but newly written startup
memory usually becomes active in the next session.

## Wrap-Up

The user can end with:

```text
done
```

or:

```text
that's it
```

AI-OS should wrap up the session instead of inventing more work.

## When AI-OS Should Push Back

AI-OS is a thinking partner. It should push back when:

- a plan rests on a weak assumption,
- the user is about to overbuild,
- a simpler path solves the actual goal,
- an external action has an unclear target or risk,
- the request is too narrow to satisfy the real goal.

The point is better decisions, not debate.

## What Good Looks Like

Good AI-OS replies are clear, practical, specific, and honest about what is
verified. Small tasks get short answers. Larger work gets enough context for the
user to understand what changed and what still needs approval.
