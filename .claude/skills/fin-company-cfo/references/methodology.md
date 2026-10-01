## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/fin-company-cfo/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /fin-company-cfo — Monthly company CFO workflow

The standing analysis leadership uses to make distribution / cuts / hiring / runway decisions. Primary cadence is **monthly** (run on the 1st for the closed prior month). Weekly and scenario modes cover the in-between.

Anonymized team-scope sibling to `fin-personal-cfo` (households). Same discipline (transaction-sum EOM, categorization traps, scenario modeling) applied to company books.

<a id="step-0--load-company-config--prior-run"></a>
## Step 0 — Load company config + prior run

Before starting work, read these in order:

1. **`${COMPANY_CFO_ROOT:-context/config/fin-company-cfo}/company-config.md`** — your company's specific methodology, data source map, categorization rules, distribution mechanics. **This is the source of truth for HOW your company computes things.** Don't invent your own methodology.
2. **The most recent report** in `projects/fin-company-cfo/` — last month's snapshot. Tells you what leadership decided + what was open.
3. **The most recent `*-followup.md`** in that folder (if one exists) — supplementary decisions, scenario analysis.
4. **Any relevant memory notes** in `context/knowledge/personal/notes/` — running context: known anomalies, leadership constraints, current churn state.
5. **`git log --oneline -10`** in `${COMPANY_CFO_ROOT}` — what's shipped since the last run.

If the `COMPANY_CFO_ROOT` dir doesn't exist yet: first-run walkthrough asks the user to `mkdir` it, seed a `company-config.md` from `company-config-template.md`, and set the env var.

<a id="step-1--parse-mode"></a>
## Step 1 — Parse mode

| Invocation | Mode | Cadence |
|---|---|---|
| `/fin-company-cfo monthly` (default) | **monthly** | Once per month on the 1st for the closed prior month |
| `/fin-company-cfo weekly` | **weekly** | Thin cash pulse — current cash + next 2 weeks of expected flows |
| `/fin-company-cfo scenario <question>` | **scenario** | Ad-hoc modeling in the projector |
| `/fin-company-cfo pickup` | **pickup** | Resume where the prior run left off (checks git log + last report + open items) |

Below sections walk through **monthly** in detail. Weekly + scenario are summarized at the end.

---

<a id="monthly-workflow"></a>
## Monthly workflow

Ask the user: **Which month are we reporting on?** (Default: prior calendar month.)

Walk through these read-only analysis phases. Use existing authorization; ask only for missing facts that affect correctness.

<a id="phase-1--pull-raw-data"></a>
### Phase 1 — Pull raw data

For the target month, pull raw data from each source. Standard source categories (each company's actual tools live in their `company-config.md`):

| Source category | What it gives | Common tools |
|---|---|---|
| **Bank / cash accounts** | Cash truth, internal vs external transfers, distribution recipients | Mercury CLI, Plaid, direct bank export |
| **Payment processor** | Revenue, subscriptions, churn, payout timing | Stripe API, Paddle, LemonSqueezy |
| **Payroll / contractors** | W-2 payroll, contractor pay | Plane, Deel, Gusto, Rippling |
| **Expense management** | Reimbursements, corporate cards | Ramp, Brex, Divvy |
| **Alternative revenue** | Non-primary billing sources | Direct invoice tools, alternative payment platforms |

Save all pulls to `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/raw/{YYYY-MM-DD}_{source}.json[l]` (gitignored — raw data doesn't get committed).

Also pull the **current cash balance** from the bank source for the "today" starting-cash figure.

**If a source is unavailable:** use user-supplied CSV/export data or report the gap. Offer `/meta-toolify` for a requested integration; setup is not a prerequisite to analyzing supplied data.

<a id="phase-2--categorize-and-reconcile"></a>
### Phase 2 — Categorize and reconcile

Bucket all cash-account outflows into the categories your company uses. See `categorization.md` for a starter category set and the discipline of maintaining categorization.

**Universal traps to check** (see `traps.md` for full list):

- **Cash-vs-credit double-count** — if the bank shows a "credit card autopay" outflow AND the credit card account shows individual charges, don't count both. Filter to cash accounts only OR treat the CC as a debt account.
- **Internal transfers** — Checking ↔ Savings transfers net to zero. Exclude them (usually via a `kind=internalTransfer` filter or account-pair match).
- **Currency mismatches** — contractor payment tools often return `destination_amount` in the worker's payout currency. Always use `source_amount` (or equivalent) for USD/base-currency cost analysis.
- **Distribution counting** — if leadership has N partners who should get a monthly distribution, verify N distributions exist. If N-1, flag the missing partner — often one is deferring their draw to balance cash.

Cross-checks before writing the report:
- Total payroll debits in bank ≈ payroll-tool API total + fees (within a small residual for held deductions)
- Payment processor payouts arriving in the month ≈ bank inflows from that processor (within timing lag)
- Expense-management outflows in bank ≈ approved expenses in expense-mgmt tool (with cash-basis lag)

<a id="phase-3--compute-eom-cash-the-transaction-sum-method"></a>
### Phase 3 — Compute EOM cash (the transaction-sum method)

**Use a verified opening baseline plus posted transaction sums over a known complete period.** Reconcile to an observed balance at the same cutoff. A live snapshot with a different cutoff or missing pending transactions is not directly comparable.

Correct method (see `eom-cash-methodology.md` for the full recipe):

```python
# 1. Pull ALL transactions for each cash account (Checking + Savings + any other cash-holding):
#    <bank-tool> transactions list --account-id <id> --format jsonl --max-items 100000
# 2. Sum signed posted amounts and add the verified opening balance for each account.
# 3. Reconcile to the observed posted account balance at the matching cutoff.
#    Investigate missing history, pending items, currencies, or an incorrect opening baseline.
# 4. At cutoff T: opening balance + posted transactions from opening through T.
```

Cross-check EOM: last month's EOM + this month's net cash change should equal this month's EOM, to the dollar.

If transaction sums don't reconcile with current balance, **do not proceed** with walkback as fallback. Investigate the gap first — missing pulls (timeout, paging), an unknown account, or a legitimate pre-history baseline.

<a id="phase-4--update-the-scenario-projector"></a>
### Phase 4 — Update the scenario projector

Most CFO workflows benefit from a scenario projector — an interactive forecast that projects EOM cash forward N months under adjustable assumptions (revenue growth, expense scenarios, hiring plans, distribution changes).

Common structure (see `scenario-projector.md` for the reference implementation):

- **HISTORICAL** (trailing 3 closed months) — provides context before TODAY
- **TODAY** — actual current cash balance (calendar-positioned within current month)
- **Mo 1** — current calendar month EOM (partial — remaining-month activity)
- **Mo 2-7** — next 6 full calendar month EOMs (scenario settings apply from here)

Each month: `starting + revenue − expenses = profit → ending`

**Intramonth cycle low** (for weekly cash pulse relevance): most CFO systems care about the *low* point of the month (when you might hit a cash floor), not just the high (EOM). Formula depends on payout cadence — see `scenario-projector.md`.

**Update the projector each monthly run:**
1. Append the just-closed month to HISTORICAL with all category fields; drop the oldest.
2. Update `startingCash` to today's actual bank balance.
3. Update expense baselines for any category that materially shifted.
4. Update `baselineMrr` (net of processing fees).
5. Verify presets still make sense (scenarios may need updating if comp structure or hiring plans changed).

<a id="phase-5--write-the-snapshot-report"></a>
### Phase 5 — Write the snapshot report

Create `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/{YYYY-MM-DD}_monthly.md` following the template in `report-template.md`. Sections (adapt as needed):

1. **TL;DR** — headline + status table (net cash, ending balance, current MRR, trailing-N-month, recommendation)
2. **Cash In** — by source (payment processor, alt revenue, one-times)
3. **Cash Out** — by category (matches the projector's category structure)
4. **Payroll breakdown** — verified contractor + W-2 split
5. **Distributions** — who got paid, who didn't (flag anomalies)
6. **Revenue metrics** — active subs, MRR delta, recent cancels with $ and customer
7. **Forward projection** — 1-3 scenarios from the projector (link the projector state)
8. **Recommended actions** — concrete for leadership to decide on
9. **Open items** — questions to resolve next month

Write the why-paragraph in plain English: what happened and why. Reference the previous month if there's continuity ("Vendor X churn from last month finished hitting June payouts").

<a id="phase-6--update-memory"></a>
### Phase 6 — Update memory

Append a dated contextual entry to this skill’s scoped `context/learnings.md` section and update the company knowledge note only when requested if any of:

- Distribution/comp structure changed
- Active sub count or MRR shifted materially
- New revenue stream (new billing platform)
- New partner / contractor decision
- New cash floor or distribution constraint

Don't bloat the note. Replace stale facts; don't append indefinitely.

<a id="phase-7--review-and-ship"></a>
### Phase 7 — Review and ship

Review source coverage, cutoff dates, reconciliations, assumptions, and scenario arithmetic.
Protect raw bank/payroll exports and secrets with the workspace's ignore/access rules.
Show the report and projector paths, changes since the prior period, and specific leadership decisions.
Do not automatically stage, commit, push, create a PR, merge, or distribute financial records.

---

<a id="weekly-cash-pulse-mode"></a>
## Weekly cash pulse mode

Thin — designed to fit into a 15-minute weekly sync.

1. Pull current cash balance (bank API `accounts list`)
2. Pull last 7 days of transactions + next 7 days of scheduled outflows (payroll, known bills)
3. Compute: current cash, next-payroll date + amount, next-Stripe-payout date + amount
4. Flag if cash < next 2 weeks of outflows (below cash floor)
5. One-line status: `Cash $X | Next payroll $Y on <date> | Next inflow $Z on <date> | Floor status: OK|WATCH|BREACH`

Save to `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/{YYYY-MM-DD}_weekly.md`.

Pair with `/ops-loopify` to schedule the weekly run (typically Monday 9am).

<a id="scenario-mode"></a>
## Scenario mode

Ad-hoc — for "what if we hire a $150K/yr engineer in September" or "what if churn ticks up 2%".

Open the scenario projector, adjust the relevant knobs, screenshot or export the resulting cash projection. Save the analysis to `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/{YYYY-MM-DD}_scenario.md`.

If the scenario decision is material (new hire, distribution change, big expense), also run `/str-decide` to formalize.

<a id="pickup-mode"></a>
## Pickup mode

Resume from the prior run. Surface:

1. Most recent monthly report (`ls -t projects/fin-company-cfo/*.md | head -1`)
2. Most recent weekly pulse
3. Latest `git log` on `${COMPANY_CFO_ROOT}` (what's shipped since last snapshot)
4. Memory note for current narrative
5. Open items from the last report's §9

**Don't assume continuity from training data.** Always check the reports + memory + git log first.

<a id="composes-with"></a>
## Composes with

- **`fin-personal-cfo`** — sibling. Personal-cfo handles household finances (house math, monthly cash flow, big purchases). Same discipline (transaction-sum method, scenario modeling) applied to different scope.
- **`meta-toolify`** — wire company-specific data sources (Mercury API, Stripe, Plane, Ramp, or equivalents). First-run integration setup.
- **`ops-loopify`** — schedule the monthly run (1st of month) + weekly cash pulse (Monday 9am).
- **`str-decide`** — for material decisions surfaced by the report (distribution changes, hiring, cash floor breach response). Formalize with the 37signals framework.
- **`str-deep-research`** — for benchmark questions ("what's a typical SaaS marketing budget as % of ARR?") that inform scenario inputs.

<a id="notes-on-quality"></a>
## Notes on quality

- **Never invent methodology.** Every company computes cash differently — trust the company's `company-config.md` in `${COMPANY_CFO_ROOT}`. If it's not documented, ask; don't guess.
- **Transaction-sum method is non-negotiable.** Walkback from a balance snapshot has burned CFO workflows repeatedly. Use raw transaction sums, verify against current balance.
- **Categorization discipline matters more than accuracy.** Same categories every month = trend-readable. Changing categories mid-year = trends become noise.
- **Baseline expenses to actuals, not to "safe" estimates.** A software line modeled at $8K when actuals run $12K creates optimistic projections that break the model.
- **Revenue is net of processing fees, not gross.** ~3% Stripe/similar processor fees materially change monthly cash inflow.
- **The intramonth cycle low matters more than EOM.** With monthly payout cadences, cash dips deep mid-month. Cash floor applies to the LOW, not the EOM HIGH.
- **Weekly payouts smooth the cycle dramatically** — if your payment processor supports it, switching from monthly to weekly payouts is one of the highest-leverage cash-management moves available. See `eom-cash-methodology.md`.
- **When numbers don't reconcile, stop.** Don't ship a report with unexplained gaps. Investigate first — a $42K reconciliation gap once propagated silently for weeks before being caught.

<a id="when-not-to-use-this-skill"></a>
## When NOT to use this skill

- **Ad-hoc single-number lookups** ("what's our current cash?") — just query the bank source directly, don't run the full workflow.
- **Tax / accounting questions** — out of scope; refer to your CPA.
- **Personal finance** — use `fin-personal-cfo` instead.
- **Investor pitch financials** — different discipline (multi-year projections, unit economics deep dives). This skill covers operational CFO cadence, not fundraising narrative.
