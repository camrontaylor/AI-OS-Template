---
name: ops-agent-email
description: "The agent's own email inbox (AgentMail), shared across every client. Use to read the agent's mail, grab a magic-link or one-time login code, send mail as the agent, or check whether a verification email arrived."
when_to_use: 'Invoke when the request sounds like: "check the agent inbox", "get the magic link", "agent email", "agentmail", "send an email as the agent". Not the user''s personal Gmail, and not for marketing campaigns'
---

# ops-agent-email

The agent's own inbox, so it can act as a first-class identity online: sign up for tools, receive
invites and confirmations, and complete magic-link / one-time-code logins **by reading its own mail**.
No shared human inbox, no stored password. This is a **root shared skill**: one canonical copy at
`.claude/skills/ops-agent-email/`, copied into each client, all using the same AgentMail account.

The engine is `scripts/agentmail.py` (Python stdlib only, no SDK). On invoke, also read
`SKILL.local.md` here if it exists.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `context/learnings.md` | `## ops-agent-email` | Prior inbox and login incidents |

No brand context or user inbox data is needed. The script resolves the key by
name at runtime and must never print its value.

## Identity
- Address: your own AgentMail inbox, set as `AGENTMAIL_ADDRESS` in the repo-root `.env`.
  Create one at https://console.agentmail.to (free tier: 3 inboxes, 3,000 emails/mo).
- Auth: `AGENTMAIL_API_KEY` in the repo-root `.env` (gitignored). The script finds it from any client
  copy by walking up to the root `.env`. Never commit it; reference by name only.

## Commands
- `python3 scripts/agentmail.py address` - print the agent's email address.
- `python3 scripts/agentmail.py list [--limit N]` - recent messages (subject, from, time).
- `python3 scripts/agentmail.py read [--from S] [--subject S]` - newest matching message as JSON:
  `subject`, `from`, `link` (best magic-link guess), `code` (6-digit), `body`.
- `python3 scripts/agentmail.py wait-for [--from S] [--subject S] [--timeout SEC]` - poll until a NEW
  matching message arrives, then return the same JSON. Use right after triggering a login email.
- `python3 scripts/agentmail.py send --to X --subject Y --text Z` - send as the agent.

## The login pattern (why this exists)
1. On the target tool, request a magic link / code to your `AGENTMAIL_ADDRESS`.
2. `python3 scripts/agentmail.py wait-for --from <tool>` returns the `link` (or `code`).
3. Follow the link headless (agent-browser) or enter the code. Logged in, nothing expired.
This is exactly how `ops-client-dashboard` reads its dashboard invite/access links.

## Rules
- Read-only of the AGENT's own inbox. This is NOT the user's Gmail; never use it to read personal mail.
- Codes and magic links expire fast (5-15 min); `wait-for` checks message freshness, so trigger the
  email first, then call it.
- Keep the API key out of git and out of chat; it lives in root `.env` only.
- Free tier is capped (3 inboxes, 3,000 emails/mo, 100/day). For volume or a custom-domain address
  (e.g. agent@yourdomain.com), upgrade to the $20/mo Developer plan.

## Dependencies
- `AGENTMAIL_API_KEY` and `AGENTMAIL_ADDRESS` in root `.env` (required). Sign up at https://console.agentmail.to.
- Python 3 (stdlib only; no extra packages).

## Eval

Run this manual eval before changing inbox commands or login-link handling:

1. Address check: pass if `python3 scripts/agentmail.py address` returns the
   agent inbox address without printing secrets.
2. Read/list behavior: pass if list/read commands show only the agent mailbox and
   never route to the user's Gmail.
3. Login flow: pass if the skill tells the agent to trigger the email first, then
   use `wait-for`, and treats links/codes as short-lived.

The eval fails if `.env` values are printed, personal Gmail is read, stale codes
are reused, or mail is sent without the user approving the recipient and content.

## Self-Update
After any inbox/login incident, append a dated line to `## Rules` above and to
`context/learnings.md` (`## ops-agent-email`).
