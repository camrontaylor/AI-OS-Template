# First-Run Onboarding

Run onboarding before strategy, setup, or generation whenever the saved profile is missing, partial, stale, or the tool setup changed. The goal is not a long intake. The goal is a reusable operating profile that lets the skill produce a useful first batch immediately and tell the operator exactly what to connect next.

## Saved Profile

The wizard writes:

```text
projects/{skill-name}/onboarding/{client}/onboarding-profile.json
```

Each skill folder includes the same onboarding assets, so an installed skill is portable and does not need `_shared`.

## Fast Path

From the installed skill folder:

```bash
python3 scripts/onboard.py --client "{client-name}"
```

For a non-interactive smoke test:

```bash
python3 scripts/onboard.py --client "{client-name}" --quick
```

Load the saved profile before reading learnings or writing strategy. Treat profile values as defaults, not as hard rules; if a campaign prompt overrides a value, use the prompt and update the profile only if the operator asks.

## What To Capture

### 1. Activation target

Define the first successful use in operational terms:

- The first ready-to-upload batch shape: concepts, variants, and ratios.
- The expected time-to-value target.
- The approval definition: what must be true for the operator to say "this is usable."

### 2. Business and offer context

Capture the offer, website, landing pages, goal, KPI, target CPA or ROAS, and funnel stage. For a launch-ready campaign, also capture the default naming convention and UTM convention.

### 3. Audience and markets

Capture the ICP, awareness stage, target markets, languages, exclusions, and any special category risk. This prevents generic hooks and avoids accidental targeting or compliance mistakes.

### 4. Creative preferences

Capture voice, visual style, photo style, typography notes, color notes, layout preferences, and explicit "do not use" rules. Include brand assets and style anchors:

- Logo path.
- Product photo path.
- Reference ads or landing pages to imitate.
- Reference ads or patterns to avoid.
- Figma file key when the template path is used.

### 5. Performance history

If the operator has data, capture the source and patterns rather than dumping raw metrics into the profile:

- Winning themes, structures, and words.
- Losing themes, structures, and words.
- Angles to extend.
- Angles to avoid.
- Minimum impressions before judging a test.

### 6. Compliance and approvals

Capture regulated category status, mandatory disclaimers, banned claims, approval workflow, and default launch status. Use `paused_for_review` as the default launch status unless the operator explicitly prefers something else.

### 7. Media-buying workflow

Capture the ad account context without storing secrets:

- Which ad accounts or platform workspaces exist.
- Which platforms are connected or usually exported manually.
- Monthly budget, test budget, and daily spend cap if known.
- Audience sources: customer lists, pixel audiences, lookalikes, saved audiences, keyword lists.
- Retargeting windows and exclusion rules.
- Frequency cap or fatigue notes.
- Pause thresholds, such as max CPA, minimum CTR, frequency, or spend without conversion.
- Who can prepare assets and who must approve launch.

### 8. Tool connections

Walk through tool connections and save status in `tool_connections`.

| Skill | Required | Useful optional |
|---|---|---|
| `viz-ad-creative-codex` | Codex with native image generation | ChatGPT Images, Adobe Firefly, Runway, Canva, or sibling skills as manual/subscription fallback |
| `viz-ad-creative-fal` | `FAL_KEY`, Node 18+ | fal MCP for model discovery/pricing |
| `viz-ad-creative-figma` | `FIGMA_TOKEN` + template file, or Node + `npm install` | Figma MCP, Figma file key, Figma Buzz/Weave-style template workflow |

Also check whether the operator has:

- Google Ads, Meta Ads, LinkedIn Ads, TikTok Ads, or reporting exports available.
- Conversion tracking or pixel status.
- Landing page/CMS access.
- Asset storage access.
- A Figma brand file or template.

Never store secret values in the profile. Store only `set`, `missing`, or human-readable setup notes.

## First-Use Behavior

After onboarding:

1. Print the saved profile path.
2. Print the open gaps.
3. Print the next setup action.
4. Run `bash scripts/setup.sh` only after the profile exists.
5. If required generation credentials are missing, stop before generation and show the exact env var to add.

## Improvements Mined From Skill Search

Use these patterns when refining the interview or manually onboarding:

- Start with one clear activation moment, not a generic setup checklist.
- Pull brand context or website-derived branding before image generation when possible.
- Capture performance data as winning and losing patterns so future batches iterate from evidence.
- Capture campaign naming and UTM conventions early so generated files and slates are launch-ready.
- Capture conversion tracking status and launch safeguards before producing anything intended for live spend.
- Default campaign launch state to paused or review-required; creative generation should not imply launch approval.
