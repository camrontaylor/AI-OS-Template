# Notebook Sketch Style

(Upgraded version of the original "notebook" preset)

## When to Use

Educational content, learning summaries, how-to guides, conference sketchnotes, book chapter summaries, course material visuals, personal knowledge management illustrations, brainstorm captures.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Ideas/concepts converted to visual sketchnotes — bullet points, small icons, flow arrows, highlighted keywords, margin doodles representing concepts | Content becomes visual notes |
| Framing | Open notebook page filling frame, content organized in zones (header, main content, margins for doodles), slight perspective showing notebook depth | The notebook IS the frame |
| Lighting | Soft even overhead light as if in a cafe/desk — subtle shadow from pen lying on page, warm natural light feel | Enough to feel like a real photo of a real notebook |
| Mood | Studious warmth, intellectual curiosity, the satisfaction of organized thinking, "I just learned something cool" energy | Learning is joyful here |
| Medium | Realistic dot-grid or grid notebook paper (slightly off-white with visible texture), colored highlighter marks, fine-tip pen (black), 1-2 accent markers (brand colors or warm tones) | The paper texture is critical for believability |
| Style | Authentic sketchnote journal — Mike Rohde style sketchnotes, designer's process journal, visual note-taking aesthetic | A PERSON made this — not a tool |

## Model Recommendation

**Either works well** — slight GPT edge for text-heavy sketchnotes, Gemini edge for doodle-heavy ones.

- **GPT:** Better when the sketchnote has lots of readable text labels and bullet points
- **Gemini:** Better at the organic hand-drawn quality of doodles and loose illustration elements
- **Default to GPT** unless the balance tips heavily toward illustrations over text

## Example Breakdown

**Request:** "Sketchnote summary of the 4 principles of good design"

```
Subject: Sketchnote with bold header "Good Design", 4 sections each with an icon + 2-3 bullet points: (1) Useful — lightbulb icon, (2) Usable — hand pointer icon, (3) Beautiful — diamond icon, (4) Delightful — sparkle icon. Margin doodles of small stars and arrows connecting concepts.
Framing: Full notebook page, portrait orientation, header at top, 4 content blocks in a 2x2 grid below, margins with doodles, pen lying diagonally at bottom for scale
Lighting: Soft overhead, subtle shadow from the pen, warm cafe-study ambiance
Mood: Intellectual satisfaction, organized learning, the pleasure of visual note-taking
Medium: Dot-grid notebook paper (cream colored, visible texture), fine black pen for text and outlines, coral red highlighter for headers, teal highlighter for key terms, pencil gray for secondary notes
Style: Mike Rohde sketchnote aesthetic — bold headers, simple icons, connecting arrows, deliberate use of hierarchy through size and weight
---
Aspect Ratio: 3:4
Model: GPT (multiple text labels must be accurate)
Key Details: Paper texture visible throughout, pen ink has slight variation in darkness suggesting real ballpoint, highlighter marks show through slightly from other side of page, imperfect hand-lettering with personality
```

**Prompt:** A realistic photograph of an open dot-grid notebook page in 3:4 portrait format, filled with hand-drawn sketchnotes. The cream-colored paper shows visible fiber texture and faint dot grid. At the top, "Good Design" is written in bold black pen lettering with a coral red highlighter underline. Below, four sections arranged in a 2x2 grid, each with a simple hand-drawn icon and bullet points in fine black pen: "Useful" with a lightbulb doodle, "Usable" with a hand pointer doodle, "Beautiful" with a diamond shape, "Delightful" with a sparkle burst. Key terms in each section are highlighted in teal marker. Small connecting arrows and margin doodles — tiny stars, arrows, question marks — fill the edges organically. A fine-tip black pen lies diagonally at the bottom of the page casting a subtle shadow. The ink shows natural variation in darkness as real ballpoint does, and highlighted marks show a faint bleed-through from the other side of the paper. The overall aesthetic is an authentic designer's sketchnote journal — warm, studious, and intellectually satisfying. Soft overhead lighting creates a cafe-study ambiance. Include ONLY these text labels (verbatim): "Good Design", "Useful", "Usable", "Beautiful", "Delightful".

## Known Pitfalls

- "Notebook style" without paper texture specification produces flat white backgrounds — specify dot-grid or grid paper explicitly
- Text accuracy critical for sketchnotes — use GPT and limit to essential keywords (under 10 text labels)
- Without pen/highlighter specification, models use unrealistic perfect lines — specify "hand-drawn, slight imperfection"
- The pen-on-page prop adds massive believability — always include it
- Highlight bleed-through is a subtle realism cue that makes notebooks feel photographed rather than generated

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Better text label accuracy, cleaner readable bullets, slightly more controlled layout
- **Gemini:** Better organic hand-drawn quality, more natural paper texture rendering, doodles feel more spontaneous
- **Verdict:** Slight GPT edge due to text dependency, but both produce usable results. Use Gemini when the sketchnote is more visual/doodle-heavy than text-heavy.
