# Notion sync (credit-free)

Pulls your Notion knowledge base into local markdown so it becomes part of the
agent's searchable memory, without spending a single model credit. It is a plain
Python script that calls the Notion REST API directly. No Claude model, no MCP
at runtime, so a scheduled daily run costs nothing.

## What it produces

Everything lands under `context/notion/` (gitignored, fully rebuildable):

```
context/notion/
  _index.md                 top-level summary: databases, item counts, tag list
  items/
    stack/{slug}.md         one file per Stack row
    resources/{slug}.md     one file per Resources row
    notes/{slug}.md         one file per Notes row
  tags/
    {tag}.md                one index per Global Tag, listing every item with it
```

Each item file has YAML frontmatter (`name`, `url`, resolved Global Tag names,
`date`, and the Notion `notion_id`) and a trimmed body: the **Description** field
plus your own page notes.
Clipped marketing boilerplate (cookie banners, footers, "request a demo", and
the like) and images are stripped. The value in this knowledge base lives in the
Description, the resolved tag names, and your notes, not in raw clipped pages.

Each tag file makes that tag its own browsable category: a list of every item
carrying it, grouped by database, linking back to the item files.

## How it works

1. Fetches the **Global Tags** database once and builds an ID to name map.
2. For each configured database (Stack, Resources, Notes, plus any others you
   add), pages through every row via `POST /v1/databases/{id}/query`, handling
   pagination and Notion's rate limit (about 3 requests/second) with retries.
3. Resolves each row's Global Tags relation IDs to tag names.
4. Writes one item file per row, one index per tag, and the top-level index.

**Incremental by default.** Each run records a per-database last-sync timestamp
in `.sync-state.json` (per-machine, gitignored). The next run asks Notion only
for pages edited since then via a `last_edited_time` filter, so a daily run is
fast and cheap. The first run, or any run with `--full`, fetches everything:

```bash
python3 scripts/notion-sync/notion_sync.py --full   # force a complete resync
```

The tag and top-level indexes are always rebuilt from **every** item on disk, so
an incremental run still produces complete indexes. Each item stores its Notion
page id in frontmatter so incremental runs write back to the same file. Note:
deletions/archives in Notion are not pruned locally; run `--full` periodically
if you want to reconcile removals.

It is **idempotent**: files are overwritten in place by slug. Because
`context/notion/` is gitignored and rebuildable, deleting it (and
`.sync-state.json`) and re-running is always safe.

**One indexer.** The sync writes markdown only; it does not touch memsearch. The
nightly memsearch index job is the single owner of the vector store and picks up
`context/notion/` on its next run. This avoids two processes writing the
single-process Milvus Lite database at once, which can corrupt it.

Database IDs are configured at the top of `notion_sync.py` in the `DATABASES`
dict. To add another database that shares the Global Tags taxonomy, add one line
there with its REST API database ID. The currently configured REST IDs are:

| Database     | REST API database ID               |
|--------------|------------------------------------|
| Stack        | `188c6192c266805c8c77d6ff2ce28728` |
| Resources    | `17ec6192c2668099b853c9074f1c5abb` |
| Notes        | `19ec6192c26680139071c6f3071a89f8` |
| Global Tags  | `19ec6192c26680acae31ed9eed5c89c1` |

## One-time setup

### 1. Create a Notion internal integration

1. Go to https://www.notion.so/profile/integrations and click **New integration**.
2. Name it (for example `AI-OS sync`), pick your workspace, and give it
   **Read content** capability. No write access is needed.
3. Copy the **Internal Integration Secret** (starts with `ntn_` or `secret_`).

### 2. Share the four databases with the integration

For each of Stack, Resources, Notes, and Global Tags:

1. Open the database in Notion.
2. Click the `...` menu (top right) and choose **Connections** (or **Add
   connections**).
3. Select your integration.

If you skip a database, its rows return empty and that section stays blank.

### 3. Put the key in the repo `.env`

Add this line to `.env` at the repo root (`context/notion/` and `.env` are both
gitignored, so the secret never gets committed):

```
NOTION_API_KEY=ntn_your_secret_here
```

The script reads `NOTION_API_KEY` from the environment first, then from `.env`.

### 4. Run it once by hand to confirm it works

```bash
bash "scripts/notion-sync/run-notion-sync.sh"
```

You should see progress on stderr and files appear under `context/notion/`.

### 5. Load the daily launchd job

The plist runs the sync every **day at 22:30** local time, an hour before the
nightly memsearch index (23:30), which then picks up the freshly synced folder.

```bash
# Copy the job into LaunchAgents
cp "scripts/notion-sync/com.example.notion-sync.plist" \
   ~/Library/LaunchAgents/com.example.notion-sync.plist

# Load it
launchctl load ~/Library/LaunchAgents/com.example.notion-sync.plist
```

Verify it is registered:

```bash
launchctl list | grep notion-sync
```

Run it immediately to test the loaded job (does not wait for Sunday):

```bash
launchctl start com.example.notion-sync
```

Logs are written to `context/notion/sync.log` and `context/notion/sync.err.log`.

#### Unload / reload

```bash
# Stop and unregister
launchctl unload ~/Library/LaunchAgents/com.example.notion-sync.plist

# After editing the plist, unload then load again to pick up changes
launchctl unload ~/Library/LaunchAgents/com.example.notion-sync.plist
launchctl load   ~/Library/LaunchAgents/com.example.notion-sync.plist
```

> On newer macOS you can also use the modern syntax:
> `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.notion-sync.plist`
> and `launchctl bootout gui/$(id -u)/com.example.notion-sync`. The
> `load`/`unload` form above works fine for a per-user agent.

## Notes

- **`context/notion/` is gitignored and rebuildable.** It is generated output,
  not source. Never hand-edit the files; the next sync overwrites them. To force
  a clean rebuild, delete the folder and run the sync again.
- **Zero model credits.** The sync is pure REST and does not run memsearch. The
  only model-touching step in the whole flow is the nightly memsearch index's
  local ONNX embedding, which also runs offline and costs no API credits.
- **Moving the repo?** The plist uses absolute paths. Update the two
  `ProgramArguments`/`WorkingDirectory` paths and the two log paths, then unload
  and reload the job.
- **Adding a database to the taxonomy?** Add one line to the `DATABASES` dict at
  the top of `notion_sync.py` with its REST API database ID, share it with the
  integration, and run the sync.
