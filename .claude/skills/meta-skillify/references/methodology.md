## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/meta-skillify/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/meta-skillify/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# Native workflow method

<a id="detect-mode-and-source"></a>
## Detect mode and source

Create from chat, supplied notes, process video, or scratch; adapt from an external/local skill; update an existing skill from concrete feedback. Ask only when source or target is ambiguous. Read docs/building-skills.md, meta-skill-creator and its local override before writing.

<a id="extract-and-classify-methodology"></a>
## Extract and classify methodology

Read the whole relevant workflow/resources. Keep sound mechanics, adapt names/paths/tools/context, and add AI-OS context/dependencies/outputs. Identify trigger overlaps and installed upstream/downstream skills. For video, use tool-watch-video visual mode when actual screen details matter.

<a id="check-licenses-and-choose-scope"></a>
## Check licenses and choose scope

For external adaptations inspect source license and retain mandatory notices in a dedicated legal notice location. A rebrand does not remove legal duties. Use root .claude/skills for shared capabilities or clients/{slug}/.claude/skills for a client-only skill; do not shadow an existing root name. Keep unrelated repositories out of scope.

<a id="author-register-and-validate-natively"></a>
## Author, register, and validate natively

Follow meta-skill-creator and docs/building-skills.md: category-name folder/frontmatter, canonical sections, under-200-line entrypoint, focused resources, dependencies/fallbacks, learnings, humanizer when relevant, and dated project output. Root skills update registry, context matrix, learnings and README; client skills remain client-local. Validate paths, schema, resource links, and appropriate scenarios. Do not automatically commit, push, publish, or install marketplaces.

<a id="propagate-corrections-deliberately"></a>
## Propagate corrections deliberately

Use references/update-change-types.md and update-propagation.md to find affected skills by keywords and semantic relevance. Distinguish direct and adjacent matches; preserve exceptions. User corrections go immediately into SKILL.local.md and skill learnings; cross-cutting principles go under General. Base-definition changes follow the authorized authoring task. Record change impact and version reasoning.
