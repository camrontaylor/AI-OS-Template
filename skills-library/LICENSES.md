# Skills Library - License & Provenance Roll-up

Single source of truth for what each vendored backlog subtree is licensed under and whether it is safe to redistribute. Pairs with `sources.json` (which holds the upstream URLs and pinned SHAs). Added 2026-06-22.

| Subtree | Source | License | Redistribution | License file |
|---------|--------|---------|----------------|--------------|
| `backlog/cybersecurity-skills/` | briiirussell/cybersecurity-skills | **MIT** | Publish-safe (attribution preserved) | `backlog/cybersecurity-skills/LICENSE` |
| `backlog/marketing/` | coreyhaines31/marketingskills | **MIT** | Publish-safe (attribution preserved) | `backlog/marketing/LICENSE` |
| `backlog/maker/` | coreyhaines31/makerskills | **MIT** | Publish-safe (attribution preserved) | `backlog/maker/LICENSE` |
| `backlog/thinking-partner/` | mattnowdev/thinking-partner | **MIT** | Publish-safe (attribution preserved) | `backlog/thinking-partner/LICENSE` |
| `backlog/mattpocock-skills/` | mattpocock/skills | **MIT** | Publish-safe (attribution preserved) | `backlog/mattpocock-skills/LICENSE` |
| `backlog/cf-frameworks/` | conversionfactory/agent-config | **All-rights-reserved** (see note) | **Private only - do NOT republish** | none (proprietary) |
| `backlog/planner/` | conversionfactory/planner-skill | **All-rights-reserved** | **Private only - do NOT republish** | none |
| `backlog/copy-qa/` | conversionfactory/QA-skill | **All-rights-reserved** | **Private only - do NOT republish** | none |
| `backlog/claude-video/` | bradautomates/claude-video | **MIT** | Publish-safe (attribution preserved) | `backlog/claude-video/LICENSE` |
| `backlog/karpathy-coding-discipline/` | multica-ai/andrej-karpathy-skills | Not copied (link + re-expression only) | Nothing to redistribute; check upstream before quoting original wording | none (see its README) |
| `backlog/community-claude-md-rules/` | community "ten rules CLAUDE.md" (X, June 2026) | **Unverified** | **Private only - do NOT republish**; Karpathy attribution unverified secondhand | none (see its README) |
| `backlog/make-interfaces-feel-better/` | jakubkrehel/make-interfaces-feel-better | **MIT** | Publish-safe (attribution preserved) | `backlog/make-interfaces-feel-better/LICENSE` |
| `backlog/no-ai-slop/` | petergyang/no-ai-slop | **MIT** | Publish-safe (attribution preserved) | `backlog/no-ai-slop/LICENSE` |
| `resources/ai-job-search/` | MadsLorentzen/ai-job-search | **MIT** | Nothing to redistribute - metadata-only record, no source vendored | none (see note below) |
| `resources/codebase-memory-mcp/` | DeusData/codebase-memory-mcp | **MIT** | Nothing to redistribute - metadata-only record, no source vendored | none (see note below) |
| `resources/agent-reach/` | Panniantong/Agent-Reach | **MIT** | Nothing to redistribute - metadata-only record, no source vendored | none (see note below) |

## Notes

- **MIT (cybersecurity, marketing):** the upstream `LICENSE` text + copyright line is now committed alongside each pack, satisfying MIT's attribution condition. Closes the audit blocker from `projects/_threads/skills-library-merge.md`.
- **Conversion Factory (cf-frameworks, planner, copy-qa):** proprietary, vendored for private study only. Client/agency PII was scrubbed to placeholders during the merge. These must never reach a public branch or template export. If this repo is ever made public, exclude these subtrees first.
- **Exception inside cf-frameworks:** `brand-guidelines/`, `canvas-design/`, and `theme-factory/` carry their own **Apache-2.0** `LICENSE.txt` - they are Anthropic open-source skills that Conversion Factory re-bundled, so they are redistributable (with the Apache NOTICE/modification terms, and a trademark caveat on the Anthropic brand assets).
- **`resources/` lane (added 2026-07-28):** the redistribution question does not apply the same way it does to `backlog/` - a resource's `RESOURCE.md` is AI-OS's own written assessment, never a copy of the source's code or text, so there is nothing of the upstream project to redistribute regardless of its license. The license is still recorded for provenance and to inform whether the source itself is safe to reclone and run later.

## Keeping current

When a new pack is vendored into `backlog/`, add a row here and commit its upstream `LICENSE` if the license requires it (MIT, Apache, BSD do; all-rights-reserved gets a "private only" note instead). When a new resource is evaluated into `resources/`, add a row here too - `RESOURCE.md` is safe to publish regardless of the upstream license (see the `resources/` lane note above), but still record the license for provenance.
