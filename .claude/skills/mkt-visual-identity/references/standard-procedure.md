# Template Standard Procedure

The canonical sequence for extracting/iterating a template from a ref. **All steps are MANDATORY** — the validator enforces structural rules, the diagnostic tools enforce visual quality. Skipping steps produces the regression class we already debugged ("text too small", "badge misaligned", "headline → body gap too big").

> **Output discipline (applies to the agent AND to any inline fallback in main chat).** Do NOT generate scratch/trial/"setup" files in the project tree. The only render this flow writes is the single `{template_dir}/preview.png`; diagnostics go to `{template_dir}/_workdir/`. NEVER dump ad-hoc trial renders or font-size/letter-spacing "sweeps" (e.g. `_sweep2/`, `_workdir_sweep/`, `p_9.5.png`, `c_10.0_-0.05.png`) at the project root or under `brand_context/` — the user has flagged these as garbage; do not create them even to delete them later. Trust the deterministic font-size derivation (step 2/3) instead of eyeballing variants; if a trial render is ever unavoidable, use an OS temp dir (`mktemp -d`) and remove it before continuing.

## The flow (one diagram)

```
ref.png ─┐
         ▼
   ┌────────────────────────────────┐
   │ 1. clean_ref.py                │  → bg.png + bg.png.log.md
   │    (re-tint coral→brand, strip text)
   └────────────────────────────────┘
         │
         ▼
   ┌────────────────────────────────┐
   │ 2. _measurements.yaml          │  (Claude in chat — vision-as-ruler + zoom-crop per icon)
   │    - bbox_pct + font_size_cqw  │
   │    - role per element          │
   │    - render_strategy per elem  │
   └────────────────────────────────┘
         │
         ▼
   ┌────────────────────────────────┐
   │ 3. validate_measurements.py    │  ← HARD GATE
   │    - gutter alignment          │
   │    - type scale range          │
   │    - spacing rhythm gaps       │
   │    - feed-legibility floors    │
   └────────────────────────────────┘
         │ pass
         ▼
   ┌────────────────────────────────┐
   │ 4. template.html               │  (deterministic translation, NO invented numbers)
   └────────────────────────────────┘
         │
         ▼
   ┌────────────────────────────────┐
   │ 5. render_template.py          │  → preview.png
   └────────────────────────────────┘
         │
         ▼
   ┌────────────────────────────────┐
   │ 6. Diagnostic artifacts        │  → _workdir/_grid.png, _overlay.png, _diff.png
   │    compare_ref_to_preview      │
   │    measure_text_heights        │
   └────────────────────────────────┘
         │
         ▼
   ┌────────────────────────────────┐
   │ 7. (optional) ssc-art-director │  → markdown review with score + verdict
   └────────────────────────────────┘
         │
         ▼  if score < 90 → iterate (edit _measurements.yaml, re-run from step 3)
```

## QA: spawn the agent, NEVER run scripts in main chat

After `clean_ref.py` + `_measurements.yaml` + `template.html` are in place, **the main chat orchestrator spawns the `ssc-art-director` agent** instead of running QA scripts directly. The agent runs everything (validate + render + diagnostics + measure + vision review) INTERNALLY and returns ONE markdown report.

```python
Agent({
  subagent_type: "general-purpose",
  description: "Template QA — {template_id}",
  prompt: """You are ssc-art-director (read .claude/agents/ssc-art-director.md).

  template_dir: {abs_path}
  brand_context_dir: {abs_path}
  pool: linkedin-carousel
  template_id: {slug}
  mode: full

  notes: {brand-aware context if any}

  Run the full pipeline per your <pipeline> section. Return the markdown report verbatim."""
})
```

**Why spawn an agent instead of running scripts?** The validator output, render logs, diff-tool stdout, and text-height tables would otherwise flood the main chat context. The agent absorbs all that, returns ONE consolidated markdown report with score + verdict + specific fixes. Main chat stays clean.

**Fallback (debugging only)**: if the agent is broken or unavailable, you can run the pipeline manually via `run_template_qa.py` (same script the agent uses internally). This is NOT the default path.

```bash
# Fallback path — pollutes main chat with validator + diagnostic stdout
uv run .claude/skills/mkt-visual-identity/scripts/run_template_qa.py \
    --template-dir brand_context/templates/<pool>/<slug> \
    --brand-context brand_context
```

## Folder layout (clean discipline)

**At template root** (source of truth + final outputs only):

```
ref.png                 # source ref
bg.png                  # cleaned bg (from clean_ref.py)
template.html           # deterministic from _measurements.yaml
instructions.md         # slot docs
_measurements.yaml      # source of truth
preview.png             # final render
*.ttf                   # font files for @font-face
badge-tight.png         # brand-extracted assets used by template
icon-claude.png         # (any other per-template asset)
```

**Inside `_workdir/`** (diagnostics + logs — gitignore-able, regenerable):

```
_grid.png _overlay.png _diff.png       # current QA artifacts
_clean-prompt-blue.txt                  # input prompts (audit)
bg.png.log.md badge.log.md              # script-generated logs
_inventory.yaml                         # legacy from v1 (now lives as `## Inventory` block inside instructions.md; standalone file is no longer written)
```

When iterating, the QA artifacts in `_workdir/` are OVERWRITTEN, not versioned. You see ONE current `_grid.png`, not 17 of them.

To clean a polluted folder (versioned files, scattered logs):

```bash
uv run .claude/skills/mkt-visual-identity/scripts/cleanup_template_folder.py \
    --template-dir brand_context/templates/<pool>/<slug>
```

Add `--dry-run` to preview without moving.

## Standard structural rules (validator-enforced)

All of these come from `design-fundamentals.md` and the validator BLOCKS templates that violate them:

| Rule | Constraint | Why |
|---|---|---|
| Content gutter | All primary elements left = 10% (±0.5%) | Eye reads aligned edges as intentional |
| Type scale | Each role's font_size in defined range (display 6-8.5, body 3-3.8, kicker 1.2-1.8, ...) | Modular 1.5× scale, no in-between sizes |
| Feed-legibility floor | Body ≥ 3.0cqw, display ≥ 4.5cqw, numeral ≥ 5.5cqw | Survives LinkedIn/IG thumbnail compression |
| Spacing rhythm | Paired (headline→body) gap ≤ 3% canvas-h; default ≤ 5% | Tighter pairs read as related, looser as disconnected |
| Bbox bounds | left+width ≤ 100, top+height ≤ 100 | No overflow off-canvas |
| Width floor | Primary text width ≥ 60% | Below this, reads as footnote |

## When the validator fires a warning vs an error

- **Errors (return code 2)** — structural problems the eye will catch: gutter drift, font outside scale, font below feed floor, bbox overflow. **Must fix.**
- **Warnings (return code 0 unless --strict)** — soft signals: width below 60%, area > 30%, spacing gap > paired-rule. Surface to user, allow override.

## When to bypass a rule (and how)

The validator allows explicit bypasses via per-element flags:

```yaml
- id: full-bleed-display-word
  bbox_pct: [0, 25, 100, 22]      # breaks gutter
  breaks_gutter: true
  breaks_gutter_reason: "Magazine cover word spanning canvas edge-to-edge per ref"
```

`breaks_gutter: true` silences the gutter error for that element. Other rule bypasses (scale, spacing) follow the same pattern but are rarer.

## Iteration discipline

When you iterate after `run_template_qa.py` reports issues:

1. **Edit `_measurements.yaml`**, NOT `template.html` directly. The template is the deterministic output.
2. Re-run `run_template_qa.py` — diagnostic artifacts overwrite automatically.
3. Read the deltas (`measure_text_heights` output, `_grid.png` ruler, `_overlay.png` blend).
4. If after 3 iterations score still < 80, the problem is probably brand-level (font choice, content length) not template-level. Pause and discuss.

## Quick-reference commands

```bash
# Full QA loop (one command):
uv run .claude/skills/mkt-visual-identity/scripts/run_template_qa.py \
    --template-dir <path> --brand-context <path>

# Validator only:
uv run .claude/skills/mkt-visual-identity/scripts/validate_measurements.py \
    --measurements <path>/_measurements.yaml

# Visual diff (any mode):
uv run .claude/skills/mkt-visual-identity/scripts/compare_ref_to_preview.py \
    --ref <ref.png> --preview <preview.png> \
    --mode {side-by-side|overlay|diff|grid} --output <path>

# Text height delta:
uv run .claude/skills/mkt-visual-identity/scripts/measure_text_heights.py \
    --image preview.png --compare-to ref.png

# Cleanup folder noise:
uv run .claude/skills/mkt-visual-identity/scripts/cleanup_template_folder.py \
    --template-dir <path>
```
