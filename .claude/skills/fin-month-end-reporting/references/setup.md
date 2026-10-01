# First-run setup — Month-End Reporting

Setup maps the user's spreadsheet onto the roles this skill needs. The golden rule: **inspect first, then confirm** — read their sheet and propose a mapping so the user corrects rather than dictates cell addresses from memory (they usually can't). Never carry assumptions from one user's sheet to another's: every tab name, column, cell, and formula in the config must come from *this user's* sheet or *this user's* answers.

## 1. Where do the finances live?

Ask the user where their transactions and monthly reports are tracked — typically a Google Sheet, sometimes an Excel file, occasionally somewhere else. Get the file's name or URL/ID.

## 2. Getting connected

Verify a tool that can read and write that file is available in this session. If not, help the user connect one rather than stopping at "it's missing":

- **Claude connectors**: search the connector directory for the relevant app (Google Drive/Sheets, Microsoft 365…) and suggest it — the user approves and authenticates in a couple of clicks. Simplest path when a native connector exists.
- **Composio**: if there's no native connector, Composio usually covers it. Explain it plainly: *Composio is a third-party service that acts as a bridge to hundreds of apps (Google Sheets, accounting tools, email, and more) through a single connection — you connect Composio once, then authorize the individual apps you want inside it.*
- After connecting, verify with a harmless read (list the spreadsheet's tabs) before proceeding. Record in the config which tool family reached the file.

## 3. Inspect and propose a mapping

List the tabs, then read the header rows and a small sample of each candidate tab. You're looking for four roles — the last two are optional, and a user whose sheet lacks them still gets value from the first two:

**a. Raw transactions tab** — one row per bank transaction. Identify with the user: the header row; the key column that defines the last data row (usually a transaction ID or date); the date, merchant, and amount columns; and the **helper columns** — columns whose formulas derive values like year, month, or category from the data columns. For each helper column, capture a formula template with a `{r}` placeholder for the row number. **Lift templates from an existing filled row of their sheet** rather than inventing them — the user's own formulas encode conventions you can't guess. If the sheet has no helper columns yet, design them together (e.g. what lookup ranges map merchants to categories) and note the "unattributed" fallback value the category formula returns for unknown merchants.

**b. Merchant lookup tab** — the table mapping merchant names to the user's reporting categories. Identify: the merchant column, the user-assigned category column (left blank on append), and any extra columns worth filling on append (the bank's own category, total value spent) because they make classification faster for the user.

**c. Monthly report tabs (optional)** — one per finalized month (a P&L or similar). Identify: the **tab naming pattern**; the seed cells to set on a fresh copy (month/year identifiers, opening balance) and the previous tab's closing-balance cell the opening balance should reference; the key verification cells (total income, total expenses, net, closing balance); and the row ranges of income and expense categories (label + value columns) for the month-over-month comparison. If no monthly tabs exist yet, record this role as absent and note the limitation to the user.

**d. Outlook tab (optional)** — a one-column-per-month running summary. Identify: which rows hold the year/month headers and each summary figure, and formula templates for a new column using `{X}` for the new column letter and `{P}` for the previous one. **Lift these from the existing last column** where possible. Also capture the number formats and styling to copy onto the new column. If there's no such tab, record it as absent (or offer to design one together).

Present the proposed mapping back in plain language ("Your transactions live on the *Transactions* tab, dates in column D, merchants in column G…") and let them correct it before anything is saved.

## 4. Preferences

- **Timezone** (for determining "the month that just ended").
- **Currency / number format** if not obvious from the sheet.
- **Notification** — where scheduled-run summaries go (push, email, both).

## 5. Write the config

Save as `config.json` in this skill's directory; if not writable, `~/.claude/fin-month-end-reporting.config.json`. Every concrete value below is a placeholder to be filled from *this user's* sheet — the structure is a guide, not a straitjacket; add or drop fields to match what the inspection found:

```json
{
  "spreadsheet": { "id": "<id>", "tool": "<connector/tool family>" },
  "timezone": "<IANA timezone>",
  "raw_tab": {
    "name": "<tab name>",
    "header_row": "<n>",
    "key_column": "<column>",
    "columns": { "date": "<col>", "merchant": "<col>", "amount": "<col>", "bank_category": "<col>" },
    "helper_columns": { "<col>": "<formula template with {r}>" },
    "category_column": "<col>",
    "unattributed_value": "<their fallback value>"
  },
  "lookup_tab": {
    "name": "<tab name>",
    "merchant_column": "<col>",
    "category_column": "<col>",
    "extra_on_append": { "<col>": "<what to fill>" }
  },
  "monthly_report": {
    "tab_pattern": "<their naming pattern>",
    "seed_cells": { "<role>": "<cell>" },
    "prev_closing_cell": "<cell>",
    "verify_cells": { "total_income": "<cell>", "total_expenses": "<cell>", "net": "<cell>", "closing_balance": "<cell>" },
    "income_rows": "<range>", "expense_rows": "<range>",
    "labels_column": "<col>", "values_column": "<col>"
  },
  "outlook": {
    "name": "<tab name>",
    "year_row": "<n>", "month_row": "<n>",
    "row_formulas": { "<row>": "<template with {X}/{P}>" },
    "formats": { "<row>": "<number format + styling captured from the sheet>" }
  },
  "notification": ["push", "email"]
}
```

Set `"monthly_report": null` or `"outlook": null` for roles the user's sheet doesn't have.

## 6. Confirm with a read-only dry run

Before finishing, walk the mapped sheet **without writing anything**: report how many raw rows have blank helper cells, which merchants would be appended as new, what the new month's tab would be called, and which outlook column would be written. When the user confirms it matches reality, setup is complete.

## 7. Offer the schedule

Ask if they'd like this to run automatically and on what cadence — early on the 1st of the month is the natural slot for a month-end close, but it's their call (some prefer a few days in, once all transactions have settled). Create the scheduled task per the "Turning it into a scheduled task" section of SKILL.md, and confirm the schedule back in the user's timezone.
