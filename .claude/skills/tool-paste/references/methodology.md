## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/tool-paste/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/tool-paste/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /tool-paste — Clean content for any destination

Cleans terminal output (ANSI, box-drawing, prompt artifacts, etc.) and reformats per destination rules. Reads clipboard by default, writes back to clipboard + previews in chat.

<a id="step-1--get-the-content"></a>
## Step 1 — Get the content

In order:
1. If the user included content in the prompt (pasted, or referenced from earlier in the conversation), use that.
2. Else, read clipboard: `pbpaste`
3. If both empty, ask the user what to paste.

<a id="step-2--parse-destination"></a>
## Step 2 — Parse destination

| Invocation | Destination |
|---|---|
| `/tool-paste` | **plain** (default) |
| `/tool-paste plain` | plain |
| `/tool-paste slack` | slack |
| `/tool-paste notion` | notion |
| `/tool-paste twitter` or `/tool-paste x` | twitter |
| `/tool-paste linkedin` or `/tool-paste li` | linkedin |
| `/tool-paste email` | email (plain) |
| `/tool-paste email rich` or `/tool-paste email html` | email (rich/HTML) |
| `/tool-paste github` or `/tool-paste gh` | github |
| `/tool-paste markdown` or `/tool-paste md` | markdown render |
| `/tool-paste html` | render to HTML file + open in browser |

If ambiguous, ask. Per-destination rules live in `destinations.md`.

<a id="step-3--scan-for-secrets"></a>
## Step 3 — Scan for secrets

Before any cleaning or copying, scan against patterns in `secret-patterns.md`.

If any match:
1. **Stop.** Don't copy yet.
2. Report what was detected with the value **masked** (first 4 + last 4 chars only — e.g. `sk-12...wxyz`).
3. Ask: *"Spotted [type] in the content. Continue, redact (replace with `[REDACTED]`), or abort?"*
4. Default to **abort** if no clear answer.

<a id="step-4--universal-cleaning"></a>
## Step 4 — Universal cleaning

Strip from the content:

- **ANSI escape codes** — `\x1b\[[0-9;]*[a-zA-Z]` and related (color codes, cursor movement, screen control)
- **Box-drawing chars** — `╭ ─ ╮ │ ╰ ╯ ╞ ╡ ╤ ╧ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ━ ┃ ┏ ┓ ┗ ┛` etc. Replace with simpler equivalents (`-`, `|`) or remove entirely depending on context.
- **Terminal prompt artifacts** — leading `$ `, `> `, `❯ `, `% `, `# ` (when first non-whitespace on a line that looks like a shell prompt)
- **Carriage returns** (`\r`) — replace with `\n` or delete
- **Trailing whitespace** per line
- **Excess blank lines** — collapse 3+ consecutive blank lines to 2

<a id="step-5--apply-destination-rules"></a>
## Step 5 — Apply destination rules

Read `destinations.md` and apply the relevant transform.

<a id="step-6--output"></a>
## Step 6 — Output

| Destination | Output behavior |
|---|---|
| plain / slack / notion / twitter / linkedin / email / github | (a) Show preview in a code fence in chat. (b) Copy clean version to clipboard via `pbcopy`. |
| email rich | Render to HTML, write to `/tmp/paste-<timestamp>.html`, `open` it in browser. Skip clipboard (the user copies from browser to preserve rich text). |
| markdown | Render the cleaned markdown directly in chat (Claude Code renders it). Also copy raw markdown to clipboard. Offer: *"Open as HTML too?"* — if yes, write and open. |
| html | Render to HTML, write to `/tmp/paste-<timestamp>.html`, `open` it. Skip clipboard. |

After output, report a one-line summary of what was cleaned (e.g., *"Stripped 12 ANSI codes, 4 box-drawing chars, 1 prompt artifact. Character count: 248 / 280 (X)."*).

<a id="length-warnings"></a>
## Length warnings

Twitter and LinkedIn have practical limits. the user said "let me trim" — don't refuse or auto-truncate.

- **Twitter/X**: warn if >280 chars. Note the overage.
- **LinkedIn**: warn if >400 chars (comfort line, not hard limit).
- Other destinations: no length warning.

<a id="url-handling-for-social-destinations"></a>
## URL handling for social destinations

If the content has URLs and destination is **twitter** or **linkedin**:
- Surface the URLs separately (don't include them in the body)
- Remind the user: links go in a first comment (LinkedIn) or reply (X), not the body
- See `mkt-jab-hook` and `context/knowledge/personal/notes/feedback_social_link_placement.md`

<a id="examples"></a>
## Examples

```
/tool-paste slack
```
→ Reads clipboard, strips ANSI, converts `**bold**` to `*bold*`, copies to clipboard, shows preview.

```
/tool-paste twitter
[pasted error log]
```
→ Uses pasted content (ignores clipboard), strips everything, warns at 412/280 chars, copies, asks if the user wants to trim or pick a different destination.

```
/tool-paste html
[pasted markdown table]
```
→ Renders table as HTML, opens in browser. the user selects + copies into Notion/email with formatting preserved.

```
/tool-paste
[pasted output with sk-anthropic-key in it]
```
→ Stops. *"Spotted what looks like an Anthropic API key: `sk-an...3kf9`. Continue, redact, or abort?"*

<a id="composes-with"></a>
## Composes with

- `mkt-jab-hook` — clean output for pasting into Typefully drafts when the MCP path doesn't fit; also enforces the link-placement rule for X/LinkedIn destinations
- `tool-social-fetch` — clean a fetched post before quoting it in a draft or newsletter
- `tool-watch-video` — transcript / summary output often flows through `tool-paste` for platform-specific reformatting

<a id="notes-on-quality"></a>
## Notes on quality

- **Secret detection runs first, always.** Before any formatting or destination logic, `tool-paste` scans for `sk-*`, `AKIA*`, `xoxb-*`, JWT-shaped strings, and long-hex tokens. Prompts before proceeding on any hit. Better to false-positive occasionally than to leak a real key.
- **Destination-aware transforms, not one-size-fits-all.** Slack wants `*bold*`; LinkedIn wants unicode-styled bold; email wants HTML. Same input, 9 different valid outputs. The destination flag is not optional.
- **ANSI codes get stripped for every destination.** Terminal escapes (`\033[31m` etc.) render as garbage everywhere except the source terminal.
- **Character limits are enforced, not warnings.** X at 280, LinkedIn at 3000, Twitter at 25000 — paste refuses to copy over-limit output and offers a trim strategy.
- **Links go in first comments for social destinations** — not the body. Enforced when destination is `twitter` or `linkedin`. Documented in `context/knowledge/personal/notes/feedback_social_link_placement.md`.
- **HTML destination opens in a browser tab, not the clipboard.** Formatted tables + code blocks need a rendered surface to select-and-copy from with formatting preserved. Copying raw HTML to the clipboard produces garbage in Notion/email.
