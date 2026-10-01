import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Scope Turbopack and file tracing to the command-centre directory itself.
// Setting these to an ancestor (AI-OS repo root) causes
// `@tailwindcss/postcss` to resolve `tailwindcss` from a parent directory that
// has no `node_modules`, producing "Can't resolve 'tailwindcss'" errors.
// It also prevents Turbopack from silently picking up the user's home
// package.json as the workspace root.
const configDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Next 16.3+ writes AGENTS.md and CLAUDE.md into the app directory when
  // `next dev` runs under an AI agent (Claude Code, Cursor, Codex...). Those
  // are the workspace-root markers in scripts/workspace-root.cjs, so the next
  // boot would treat command-centre/ as the workspace and read an empty one.
  agentRules: false,
  outputFileTracingRoot: configDir,
  serverExternalPackages: ["better-sqlite3", "pg"],
  turbopack: {
    root: configDir,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
