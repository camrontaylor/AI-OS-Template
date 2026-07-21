// Shim. The canonical module lives at scripts/cron/workspace-root.cjs at the
// AI-OS workspace root, where the standalone cron daemon needs it (see AGENTS.md,
// "Command Centre Boundary"). This shim keeps Command Centre scripts working unchanged.
module.exports = require("../../scripts/cron/workspace-root.cjs");
