# Prompt Tags

Reusable prompt snippets that can be inlined into any task prompt by typing `@<tag-name>` in the goal bar or reply input. Sections are delimited by H2 headings (`## tag-name`). An optional frontmatter line right after the heading can mark a tag as a starter chip with `starter: true`.

## brand-voice
starter: true

Use the brand voice defined in `brand_context/voice-profile.md`. Match the tone, vocabulary, sentence rhythm, and stylistic moves the user has captured there. If voice-profile.md is missing, ask the user once how they want this to sound.

## brief
starter: true

Read the active project brief at `projects/briefs/{project-slug}/brief.md` for the current task's project before doing anything else. Treat the brief as the source of truth for goal, deliverables, and acceptance criteria. Only deviate from it after asking the user.

## style-guide

Follow the style guide in `brand_context/style-guide.md` if present (formatting, capitalisation, brand-specific spellings, banned phrases). For headings, lists, and code samples follow the conventions already used in nearby files in the same folder.

## recent-decisions

Skim today's and yesterday's `context/memory/{date}.md` files for any "Decisions" entries that touch this work. Carry those decisions forward — do not relitigate them unless the user explicitly asks.
