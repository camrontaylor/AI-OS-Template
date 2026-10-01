> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only the authoritative snapshot; local context/config/knowledge examples apply only to Solo mode. Generated files use the dated project directory and dated filenames. User task authorization controls external writes.

# Cross-skill propagation

## Discovery

Extract a single concrete correction. Search the selected root or client's `.claude/skills/` with `rg`,
then read matches to separate direct applicability, adjacent context, and incidental keyword hits.
Scan output types too: a spoken-voice rule fits speaker notes; it may not fit a written research report.
Do not search sibling repositories unless explicitly requested.

## Proposal

Record skill, path, matching behavior, confidence, proposed change, and exception.
Apply directly authorized corrections without redundant approval; ask only when scope or behavior is ambiguous.
Preserve differences justified by medium, destination, or user preference.

## Local rules and memory

Runtime feedback belongs in adjacent `SKILL.local.md` Rules or section overrides and in the skill's own
`context/learnings.md` section. Cross-cutting principles belong under General in that same scoped learnings file.
Do not create an external global memory layer or overwrite shipped base definitions during ordinary use.
An explicit authoring request may change base skills through `meta-skill-creator`.

## Validation

Check native names, resource links, dependencies, context matrices, and consistent scope after changes.
Report which candidates changed, were skipped, or remain ambiguous and why. No automatic commit or remote push.
