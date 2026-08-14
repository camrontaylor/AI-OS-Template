# Research to Script: Turning Trending Topics into Video Angles

How to use `str-trending-research` output (or any research brief) to pick script topics that match the user's business and audience interests. This is the methodology for Step 2 (Path B) of the skill.

---

## The Research-to-Script Pipeline

```
Research Brief → Filter for Relevance → Extract Angles → Match to Script Format → Write
```

### 1. What to Research

When the user wants topic ideas, you need to know two things:
- **Their niche/industry** (from context, ICP, or ask them)
- **What their audience cares about** (from ICP's language section, or ask)

Build research queries that overlap business expertise with audience interest:

| Business area | Audience interest | Research query |
|---------------|-------------------|----------------|
| SaaS tools | Productivity | "best productivity tools 2026" |
| Fitness coaching | Weight loss | "what's actually working for weight loss" |
| Agency owner | Marketing automation | "marketing automation trends small business" |
| E-commerce | Sustainable fashion | "sustainable fashion brands people recommend" |

**Research types that generate the best script angles:**

- **"Best X" / recommendations** → Review scripts, "I tried X", listicles
- **Debates / controversies** → Hot takes, myth busts
- **How-to questions** → Quick teaches, tutorials
- **Pain points / complaints** → PAS scripts, story arcs
- **Trend shifts** → Timeliness hooks, "here's what's changing"

### 2. Reading a Research Brief

When `str-trending-research` produces a brief (saved in `projects/str-trending-research/`), scan it for:

**High-signal content (script-worthy):**
- Topics with 50+ upvotes on Reddit threads → people care about this
- X posts with high engagement → this is in the conversation right now
- Multiple sources saying the same thing → confirmed trend, not noise
- Debates where both sides are active → hot take material
- Specific recommendations people keep naming → review/comparison scripts

**Low-signal content (skip):**
- One-off mentions with no engagement
- Niche technical discussions outside the audience's level
- Topics the user has no authority or experience to speak on
- Things that peaked weeks ago and are already declining

### 3. Extract Script Angles

For each high-signal topic, ask: "What would a 30-second video about this look like?"

**Angle extraction framework:**

| Research finding | Script angle | Format match |
|-----------------|-------------|--------------|
| "Everyone recommends X but people in comments say it's overrated" | Myth bust: "Why X isn't as good as people say" | Myth Bust |
| "3 tools keep getting mentioned for [task]" | "I tested the top 3 [tools]. Here's my ranking." | "I Tried X" |
| "People are frustrated about [problem]" | "If [problem] is driving you crazy, here's the fix" | PAS |
| "[Thing] just changed / launched / updated" | "[Thing] just dropped. Here's what it means for you." | Hot Take / Quick Teach |
| "This technique is trending in [community]" | "I tried [technique] for [period]. Results were..." | Story Arc / "I Tried X" |
| "Debate between [approach A] vs [approach B]" | "Everyone's arguing about [A vs B]. Here's the answer." | Hot Take |
| "Surprising stat or data point" | "Did you know [stat]? Here's why that matters for [role]." | Quick Teach |

### 4. Filter for Business Fit

Not every trending topic is worth scripting. Run each angle through these filters:

**Keep it if:**
- The user has genuine experience or expertise on this topic
- It connects to their product/service (even loosely)
- Their target audience is actively discussing it
- It positions them as knowledgeable without being salesy

**Drop it if:**
- It's trending but completely outside their domain
- They'd have to fake authority to talk about it
- It only matters to an audience they don't serve
- It's already been covered heavily by bigger creators in the space

### 5. Present Script Angles

Show the user 3-5 filtered angles, each with:

```
ANGLE: [One-line description]
WHY NOW: [What's making this relevant right now]
FORMAT: [Recommended script framework]
HOOK IDEA: [One draft hook]
SIGNAL: [Where you found this — Reddit thread, X posts, etc.]
```

Let them pick. They know their audience better than research does.

---

## When Research Isn't Available

If `str-trending-research` isn't installed, or the user skips research:

1. Ask about their content pillars: "What are the 3-4 topics you always come back to?"
2. Ask what questions their customers ask most often
3. Ask what misconceptions exist in their industry
4. Use these to suggest angles from your own knowledge

The research makes angles timely and backed by real engagement data. Without it, you're relying on evergreen topics and the user's domain knowledge — which still works, it's just less data-driven.

---

## Batch Topic Planning

When writing 3-5 scripts in a batch, vary the angles:

- **1 trending/timely** — riding what's in the conversation right now
- **1 evergreen teach** — valuable anytime, builds authority
- **1 opinion/hot take** — generates engagement and comments
- **1 story/personal** — builds connection and trust
- **1 problem-solver** — directly helps the audience

This mix keeps the content calendar interesting and serves different algorithm signals (shares, saves, comments, watch time).
