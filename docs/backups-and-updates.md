# Backups and updates

This public repository is the reusable template. Your private working copy is separate.
Context, brand files, client work and deliverables can be tracked in Git; use a
**private** repository for them. Do not push those files to the public template or a public fork.

The guided installer can create a private backup in your own GitHub account if you
choose that option. It recognizes this template as the download source, not your backup.
The optional backup includes summarized memory files; raw transcripts and built
memory databases remain local. Verify what is included and keep a separate protected
recovery path for secrets and anything excluded from Git.

For updates, ask your agent **“Check for AI-OS updates, protect my files and explain what will change.”**
The shipped update source is `camrontaylor/AI-OS-Template`, branch `main`.
An update needs a Git clone. A ZIP download needs to become a proper Git checkout first.

The script is `bash scripts/update.sh`. It preserves user data and local overrides,
and reports conflicts or recovery paths instead of assuming a clean merge.
Public template reads do not require a shared access token. A different private source
may require your own GitHub access. Source settings can be changed in local `.env`.

Use `SKILL.local.md` for skill corrections, and `.claude/settings.local.json` for
personal Claude settings. Keep a recovery copy before updating. Read the actual
update output and run the relevant checks afterward.

If an update stops, use `bash scripts/update-recovery.sh --latest` to inspect its report.
Do not run random reset or cleanup commands on working data.
