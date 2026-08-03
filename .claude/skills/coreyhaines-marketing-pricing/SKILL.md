---
name: coreyhaines-marketing-pricing
description: "Set pricing, packaging, and monetization strategy - tiers, freemium, free trials, value metric, price increases, per-seat, annual vs monthly, willingness to pay - plus pricing-page teardowns scoring human clarity and AI-agent readability. Not for in-app upgrade screens (see coreyhaines-marketing-paywalls) or offer construction on services, courses, and high-ticket B2B (see coreyhaines-marketing-offers)."
when_to_use: 'Invoke when the request sounds like: ''pricing tiers'', ''how much should I charge'', ''freemium'', ''Van Westendorp'', ''should I offer a free plan'', ''my pricing is wrong'', ''pricing page teardown'', ''can AI read my pricing'''
metadata:
  version: 2.1.0
---

# Pricing Strategy

You are an expert in SaaS pricing and monetization strategy. Your goal is to help design pricing that captures value, drives growth, and aligns with customer willingness to pay.

## Context Needs

Load only what the task needs. Missing files never block the work: ask for what
is missing, or produce solid generic output and say what would sharpen it.

| File | Load level | Why |
|---|---|---|
| `brand_context/positioning.md` | targeted | How the offer is positioned |
| `brand_context/icp.md` | targeted | Who the output is speaking to |
| `brand_context/voice-profile.md` | targeted | Brand voice and tone |
| `brand_context/samples.md` | targeted | Reference examples of prior work |
| `brand_context/assets.md` | targeted | Logos, screenshots, and brand assets |
| `context/learnings.md` | `## coreyhaines-marketing-pricing` | Past corrections and preferences for this skill |

## Before Starting

**Check for brand context first:**
Read AI-OS brand context in `brand_context/` - `positioning.md`, `icp.md`, and `voice-profile.md` (plus `samples.md` / `assets.md` when useful) - before asking questions. Use that context and only ask for information not already covered or specific to this task. If those files do not exist yet, ask the user for what you need or offer to build them with `coreyhaines-marketing-product-marketing` or the AI-OS foundation skills `mkt-positioning`, `mkt-icp`, and `mkt-brand-voice`.

Gather this context (ask if not provided):

### 1. Business Context
- What type of product? (SaaS, marketplace, e-commerce, service)
- What's your current pricing (if any)?
- What's your target market? (SMB, mid-market, enterprise)
- What's your go-to-market motion? (self-serve, sales-led, hybrid)

### 2. Value & Competition
- What's the primary value you deliver?
- What alternatives do customers consider?
- How do competitors price?

### 3. Current Performance
- What's your current conversion rate?
- What's your ARPU and churn rate?
- Any feedback on pricing from customers/prospects?

### 4. Goals
- Optimizing for growth, revenue, or profitability?
- Moving upmarket or expanding downmarket?

---

## Pricing Fundamentals

### The Three Pricing Axes

**1. Packaging** - What's included at each tier?
- Features, limits, support level
- How tiers differ from each other

**2. Pricing Metric** - What do you charge for?
- Per user, per usage, flat fee
- How price scales with value

**3. Price Point** - How much do you charge?
- The actual dollar amounts
- Perceived value vs. cost

### Value-Based Pricing

Price should be based on value delivered, not cost to serve:

- **Customer's perceived value** - The ceiling
- **Your price** - Between alternatives and perceived value
- **Next best alternative** - The floor for differentiation
- **Your cost to serve** - Only a baseline, not the basis

**Key insight:** Price between the next best alternative and perceived value.

---

## Value Metrics

### What is a Value Metric?

The value metric is what you charge for-it should scale with the value customers receive.

**Good value metrics:**
- Align price with value delivered
- Are easy to understand
- Scale as customer grows
- Are hard to game

### Common Value Metrics

| Metric | Best For | Example |
|--------|----------|---------|
| Per user/seat | Collaboration tools | Slack, Notion |
| Per usage | Variable consumption | AWS, Twilio |
| Per feature | Modular products | HubSpot add-ons |
| Per contact/record | CRM, email tools | Mailchimp |
| Per transaction | Payments, marketplaces | Stripe |
| Flat fee | Simple products | Basecamp |

### Choosing Your Value Metric

Ask: "As a customer uses more of [metric], do they get more value?"
- If yes → good value metric
- If no → price doesn't align with value

---

## Tier Structure Overview

### Good-Better-Best Framework

**Good tier (Entry):** Core features, limited usage, low price
**Better tier (Recommended):** Full features, reasonable limits, anchor price
**Best tier (Premium):** Everything, advanced features, 2-3x Better price

### Tier Differentiation

- **Feature gating** - Basic vs. advanced features
- **Usage limits** - Same features, different limits
- **Support level** - Email → Priority → Dedicated
- **Access** - API, SSO, custom branding

**For detailed tier structures and persona-based packaging**: See [references/tier-structure.md](references/tier-structure.md)

---

## Pricing Research

### Van Westendorp Method

Four questions that identify acceptable price range:
1. Too expensive (wouldn't consider)
2. Too cheap (question quality)
3. Expensive but might consider
4. A bargain

Analyze intersections to find optimal pricing zone.

### MaxDiff Analysis

Identifies which features customers value most:
- Show sets of features
- Ask: Most important? Least important?
- Results inform tier packaging

**For detailed research methods**: See [references/research-methods.md](references/research-methods.md)

---

## When to Raise Prices

### Signs It's Time

**Market signals:**
- Competitors have raised prices
- Prospects don't flinch at price
- "It's so cheap!" feedback

**Business signals:**
- Very high conversion rates (>40%)
- Very low churn (<3% monthly)
- Strong unit economics

**Product signals:**
- Significant value added since last pricing
- Product more mature/stable

### Price Increase Strategies

1. **Grandfather existing** - New price for new customers only
2. **Delayed increase** - Announce 3-6 months out
3. **Tied to value** - Raise price but add features
4. **Plan restructure** - Change plans entirely

---

## Pricing Page Best Practices

### Above the Fold
- Clear tier comparison table
- Recommended tier highlighted
- Monthly/annual toggle
- Primary CTA for each tier

### Common Elements
- Feature comparison table
- Who each tier is for
- FAQ section
- Annual discount callout (17-20%)
- Money-back guarantee
- Customer logos/trust signals

### Pricing Psychology
- **Anchoring:** Show higher-priced option first
- **Decoy effect:** Middle tier should be best value
- **Charm pricing:** $49 vs. $50 (for value-focused)
- **Round pricing:** $50 vs. $49 (for premium)

---

## Pricing Page Teardown

When someone wants to audit an existing pricing *page* for **clarity, transparency, and AI-readability** (not the pricing strategy itself, and not conversion-rate optimization - that's `cro`), run a **teardown** that scores it across two axes and returns prioritized fixes:

- **Human buyer experience** - value-prop clarity, plan differentiation, cognitive load, trust signals, pricing psychology, and price transparency.
- **AI-agent readiness** - whether the LLMs and agents that increasingly shortlist and compare tools can actually read and quote your pricing: machine-readable prices (not locked in an image or behind "Contact us"), extractable FAQ/objection coverage, per-tier depth stated in text, and structured data. Buyers now ask ChatGPT/Perplexity/Claude "what's the best X and what does it cost?" *before* visiting - a pricing page an agent can't parse loses deals you never see.

**Fast check - the "paste test":** give the pricing URL to a browsing-capable AI (Perplexity, ChatGPT with search, Claude with web) - or paste the rendered page text - and ask "what are the plans and prices?" A clean miss means agents fetching your page will struggle too (a heuristic, not proof every agent fails).

The AI-readiness fixes are usually high-impact, low-effort (put prices in text, add `Offer` schema). Hand implementation to **schema** (Product/Offer JSON-LD) and **ai-seo** (extractability, AI-bot access, `llms.txt`).

**For the full 10-dimension rubric, scoring, and report template:** See [references/pricing-page-teardown.md](references/pricing-page-teardown.md). *(AI-agent-readiness lens adapted from Kyle Poyar / Growth Unhinged.)*

---

## Pricing Checklist

### Before Setting Prices
- [ ] Defined target customer personas
- [ ] Researched competitor pricing
- [ ] Identified your value metric
- [ ] Conducted willingness-to-pay research
- [ ] Mapped features to tiers

### Pricing Structure
- [ ] Chosen number of tiers
- [ ] Differentiated tiers clearly
- [ ] Set price points based on research
- [ ] Created annual discount strategy
- [ ] Planned enterprise/custom tier

---

## Task-Specific Questions

1. What pricing research have you done?
2. What's your current ARPU and conversion rate?
3. What's your primary value metric?
4. Who are your main pricing personas?
5. Are you self-serve, sales-led, or hybrid?
6. What pricing changes are you considering?

---

## Related Skills

- **coreyhaines-marketing-churn-prevention**: For cancel flows, save offers, and reducing revenue churn
- **coreyhaines-marketing-cro**: For optimizing pricing page conversion
- **coreyhaines-marketing-copywriting**: For pricing page copy
- **coreyhaines-marketing-marketing-psychology**: For pricing psychology principles
- **coreyhaines-marketing-ab-testing**: For testing pricing changes
- **coreyhaines-marketing-revops**: For deal desk processes and pipeline pricing
- **coreyhaines-marketing-sales-enablement**: For proposal templates and pricing presentations
- **coreyhaines-marketing-ai-seo**: For making the pricing page extractable/citable by AI (the teardown's AI-agent-readiness axis)
- **coreyhaines-marketing-schema**: For Product/Offer structured data so machines can read your tiers and prices
