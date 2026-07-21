# Backlog (the one skills-library staging folder)

Where new skill candidates land and stay, inert, until you promote or park them. Each pack here is a collection of source skills not yet evaluated or promoted to live use. The folder structure is `backlog/<pack-name>/<skill-name>/SKILL.md`.

## Current packs

| Pack | Source | Notes |
|------|--------|-------|
| `cf-frameworks` | Conversion Factory-style agency skills (anonymized) | 42 skills. Real client/agency names scrubbed. Best-of: `sitemap-workshop`, `brand-strategy`, `growth-engine`, `audit-marketing`, `client-handoff`, `marketing-website-design`, `positioning`, `theme-factory`, `wireframes`. |
| `copy-qa` | Copywriting QA scripts | 1 skill. Light. |
| `cybersecurity-skills` | Security audit + prompt injection | 29 skills. OWASP-style. |
| `marketing` | Marketing planning + ad creative | 44 skills. The biggest pack. |
| `planner` | Goal/task planning skill | 1 skill. Includes a profile-template. |
| `mattpocock-skills` | Matt Pocock (AI Hero) engineering-discipline pack | 37 skills. Real-engineering workflow: grill-me/grill-with-docs, TDD, code-review, diagnosing-bugs, domain-modeling, codebase-design, to-spec/to-tickets/triage/wayfinder. |

## Candidate sources (not yet vendored)

Repos worth turning into a skill later, but not yet pulled in. They are NOT in `INDEX.md` (no `SKILL.md` to route to yet). Full provenance lives in `../sources.json` under `candidates`.

| Repo | License | What it is | Skill idea to extract |
|------|---------|------------|-----------------------|
| [farzaa/clicky](https://github.com/farzaa/clicky) | MIT | macOS app: an on-screen AI buddy that sees your screen, talks, and points at UI. Not a `SKILL.md`. | A screen-aware teaching / guided-walkthrough buddy. Mine the approach, not the code. |
| [TheCraigHewitt/seomachine](https://github.com/TheCraigHewitt/seomachine) | MIT | Claude Code workspace for long-form SEO blog content: 24 commands, 11 agents, 26 skills, plus GA4/GSC/DataForSEO data tooling. | The SEO content pipeline (commands + agents + data integrations). The 26 skills mostly duplicate the marketing pack already here. |

## How a backlog skill graduates

```
backlog/<pack>/<name>/   --assess-->   promote   -->   live (.claude/skills/<category>-<name>/)
(inert candidate)        (in chat)      or park         (rename + register)
```

Promotion is by hand, one skill at a time, because each one needs to be renamed to the AI-OS `{category}-{name}` convention, registered in `AGENTS.md`, and given a learnings section. There is no triage or review folder and no sign-off gate - you ask for an assessment, then say promote or park.

## Browsing tip

Backlog packs hold a LOT of skills. Use `find skills-library/backlog -name SKILL.md` to list them all, or `grep -l "<keyword>" skills-library/backlog/**/SKILL.md` to find ones matching an interest area.
