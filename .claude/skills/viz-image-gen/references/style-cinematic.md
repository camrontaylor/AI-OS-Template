# Cinematic Style

## When to Use

Film stills, movie poster concepts, dramatic environmental storytelling, atmospheric scenes, cyberpunk/sci-fi concepts, noir scenes, any image where mood and atmosphere dominate over subject detail.

## Framework Element Presets

| Element | Preset | Notes |
|---------|--------|-------|
| Subject | Often secondary to atmosphere — figures as silhouettes or environmental elements, back-to-camera common | Less about who, more about where and how it feels |
| Framing | Anamorphic 2.39:1 widescreen, wide establishing shots, low angles for power, negative space for isolation | Letterbox format is the signature |
| Lighting | Volumetric fog/haze catching colored light, neon reflections on wet surfaces, practical lights in frame, rim lighting, teal and orange color grading | Lighting IS the subject in cinematic |
| Mood | Melancholic, tense, epic, mysterious, isolated — always emotionally charged | Never neutral — cinematic means feeling something |
| Medium | Digital cinema camera (Arri Alexa look), anamorphic lens characteristics (horizontal flares, oval bokeh) | Can also reference specific film stocks for period looks |
| Style | Blade Runner 2049, Roger Deakins, Denis Villeneuve, Wong Kar-wai, Fincher (desaturated), Nolan (IMAX scale) | Name specific cinematographers/directors for precision |

## Model Recommendation

**Gemini wins** — artifact-free atmospheric scenes, superior volumetric light rendering, natural neon color bleeding.

**Evidence from shootout:**
- Gemini produced clean, artifact-free atmospheric scenes with proper neon reflection behavior
- GPT had superior composition and framing but introduced wavy line artifacts in fog/haze areas
- For pure atmosphere: Gemini. For composition-critical shots: consider GPT but inspect for artifacts

## Example Breakdown

**Request:** "Cyberpunk city alley at night"

```
Subject: Narrow alley between towering buildings, steam vents, hanging cables, a single figure in the distance walking away, holographic advertisements flickering on walls
Framing: Wide shot, low angle looking up at sliver of sky, anamorphic 2.39:1, deep perspective with converging lines
Lighting: Neon signs in magenta and teal casting colored pools on wet ground, steam catching and diffusing the light, no single dominant source — environmental practical lighting only
Mood: Lonely futurism, urban isolation despite visual density, the smallness of humans in technological excess
Medium: Digital cinema, Arri Alexa sensor rendering, anamorphic lens with horizontal flares from neon sources, oval bokeh on distant lights
Style: Blade Runner 2049 color palette meets Ghost in the Shell environmental density, Roger Deakins wet-surface reflection work
---
Aspect Ratio: 21:9
Model: Gemini (atmospheric volumetric + neon reflections)
Key Details: Steam interacting with colored light sources, wet ground reflecting everything, figure small enough to feel insignificant
```

**Prompt:** A narrow alley between towering buildings stretches into deep perspective, shot from low angle in anamorphic 2.39:1 widescreen looking up at a thin sliver of dark sky between the structures. Steam vents release clouds that catch and diffuse magenta and teal neon light from flickering holographic advertisements on the walls. Hanging cables cross overhead creating geometric patterns against the glow. A single distant figure walks away, small and insignificant against the vertical scale of the architecture. Wet ground reflects every light source in elongated pools of color — magenta bleeding into teal where the puddles overlap. Horizontal anamorphic lens flares streak from the brightest neon sources. The scene breathes with lonely futurism and urban isolation, humanity dwarfed by technological excess. Rendered with Arri Alexa digital cinema sensor characteristics — rich shadow detail, controlled highlight rolloff, oval bokeh on distant lights. Color grading references Blade Runner 2049's teal-orange palette crossed with Ghost in the Shell's environmental density.

## Known Pitfalls

- "Cinematic" alone produces generic dark blue images — MUST specify the specific type of cinematic
- Volumetric fog/haze is where GPT introduces wavy artifacts — check output carefully
- Neon reflections on wet surfaces: Gemini handles color bleeding naturally, GPT can oversaturate
- Anamorphic characteristics (oval bokeh, horizontal flares) are often ignored — specify repeatedly
- Without a subject anchor point, images can feel like empty tech demos — always include a human element even if small

## Comparison Notes (GPT vs Gemini Shootout)

- **GPT:** Better composition, more intentional framing, but prone to wavy line artifacts in atmospheric/foggy areas
- **Gemini:** Cleaner atmospheric rendering, natural neon behavior, artifact-free fog/haze, slightly less controlled composition
- **Verdict:** Gemini wins for cinematic — atmosphere is the priority and artifacts are unacceptable in film-quality output
