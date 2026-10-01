# Replacement Guide

How to replace AI patterns with human writing. Two modes: generic (no brand context) and voice-matched (with brand_context/voice-profile.md loaded).

---

## Core Principle

Don't just swap words — restructure the sentence. AI patterns are rarely just vocabulary problems. The sentence architecture is wrong.

**Bad replacement:**
- AI: "It's crucial to understand that leveraging data is transformative."
- Word-swap: "It's important to know that using data is powerful."
- Still robotic. Same structure, different words.

**Good replacement:**
- Human: "Data changes how you make decisions. Here's how."
- Restructured. Direct. Specific promise.

---

## Generic Replacements (No Voice Profile)

### Transitions

| Instead of | Use |
|-----------|-----|
| "Moreover," / "Furthermore," | Start a new sentence. Or "And" / "Also" if you must connect. |
| "Additionally," | "Plus," / "On top of that," / Just start the new point |
| "Nevertheless," / "Nonetheless," | "But" / "Still," / "Even so," |
| "Consequently," | "So" / "That means" |
| "In light of this," | "Because of that," / "Given that," |
| "It is worth noting that" | Cut entirely. Just state the thing. |

### Openers

| Instead of | Use |
|-----------|-----|
| "In today's [adjective] world/landscape" | Cut. Start with the actual point. |
| "Let's dive into / explore" | Cut. Just start explaining. |
| "In conclusion" / "To summarize" | Cut. Your final point should be obvious. |
| "Here are the top X ways to" | Cut the preamble. Start the list. |

### Hedges

| Instead of | Use |
|-----------|-----|
| "It's important to note that X" | "X" — just say it |
| "It's worth mentioning that X" | "X" |
| "One might argue that X" | "X" or "Some think X" |
| "It could potentially" | "It could" or "It might" (one hedge, not two) |
| "Arguably" | Cut, or commit to the claim |

### Buzzwords

| Instead of | Use |
|-----------|-----|
| "utilize" | "use" |
| "facilitate" | "help" |
| "leverage" | "use" |
| "optimize" | "improve" / "fix" |
| "streamline" | "simplify" / "speed up" |
| "empower" | "help" / "let" / "give [person] the ability to" |
| "innovative" | Describe what's actually new instead |
| "comprehensive" | "complete" / "full" / describe what it covers |
| "robust" | "solid" / "reliable" / describe what makes it strong |

### Structure Fixes

| Problem | Fix |
|---------|-----|
| Rhetorical Q+A | Remove the question. Start with the answer. |
| 3+ parallel sentences | Vary the openings. Break one into two shorter sentences. |
| Always-three lists | Make it 2, 4, or 5. Or just prose. |
| Announcement of emphasis ("Importantly,") | Cut the word. If the point is important, it shows. |
| Mirror paragraphs | Restructure: some paragraphs short (1-2 sentences), some longer. Lead differently. |
| Binary contrasts ("It's not X, it's Y") | State Y directly. Drop the setup. |
| Faux-insight setups ("Here's what nobody tells you") | Cut the setup, keep the claim, let it stand on its own. |
| Colon reveals (noun phrase — colon — lowercase reveal) | Rewrite as one plain sentence. Reserve colons for lists, labels, and quotes. |
| Fake-profound kickers (mic-drop metaphor ending) | Delete it. Don't rewrite into a better metaphor — end on the clearest concrete sentence already in the draft. |
| Synonym cycling (rotating terms for style) | Repeat the clear word instead of rotating synonyms across sentences. |
| Negative listing ("Not a X. Not a Y. A Z.") | Just say Z. |
| Dramatic fragmentation ("X. And Y. And Z.") | Combine into complete sentences. |
| Weak verb phrases ("has the ability to", "made a decision") | Use the direct verb: "can", "decided". |
| Formatting slop (emoji headings, mid-sentence bold, bullets over prose) | Strip decoration. Use bullets only when the content is genuinely a list; otherwise write prose. |
| Summary-recap endings ("In conclusion," "Overall,") | Cut. End on the last concrete point, takeaway, or next action instead. |

---

## Voice-Matched Replacements (With Voice Profile)

When `brand_context/voice-profile.md` is loaded, replacements should use the brand's actual patterns instead of generic human phrasing.

### How to Map Voice Profile to Replacements

**1. Connectors:** Replace AI transitions with the brand's preferred connectors.
- Read the "Linguistic Habits" or "Transitions" section of the voice profile
- Use those exact phrases as transition replacements
- Example: If voice profile says "So," "And," "But," as openers → replace "Moreover," with "And" or "So"

**2. Vocabulary:** Replace AI buzzwords with the brand's preferred terms.
- Read the "Vocabulary" → "Preferred" list
- Read the "Vocabulary" → "Avoid" list (treat these as additional AI tells)
- Example: If brand avoids "leverage" and prefers "plug in" → "leverage AI tools" becomes "plug in AI tools"

**3. Rhythm:** Match the brand's sentence patterns.
- Read "Rhythm & Structure" section
- If brand prefers short punchy + medium mix → break AI's long sentences
- If brand uses fragments → add fragments for pacing

**4. Energy:** Match the brand's intensity.
- Read "Personality Traits" and "Tone Spectrum"
- If brand is playful/energetic → replacements should be more casual
- If brand is formal/precise → replacements stay professional but still human

**5. Signature patterns:** Apply the brand's distinctive moves.
- Read "Signature Phrases" section
- Use these as inspiration for closers, transitions, emphasis
- Don't force them into every paragraph — use sparingly and naturally

---

## What NOT to Change

- **Technical terms** — "API", "machine learning", "database" are fine. Don't dumb down real terminology.
- **Intentional formality** — If the piece is a white paper or legal doc, keep appropriate register.
- **Quotes and attributed text** — Never modify someone else's words.
- **Data and statistics** — Never change numbers, sources, or claims.
- **Meaning** — Never change what the text says. Only change how it says it.
- **Format-specific conventions** — Email subject lines, ad copy character limits, etc. have their own rules.

---

## Quality Checks After Replacement

1. **Read it out loud.** Does it sound like a person talking? If you stumble, rewrite that sentence.
2. **Check sentence variety.** Not all the same length. Mix short (5-10 words) with medium (15-25 words).
3. **Check paragraph variety.** Not all the same structure. Some 1 sentence, some 3.
4. **Check specificity.** Flag any remaining vague references ("many companies", "various industries") for the user to make concrete.
5. **Check contractions.** Unless formal, "it's" beats "it is", "don't" beats "do not".
6. **Check active voice.** "We tested" beats "Testing was conducted".
