#!/usr/bin/env node

// Shim. The canonical cron daemon lives at scripts/cron/cron-daemon.cjs at the
// AI-OS workspace root, so cron runs without the Command Centre (see AGENTS.md,
// "Command Centre Boundary"). This shim keeps any old command lines working.
require("../../scripts/cron/cron-daemon.cjs");
