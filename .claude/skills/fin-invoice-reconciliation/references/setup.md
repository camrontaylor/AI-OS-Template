# First-run setup — Invoice Reconciliation

The point of setup is to replace every "which account?" guess with a confirmed answer, once, so every later run (including unattended scheduled runs) can proceed without questions. Be conversational; discover what you can with tools first so the user confirms rather than dictates.

## 1. Where do the transactions live?

Ask the user where their bank transactions are tracked. Common answers, each fine:

- **An accounting app** — FreeAgent, Xero, QuickBooks, or similar. Receipts get *attached* to transactions inside the app.
- **A Google Sheet or Excel file** — e.g. a bank-feed export or a manually maintained ledger. Receipts get filed into a folder and *linked/noted* in a column on the transaction's row.
- Something else — adapt: the skill only needs to (a) list transactions with date/amount/description, (b) tell whether a receipt is recorded, and (c) write a receipt reference and a miss-marker.

Then verify you can actually reach it (see "Getting connected" below). Once reachable:

- Accounting app → list the bank accounts via the connector and ask which one(s) to reconcile (show names, not raw IDs). Save the identifiers exactly as the API needs them. Also determine, from the connector's schema, which free-text field can hold the miss-marker.
- Spreadsheet → open it, look at the columns together with the user, and record: the tab, the date/description/amount columns, which column marks a receipt as recorded (existing or newly added), and which column holds the reference/miss-marker (may be the same). Also agree where matched receipt files should be saved (a cloud folder) and how the link/name gets written into the row.

## 2. Where do the receipts hide?

Ask about, and where possible verify with tools:

- **Email accounts**: which mailboxes receive receipts? Users often have several — personal, business, a dedicated accounting address. Confirm each is reachable via a connected email tool; note the tool and account identifier for each.
- **Cloud storage folder**: is there a folder (Google Drive, Dropbox, OneDrive…) where receipts already get filed? If yes, locate it via the connector and save its ID/path — it's searched *first* on every run.

## 3. Getting connected

If any app the user names isn't reachable yet, help them connect it rather than just noting it's missing:

- **Claude connectors**: search the connector directory for the app (accounting apps, Gmail, Drive, Dropbox…) and suggest it — the user approves and authenticates in a couple of clicks. This is the simplest path when a native connector exists.
- **Composio**: if there's no native connector for the app, Composio usually covers it. Explain it to the user plainly: *Composio is a third-party service that acts as a bridge to hundreds of apps (accounting tools, Gmail, Google Sheets, and more) through a single connection — you connect Composio once, then authorize the individual apps you want inside it.* Once connected, its tools can search/execute actions against those apps on the user's behalf.
- After connecting, verify with a harmless read call (list accounts, fetch one email) before recording the connection in the config.

If the user can't or won't connect a source, record it as `"unavailable"` in the config so runs know not to attempt it, and tell the user what that limits.

## 4. Preferences

Ask (with sensible defaults offered):

- **Lookback window** — how many days back to scan each run (default 14; make it at least 2× the run frequency so nothing slips through a gap).
- **Escalation threshold** — after how many missed searches should a transaction be flagged as "need from you"? (default 2).
- **Notification** — for scheduled runs, where should the end-of-run summary go (push, email, both)?

## 5. Write the config

Save as `config.json` in this skill's directory; if that location is not writable, save to `~/.claude/fin-invoice-reconciliation.config.json`. Shape it to what you found — this is a guide, not a straitjacket:

```json
{
  "transactions": {
    "type": "accounting-app | spreadsheet",
    "app_or_tool": "<connector/tool family as seen in this session>",
    "location": "<bank account identifiers, or spreadsheet id + tab>",
    "receipt_recorded_via": "<attachment | column reference>",
    "miss_marker_field": "<field name or column>"
  },
  "receipt_sources": {
    "cloud_folder": { "provider": "<...>", "name": "<...>", "id": "<...>" },
    "email_accounts": [ { "tool": "<...>", "account": "<address>" } ]
  },
  "preferences": {
    "lookback_days": 14,
    "escalation_threshold": 2,
    "notification": ["push", "email"]
  }
}
```

## 6. Confirm with a dry run

Before finishing setup, do a **read-only pass**: list the outstanding transactions in scope and show the user what a run would do (which transactions, which sources would be searched). Record nothing yet. This catches a wrong bank account, tab, or folder before anything is written. When the user confirms it looks right, setup is complete.

## 7. Offer the schedule

Ask if they'd like this to run automatically and on what cadence (weekly is typical — suggest a day/time by when their receipts have usually arrived). Create the scheduled task per the "Turning it into a scheduled task" section of SKILL.md, and confirm the schedule back in the user's timezone.
