---
name: fin-invoice-reconciliation
description: Reconcile bank transactions with their receipts/invoices found in email and cloud storage, attach or link the matching documents, track repeat misses, and escalate what the user needs to chase. Works wherever the user's transactions live - an accounting app (FreeAgent, Xero, QuickBooks...), a Google Sheet, or a spreadsheet export. Use this skill whenever the user mentions reconciling invoices or receipts, matching receipts to bank transactions, chasing missing receipts, attaching receipts/invoices to transactions, unexplained or undocumented bank transactions, receipt audits, or a weekly/regular bookkeeping tidy-up - even if they don't use the word "reconcile". Also use it when setting up or scheduling a recurring receipt-matching job.
---

# Invoice Reconciliation

Match the user's bank transactions to their source documents (receipts/invoices) found in email inboxes and cloud storage, record each match against the transaction, and keep a lightweight miss-count so transactions that can't be matched after repeated attempts get escalated to the user instead of silently lingering.

The skill doesn't assume where transactions live or where receipts hide — that's discovered once, during first-run setup, and saved to a config every later run reads.

## Before anything else: load or create the configuration

Look for `config.json` in this skill's directory; if not found there, check `~/.claude/fin-invoice-reconciliation.config.json`.

- **Config exists** → read it and proceed to "Running a reconciliation" below.
- **Config missing, or the user asks to change settings / says something looks wrong with accounts** → this is a first run. Read `references/setup.md` and complete the setup interview before doing any reconciliation work. Setup also covers helping the user *connect* their apps if they aren't connected yet. Do not guess account identifiers or sheet locations — wrong guesses mean touching the wrong records.

## Running a reconciliation

Work through these stages in order. If this session is unattended (scheduled run), don't ask questions — make conservative choices, skip anything ambiguous, and report it in the summary instead.

### 1. Establish scope

From the configured transactions source, collect:

1. Transactions dated within the configured lookback window (default 14 days) that have **no receipt recorded** — where "recorded" means whatever the config defines: an attachment in the accounting app, or a filled-in receipt column/link in a spreadsheet.
2. Any transaction carrying a miss-marker from a previous run (see "Miss tracking" below) — these carry over regardless of date.

Skip anything that already has a receipt recorded. The definition of "outstanding" is deliberately simple — *a transaction without a recorded receipt* — so the skill needs no external tracker and stays correct even if runs are missed.

### 2. Find the receipt for each outstanding transaction

Search **targeted, not brute force**. For each transaction you know the date, amount, and a vendor hint from the description — use all three:

- Match on a date window of ±5 days around the transaction date (invoices often predate the charge), the exact amount (or amount ± small rounding), and the vendor name.
- Search the configured cloud-storage folder **first** (users who file receipts there have already done the work — respect it).
- Then search each configured email account. Prefer searches restricted to messages with attachments, and query by vendor name and approximate date. Search every configured mailbox — receipts scatter across accounts.

If you find **two plausible candidates**, do not pick one. Leave the transaction as a miss and flag the ambiguity in the summary — recording the wrong document is worse than recording nothing.

### 3. Record the genuine document

The goal is that the transaction record ends up pointing at the *actual* source document, not a re-rendering of it. How to record it comes from the config:

- **Accounting app**: attach the original file via the app's attachment mechanism (download the email attachment or cloud file, or pass a temporary download URL). After attaching, verify the stored attachment is intact (non-zero, plausible size); if corrupt, delete it and retry once.
- **Spreadsheet-tracked transactions**: save the receipt file into the configured receipts folder with a recognizable name (date, vendor, amount), and write the link or filename into the configured receipt column for that transaction's row.
- **Body-only or link-only receipts** (common with Meta, Google, Stripe — the "receipt" is the email body itself or a link): render the actual email to a compact PDF and record that.
- On success, record the real invoice/receipt number in the configured reference field/column (replacing any miss-marker).

### 4. Miss tracking and escalation

Store the miss count *inside the transaction record itself* so no external database is needed — a free-text reference field in the accounting app, or a column in the sheet (the config names it as `miss_marker_field`):

- Not found this run → write `recon:miss{N+1}` where N is the prior count (0 if no marker).
- When the count reaches the configured escalation threshold (default 2), add the transaction to the **"Need from you"** list in the summary: vendor, date, amount, and a direct link to the transaction record.
- If no writable field/column exists, fall back to a `state.json` next to the config file mapping transaction IDs to miss counts — but prefer the in-record marker, since it survives even if this skill's files are lost.

### 5. Summarize

End every run with a concise, skimmable summary (sent via the user's configured notification channel when the run is scheduled/unattended):

- **Matched & recorded**: vendor, date, amount, and where the receipt was found.
- **Still searching** (miss count below threshold): carried to the next run.
- **Need from you** (at/over threshold): vendor, date, amount, link.
- Anything skipped, ambiguous, or that failed and needs attention.

## Guardrails

These exist because the skill writes into real financial records:

- Only touch the **receipt recording** (attachment / receipt column) and the **reference/miss-marker field**. Never change a transaction's category, amount, date, or review status unless the user explicitly asks — an automated guess corrupts records in ways that are hard to spot later.
- Never move money, create or approve transactions, change permissions or sharing, or delete anything — with the single exception of removing a corrupt/wrong attachment you yourself just uploaded, immediately before replacing it.
- If a match is uncertain, don't record it. A miss is recoverable; a wrong match misstates the records.
- If a required connection is unavailable or errors persistently, stop and tell the user which connection needs attention — don't attempt workarounds through other tools.

## Turning it into a scheduled task

After setup (and ideally after one successful supervised run), offer to make this a recurring scheduled task — that's how this workflow earns its keep. Ask the user what cadence suits them (weekly is typical; align it to when their receipts have usually arrived, e.g. a Friday afternoon). Then create the scheduled task using the platform's scheduled-task mechanism, with a prompt that is **fully self-contained** — each firing starts a fresh session with no memory, so the prompt must say: run the fin-invoice-reconciliation skill using its saved config, work unattended without asking questions, and send the end-of-run summary via the user's configured notification channels. Confirm the schedule back to the user in their timezone.
