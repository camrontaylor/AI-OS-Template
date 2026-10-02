// Solo worktrees use the primary context; Team authority is enforced by the CLI.
const { spawnSync } = require('child_process');
const path = require('path');
function contextCwd(cwd, teamCapture = false) {
  const result = spawnSync('bash', [path.resolve(__dirname, '../../../scripts/lib/workspace-git.sh'),
    'context', '--cwd', cwd], { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.status === 2) {
    // Hosted capture can retain its existing server route with a valid saved
    // login. Local readers, missing/corrupt logins and conversation-only mode stop.
    if (teamCapture && process.env.AI_OS_TEAM_ENRICHMENT !== 'conversation_only'
        && (process.env.TEAM_OS_MEMORY_MODE || '').trim().toLowerCase() !== 'local') {
      try {
        const fs = require('fs');
        const os = require('os');
        const dir = process.env.AI_OS_TEAM_CONFIG_DIR || path.join(os.homedir(), '.AI-OS');
        const config = JSON.parse(fs.readFileSync(path.join(dir, 'team-context.json'), 'utf8'));
        const expiry = config.expiresAt == null ? Infinity : Date.parse(config.expiresAt);
        if ((expiry === Infinity || (Number.isFinite(expiry) && expiry > Date.now()))
            && typeof config.token === 'string' && config.token.trim()
            && typeof config.apiUrl === 'string' && /^https?:\/\//.test(config.apiUrl)) return cwd;
      } catch { /* unreadable Team authority stays blocked */ }
    }
    return null;
  }
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout).scope || cwd; } catch { return cwd; }
}
module.exports = { contextCwd };
