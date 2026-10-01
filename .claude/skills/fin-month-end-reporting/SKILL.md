---
name: fin-month-end-reporting
description: Run a month-end financial close on the user's finance spreadsheet - complete categorization formulas on the raw transactions tab, add newly-seen merchants to the lookup table, roll the monthly P&L forward, extend the monthly outlook/summary, verify the figures, and produce an insights summary with month-over-month movers. Use this skill whenever the user mentions month-end reporting or close, finalizing a month, monthly P&L, updating their finances spreadsheet for the month, monthly financial summary or outlook, or setting up/scheduling a recurring monthly finance job - even if they just say "do my monthly numbers" or "close out last month".
---

# Month-End Financial Reporting

Finalize a calendar month on the user's finance spreadsheet: complete the raw-transaction categorization, capture new merchants for the user to classify, roll the monthly report forward, extend the running outlook, verify nothing broke, and end with an insights summary the user can read in one minute.

Every finance sheet is laid out differently — different tab names, columns, formulas, and conventions. So this skill runs entirely off a per-user mapping built during first-run setup, never off assumed tab names, cell addresses, or formulas. The *process* is what's shared; the specifics are the user's.

## Before anything else: load or create the configuration

Look for `config.json` in this skill's directory; if not found there, check `~/.claude/fin-month-end-reporting.config.json`.

- **Config exists** → read it and proceed to "Running the month-end close".
- **Config missing, the user's sheet has changed structurally, or the user asks to reconfigure** → read `references/setup.md` and complete the setup interview. It asks where the user's transactions and reports live, helps them connect the relevant app (Google Sheets, Excel, etc.) if it isn't connected yet, inspects their spreadsheet, and maps its structure with them. Never run the close against an unmapped sheet — writing formulas into wrong columns silently corrupts a finance sheet.

## Running the month-end close

Use the spreadsheet tools recorded in the config. Batch reads and writes — spreadsheet APIs rate-limit (Google Sheets allows roughly 60 reads + 60 writes/minute). If the connection is unavailable, stop and tell the user to reconnect it — do not attempt browser or other workarounds.

If this session is unattended (scheduled run), don't ask questions: make sensible decisions, skip anything genuinely unsafe or ambiguous, and report what needs the user's input in the summary.

Some steps may not apply to a given user — the config marks unused parts as absent; skip those steps without fuss.

### 0. Determine the target month

The **finalized month** is the calendar month that just ended (the month before today, in the user's configured timezone). Derive the current and previous months' tab names from the configured naming pattern.

### 1. Complete helper formulas on the raw transactions tab

The raw tab has data columns (date, merchant, amount, …) and **helper columns** whose formulas derive things like year, month, and category — the config maps each helper column to a formula template captured from the user's own sheet during setup. Find the last data row using the configured key column. For every data row where a helper cell is **blank**, fill just that cell with the configured template (substituting the row number).

Fill only blanks — a non-blank cell may be the user's manual override, and overwriting it destroys a correction they made deliberately.

### 2. Capture new merchants into the lookup table

Read the raw tab's merchant column alongside its computed category column (formatted values). Collect the **distinct** merchants whose category resolved to the configured "unattributed" value and that are not already present in the lookup tab's merchant column. Append each as one row at the bottom of the lookup table, filling the configured columns: the merchant name; the user-assigned category column stays blank — classifying is the user's judgment call; plus any configured extra columns (such as the bank's own category or total value spent) that help the user classify quickly. Keep this list for the final summary.

### 3. Roll the monthly report forward

- If the finalized month's tab already exists, skip creation (note it) and continue.
- Otherwise **duplicate the previous month's tab**, rename the copy per the naming pattern, and position it next to the previous month's tab. Duplication (rather than building from scratch) preserves every formula, format, and layout tweak the user has made.
- Set only the configured "seed" cells — typically the cells identifying the month/year and an opening-balance cell referencing the previous month's closing balance. Everything else recalculates from those.
- If the previous month's tab doesn't exist, do **not** fabricate one — skip this step and report it.

### 4. Extend the outlook/summary tab (if configured)

If the config defines an outlook tab (a running one-column-per-month summary), find the last used month column and write the next one: month/year headers plus the configured formula templates (typically opening balance from the prior column, income/expense aggregations over the raw tab, net and closing figures, percent change). Then copy the previous column's number formats and styling onto the new column so the sheet stays visually consistent. Skip if the month's column already exists.

### 5. Verify

Re-read the configured key cells on the new report tab (e.g. total income, total expenses, net, closing balance) and the new outlook column. Confirm: no `#REF!`/`#N/A`/`#ERROR!`; balances chain from the previous month; figures have the expected signs and are non-zero for a normal trading month. Read totals **by cell reference from the config, not by label** — sheets often repeat labels. Flag anything that looks wrong rather than papering over it.

### 6. Insights & final summary

Compare the finalized month's category figures against the previous month's, using the configured category row ranges. Produce a skimmable summary — this becomes the user's notification on scheduled runs:

- **Headline**: month, total income, total expenses, net, closing balance.
- **Biggest month-over-month movers**: top ~5 categories up and any notable drops, with amounts, on both income and expense sides.
- **New merchants added** this run (from step 2), with any captured context, and a nudge to assign each a category in the lookup tab.
- One line on anything skipped, anomalous, or needing the user's attention.

## Safeguards

The spreadsheet is the user's single source of financial truth, so:

- Fill only **blank** cells in step 1; never overwrite existing content anywhere.
- Never delete tabs, rows, or data; never change sharing or permissions.
- Write only to the tabs/ranges named in the config (raw tab helper columns, lookup tab appends, the new month tab's seed cells, the new outlook column). Everything else is read-only.
- If a required tab is missing, the connection is down, or figures look corrupted, stop and report clearly what happened and what the user should do — never guess or invent numbers.

## Turning it into a scheduled task

After setup (and ideally one successful supervised run), offer to make this a recurring scheduled task — a month-end close that runs itself is the whole point. Ask what cadence and timing suits them (early on the 1st of each month is the natural slot, but let them choose). Then create the scheduled task using the platform's scheduled-task mechanism, with a prompt that is **fully self-contained** — each firing starts a fresh session with no memory, so the prompt must say: run the fin-month-end-reporting skill using its saved config, work unattended without asking questions, and send the final insights summary via the user's configured notification channels. Confirm the schedule back to the user in their timezone.
