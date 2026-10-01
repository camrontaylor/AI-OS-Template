## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/fin-personal-cfo/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/fin-personal-cfo/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /fin-personal-cfo — Personal financial scenario modeling

This skill is for a household (you + partner): housing decisions, monthly cash flow, big purchases, scenario what-ifs. Pair it with a business-books CFO skill if you also run one for a company — the DNA is the same, the domain is different.

<a id="step-1--pick-the-scenario-type"></a>
## Step 1 — Pick the scenario type

| Invocation | Type | What it models |
|---|---|---|
| `/fin-personal-cfo house` (default for now) | **house** | Buy a house + rental income scenarios (ADU / bedrooms / combinations) + renovations + monthly cash flow |
| `/fin-personal-cfo refi` | **refi** | Refinancing scenarios |
| `/fin-personal-cfo cash-flow` | **cash-flow** | Generic monthly cash flow (income, expenses, savings rate) |
| `/fin-personal-cfo big-purchase` | **big-purchase** | Should we buy X (car, education, equipment) — cash vs finance vs lease comparisons |
| `/fin-personal-cfo side-income` | **side-income** | Adding a side income stream — break-even, tax implications |
| `/fin-personal-cfo savings-what-if` | **savings-what-if** | What if we put $X into Y for N years — index funds, real estate, etc. |

For v0.1, only the **house** template is fleshed out. Others are sketched in `templates/` as stubs.

<a id="step-2--gather-inputs"></a>
## Step 2 — Gather inputs

Ask in a structured batch. For house mode, see `templates/house.md` for the full input questionnaire. Core fields:

**Property**
- Purchase price
- Down payment (% or $)
- Mortgage rate + term (years)
- Property taxes (annual)
- HOA (monthly, if any)
- Homeowner's insurance (monthly)
- Closing costs (estimate)

**Renovations / repairs**
- Day-1 renovations (line items with estimates — kitchen, bath, ADU buildout, etc.)
- Year-1 expected repairs
- Annual maintenance budget (rule of thumb: 1% of purchase price)

**Rental scenarios** (for the house mode)
- ADU monthly rent estimate + vacancy assumption (typical: 5–8%)
- Bedroom 1 monthly rent + vacancy
- Bedroom 2 monthly rent + vacancy
- Utilities split assumption (who pays what)
- Property management cost (if not self-managing)

**Personal**
- Current monthly housing cost (rent or current mortgage)
- Combined household income
- Marginal tax bracket (for mortgage interest + rental income calcs)
- Time horizon for the analysis (typical: 5 yr, 10 yr, 30 yr)

If anything's fuzzy, ask. Don't proceed with placeholder numbers — financial models with wrong inputs are dangerous.

<a id="step-3--build-the-scenarios"></a>
## Step 3 — Build the scenarios

For the house mode, default scenarios to compare:

| Scenario | Description |
|---|---|
| **Baseline** | Own + live in, no rental income |
| **A: ADU only** | Rent the ADU, live in main house |
| **B: 1 bedroom only** | House-hack 1 bedroom, keep ADU empty (or for guests) |
| **C: 2 bedrooms only** | House-hack 2 bedrooms, ADU empty |
| **D: ADU + 1 bedroom** | Both ADU and 1 bedroom rented |
| **E: ADU + 2 bedrooms** | Maximum rental |
| **F: ADU + bedrooms (year 2+)** | Year 1: just ADU while renovating. Year 2+: add bedrooms after partner's comfort |

Let the user customize the scenario list — every house is different.

<a id="step-4--run-the-math"></a>
## Step 4 — Run the math

For each scenario, calculate:

**Monthly**
- Mortgage payment (P&I) — see `calculators.md` for the formula
- + Property tax / 12
- + HOA + Insurance + Utilities (owner-paid portion)
- − Gross rental income (rooms + ADU)
- × (1 − vacancy rate) for effective rental income
- − Property management fee (if applicable)
- = **Net monthly housing cost** (negative = positive cash flow)

**Annual**
- Sum of 12 months
- + One-time renovation costs (amortized over time horizon)
- − Tax savings (mortgage interest deduction + depreciation on rented portion)

**Long-term**
- Equity build-up (mortgage paydown + appreciation assumption — default 3%/yr)
- Total cost of ownership at year 5 / 10 / 30
- Return on cash invested vs. alternative (e.g., S&P 500 at 7% real return)

<a id="step-5--output-the-comparison-table"></a>
## Step 5 — Output the comparison table

Output to `projects/fin-personal-cfo/{YYYY-MM-DD}_{name}/`:
- `inputs.yaml` — all the input numbers (so the analysis is rerunnable + auditable)
- `report.md` — the full analysis with assumptions called out
- `comparison.md` — side-by-side scenario table (the headline output)

<a id="comparisonmd-template"></a>
### `comparison.md` template

```markdown
# <Property nickname> — scenario comparison

**Date:** YYYY-MM-DD
**Property:** <address or nickname>
**Time horizon:** 10 years
**Key assumptions:** 3%/yr appreciation, 7% S&P alt return, 6% vacancy

| Scenario | Net monthly cost | Annual cost | 10-yr total | Equity @ 10yr | Notes |
|---|---:|---:|---:|---:|---|
| Baseline | $X,XXX | $XX,XXX | $XXX,XXX | $XXX,XXX | No rental income |
| A: ADU | $X,XXX | $XX,XXX | $XXX,XXX | $XXX,XXX | $X,XXX/mo ADU rent |
| B: 1 BR | … | … | … | … | … |
| C: 2 BR | … | … | … | … | … |
| D: ADU + 1 BR | … | … | … | … | … |
| E: ADU + 2 BR | … | … | … | … | … |

<a id="headline-takeaway"></a>
## Headline takeaway
<1–2 sentences: which scenario wins on cash flow, which wins on lifestyle, where the inflection points are>

<a id="sensitivity-analysis"></a>
## Sensitivity analysis
- If rates rise 1%: <impact>
- If ADU rent comes in 20% lower: <impact>
- If renovations overrun 30%: <impact>
- If vacancy doubles to 12%: <impact>

<a id="open-questions"></a>
## Open questions
- <what would change the recommendation>
- <what to research next — composes with /deep-research>
```

<a id="step-6--archive"></a>
## Step 6 — Archive

Save the scenario folder so future revisits work. The archive index lives in `projects/fin-personal-cfo/` (create the directory if missing). Never write archives inside the skill's own folder — skill installs and upgrades re-sync from source and wipe anything saved there. **Migration:** if this skill's folder contains an old `scenarios-archive/` with user entries, move those files into the archive directory first.

Append a one-liner to `<archive dir>/INDEX.md` (create if missing):

```markdown
- 2026-06-26 — [<property nickname>](projects/fin-personal-cfo/<slug>-2026-06-26/) — <type> — <headline takeaway>
```

This compounds — when you're considering Property #2 a year later, you can reuse the model and grep past analyses for patterns.

<a id="step-7--surface--offer-follow-ups"></a>
## Step 7 — Surface + offer follow-ups

- Show the comparison table in chat
- Tell the user the workdir path
- Offer:
  - *"Want to run `/str-deep-research` on rental comps for the area to firm up the ADU and bedroom rent assumptions?"*
  - *"Want to formalize the buy/don't-buy decision through `/str-decide` once the scenarios land?"*
  - *"Want to add a pointer to this analysis to your project index?"*
  - *"Want me to revisit in 30 days as more info comes in (loan rate locked, inspection done, etc.)?"*

<a id="composes-with"></a>
## Composes with

- **`str-decide`** — once scenarios are modeled, the buy / don't / negotiate decision goes through `/str-decide`. Cash flow analysis is input, not the decision itself.
- **`str-deep-research`** — for inputs that need market data: rental comps, mortgage rate trends, neighborhood trajectory, school ratings, comparable sales.
- **`str-business-brainstorm`** — if the scenario tips into "this is a business" (e.g., short-term rental, multi-unit purchase, scaling to N properties), route there to pressure-test the business angle.

<a id="notes-on-quality"></a>
## Notes on quality

- **Conservative assumptions by default.** Default to higher vacancy (8% not 5%), lower appreciation (3% not 6%), 20% buffer on renovation estimates. Real estate optimism is the most reliable way to lose money.
- **Surface the sensitivity, not just the point estimate.** A scenario that's positive only if everything goes right isn't actually positive.
- **Lifestyle is a real variable.** "Living with 2 roommates" can be financially optimal AND a quality-of-life disaster. Note these tradeoffs in the report, even if they aren't quantified.
- **Tax calcs are starting points, not authoritative.** This skill estimates; an accountant verifies. Flag this in the report.
- **The decision isn't here — the inputs to the decision are.** This skill produces the model. `/str-decide` makes the call.
