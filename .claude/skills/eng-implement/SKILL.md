---
name: eng-implement
description: "Real code work that deserves more than a quick edit: spec-first, test-driven build, structured debugging, domain modeling, setup wizards. Not for reviewing a diff (code-review), verifying a finished change (verify), or one-line fixes."
when_to_use: 'Invoke when the request sounds like: "implement this spec", "write a spec for this", "TDD this", "red-green-refactor", "diagnose this bug", "something is broken or slow", "record an ADR", "build a setup wizard"'
---

# Engineering Implement (discipline bundle)

One live skill bundling the engineering-discipline workflows promoted from
`mattpocock/skills` (MIT). It is a router: pick the mode the task needs, load only that
reference, and run it. This rides on top of AGENTS.md Coding Discipline (think before you
code, simplicity first, surgical changes, goal-driven execution); nothing here overrides it.

## Context Needs

| File | Load level | Why |
|---|---|---|
| The target repo's `CONTEXT.md` and `docs/adr/` | if present | Domain vocabulary and prior decisions |
| `references/{mode}.md` | the one matching mode only | The workflow being run |
| `context/learnings.md` | `## eng-implement` | Prior lessons from this bundle |

## Modes

| Mode | When | Reference |
|------|------|-----------|
| **spec** | Turn the current conversation into a written spec or PRD before building | [references/to-spec.md](references/to-spec.md) |
| **tdd** | Build a feature or fix test-first at pre-agreed seams | [references/tdd.md](references/tdd.md) (+ tdd-tests.md, tdd-mocking.md) |
| **debug** | A hard bug or performance regression that resists a quick look | [references/diagnosing-bugs.md](references/diagnosing-bugs.md) |
| **model** | Pin down domain terms, sharpen the glossary, record an ADR | [references/domain-modeling.md](references/domain-modeling.md) (+ adr-format.md, context-format.md) |
| **wizard** | Generate an interactive bash wizard that walks a human through a manual procedure | [references/wizard.md](references/wizard.md) + `scripts/wizard-template.sh` |

If the user names a mode, go straight there. Otherwise infer it from the ask and say which
mode you are running in one line.

## Implement (the default flow when handed a spec or tickets)

1. Read the spec or tickets fully. Read the repo's `CONTEXT.md` and relevant ADRs if they
   exist, and use their vocabulary.
2. Build test-first where possible, at pre-agreed seams (**tdd** mode is the reference for
   what a seam is and what a test worth keeping looks like).
3. Run typechecking regularly, single test files regularly, and the full suite once at the end.
4. When done, review the work with the `code-review` skill, then commit to the current
   branch. Follow the AGENTS.md Branching Policy for where the commit belongs; never push
   without the normal external-action approval.

## Rules

- One mode per pass. Do not load every reference; load the one the task needs.
- Verification before completion: do not claim it works until the check has run green
  (Coding Discipline rule 4).
- Scripts in `scripts/` are templates to copy into the target repo, never edited in place
  here: `wizard-template.sh` (wizard library) and `hitl-loop.template.sh` (human-in-the-loop
  debug loop).
- Related backlog material not bundled here (code-review, grilling, to-tickets, prototype,
  wayfinder, and the rest of the pack) stays in `skills-library/backlog/mattpocock-skills/`;
  route additions through meta-skill-intake instead of growing this skill ad hoc.

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|------------------|------------|
| `code-review` (built-in) | Optional | Post-implement diff review | Self-review the diff against the spec before committing |
| `verify` (built-in) | Optional | End-to-end behavior check | Drive the affected flow manually and show the output |
