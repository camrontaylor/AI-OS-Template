> Runtime scope: the adjacent SKILL.md governs this reference. Team-connected runs use only the authoritative snapshot; local context/config/knowledge examples apply only to Solo mode. Generated files use the dated project directory and dated filenames. User task authorization controls external writes.

# Adapters

How `ops-project-management` reads from / writes to each PM tool. Add new adapters here as needed.

Each business board has a `tool` value in `boards.md` that selects one of these adapters.

---

## notion

**Auth:** `$NOTION_API_KEY` (in `the workspace secret environment`). Use an available connector or current official API docs; do not assume a separate memory file exists.

**Pattern:** Each business board is a Notion database with these properties:
- `Name` (title)
- `Status` (select: Backlog / Ready / In Progress / Review/Blocked / Done) — defaults; override in `boards.md`
- `Priority` (select: Q1 / Q2 / Q3 / Q4) — Eisenhower quadrant
- `Owner` (people or text)
- `Size` (select: XS / S / M / L)

**Operations:**

Authenticated request shape (not a shell command):
- Method: `POST`.
- Endpoint: `https://api.notion.com/v1/databases/<db-id>/query`.
- Endpoint: `https://api.notion.com/v1/pages/<page-id>`.
- Endpoint: `https://api.notion.com/v1/pages`.
- Header names: `Authorization`, `Content-Type`, `Notion-Version`.
- Body shape: `{"filter":{"property":"Status","select":{"equals":"In Progress"}}}`.
- Body shape: `{"properties":{"Status":{"select":{"name":"Ready"}}}}`.
- Body shape: `{"parent":{"database_id":"<db-id>"},"properties":{"Name":{"title":[{"text":{"content":"<title>"}}]},"Status":{"select":{"name":"Backlog"}}}}`.
- Read `NOTION_API_KEY` from the workspace environment inside an authenticated connector or in-process HTTP client. Assemble any provider-required auth/query parameter there; do not render or log its value.
- Use Node 22 with `--env-file-if-exists` for root and active-client `.env` (client last); never expose credentials through shell arguments or generated artifacts.

---

## github

**Auth:** `gh` CLI (check authentication first). Works for both GitHub Issues and GitHub Projects (v2).

**Pattern A — Issues on a single repo:**

The "board" is the repo's issues filtered by label (e.g., `column:ready`, `column:in-progress`). Or by Project (v2) status field.

```bash
# List issues in a column (label-based)
gh issue list --repo <owner>/<repo> --label "column:ready" --json number,title,labels

# Move (change label)
gh issue edit <num> --repo <owner>/<repo> --remove-label "column:ready" --add-label "column:in-progress"

# Create
gh issue create --repo <owner>/<repo> --title "<title>" --label "column:backlog"
```

**Pattern B — GitHub Projects (v2):**

```bash
# List items in a column (Status field)
gh project item-list <project-number> --owner <owner> --format json

# Move item (set Status field)
gh project item-edit --id <item-id> --field-id <status-field-id> --single-select-option-id <option-id> --project-id <project-id>
```

For Projects v2, the skill needs to discover field IDs once via `gh project field-list` and cache them in `boards.md`.

---

## plane

**Auth:** Plane API key (set as `$PLANE_API_KEY` in `the workspace secret environment` if not yet — prompt the user if missing). Workspace slug from `boards.md`.

**Pattern:** Plane has Projects → Modules/Cycles → Issues. The "board" maps to a Plane Project; columns map to Plane "State" values.

Authenticated request shape (not a shell command):
- Method: `GET`.
- Endpoint: `https://api.plane.so/api/v1/workspaces/<workspace>/projects/<project-id>/issues/?state__name=Ready`.
- Endpoint: `https://api.plane.so/api/v1/workspaces/<workspace>/projects/<project-id>/issues/<issue-id>/`.
- Header names: `Content-Type`, `X-API-Key`.
- Body shape: `{"state": "<state-id-for-In Progress>"}`.
- Read `PLANE_API_KEY` from the workspace environment inside an authenticated connector or in-process HTTP client. Assemble any provider-required auth/query parameter there; do not render or log its value.
- Use Node 22 with `--env-file-if-exists` for root and active-client `.env` (client last); never expose credentials through shell arguments or generated artifacts.

Note: Plane uses state IDs, not names — discover and cache once per workspace.

---

## linear

**Auth:** Linear MCP if installed, else `$LINEAR_API_KEY`. Prefer MCP when available.

**Pattern:** Each Linear Team or Project maps to a board. Columns map to workflow states.

If using the Linear MCP, the skill calls those tools directly. If using the API:

Authenticated request shape (not a shell command):
- Method: `POST`.
- Endpoint: `https://api.linear.app/graphql`.
- Header names: `Authorization`, `Content-Type`.
- Body shape: `{"query":"{ issues(filter: {team: {key: {eq: \"<team-key>\"}}, state: {name: {eq: \"In Progress\"}}}) { nodes { id title } } }"}`.
- Read `LINEAR_API_KEY` from the workspace environment inside an authenticated connector or in-process HTTP client. Assemble any provider-required auth/query parameter there; do not render or log its value.
- Use Node 22 with `--env-file-if-exists` for root and active-client `.env` (client last); never expose credentials through shell arguments or generated artifacts.

---

## obsidian

**Auth:** none — local files.

**Pattern:** Obsidian Kanban plugin stores boards as markdown files with `## Column Name` headings. Each card is a `- [ ] Card title` bullet under its column.

```
## Backlog
- [ ] Card A
- [ ] Card B

## Ready
- [ ] Card C

## In Progress
- [ ] Card D

## Review/Blocked
- [ ] Card E — blocked on <person>

## Done/Archived
- [x] Card F
```

**Operations:**
- **Read**: `Read` the markdown file at the path in `boards.md`
- **Move**: edit the file — remove card from old column, add under new column
- **Create**: append a bullet under the right column
- **Done**: change `[ ]` to `[x]` and move to Done section

Watch out: Obsidian Kanban supports embedded YAML metadata blocks per card (priority, due, assignee). Preserve them when moving cards.

---

## manual

**Auth:** none.

When no tool is connected (or the user doesn't want one for a particular business), `ops-project-management` works in conversation:

1. Ask the user to paste the current board state (or describe verbally)
2. Run the requested mode against that snapshot
3. Output recommended moves as plain text
4. Optionally: persist a snapshot to `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/boards-cache/<business>.md` so subsequent runs don't require re-pasting (with a clear warning that the cache is stale until next paste) — never inside the skill folder; upgrades wipe it

The cache file uses the same Obsidian-style markdown format above so it's portable.

---

## Adding a new adapter

When the user starts using a new tool (Trello, Jira, Asana, ClickUp, etc.):

1. Add a new section above with: auth method, board structure, list/read/move/create operations
2. Add the tool as a valid value in `boards.md`
3. Test once with a real board before relying on it
