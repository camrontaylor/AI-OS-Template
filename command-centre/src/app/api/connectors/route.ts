import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import { parseComposioSnapshot, type ApiService, type McpServer } from "@/lib/marketing-integrations";

/**
 * GET /api/connectors
 *
 * Surfaces the connector map for the workspace:
 *  - MCP servers     from .mcp.json (root + command-centre)
 *  - API services    from .env.example (the Service Registry blocks), with a
 *                    configured/missing flag derived from process.env presence
 *                    only - values are NEVER read or returned.
 * Read-only, root-scoped (connectors are shared infrastructure).
 */

function readMcp(file: string, source: string): McpServer[] {
  try {
    if (!fs.existsSync(file)) return [];
    const json = JSON.parse(fs.readFileSync(file, "utf-8"));
    const servers = json.mcpServers && typeof json.mcpServers === "object" ? json.mcpServers : {};
    return Object.entries(servers).map(([name, cfg]) => {
      const c = cfg as Record<string, unknown>;
      const command = [c.command, ...((c.args as string[]) || [])].filter(Boolean).join(" ");
      return { name, command: command || (c.url as string) || "", source };
    });
  } catch {
    return [];
  }
}

// Parse the commented Service Registry blocks in .env.example:
//   # Service: what it is (url)
//   # Used by: skill (what it enables)
//   KEY=
function parseEnvExample(file: string): ApiService[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  const out: ApiService[] = [];
  let service = "";
  let usedBy = "";
  for (const raw of lines) {
    const line = raw.trim();
    const svc = line.match(/^#\s*Service:\s*(.+)/i);
    if (svc) {
      service = svc[1].trim();
      usedBy = "";
      continue;
    }
    const used = line.match(/^#\s*Used by:\s*(.+)/i);
    if (used) {
      usedBy = used[1].trim();
      continue;
    }
    const kv = line.match(/^([A-Z][A-Z0-9_]+)=/);
    if (kv) {
      const key = kv[1];
      out.push({
        key,
        service: service || key,
        usedBy,
        configured: !!process.env[key],
      });
      // reset so a key without its own header block does not inherit
      service = "";
      usedBy = "";
    }
  }
  return out;
}

export async function GET() {
  try {
    const root = getConfig().agenticOsDir;
    const mcpServers = [
      ...readMcp(path.join(root, ".mcp.json"), "root"),
      ...readMcp(path.join(root, "command-centre", ".mcp.json"), "command-centre"),
    ];
    const services = parseEnvExample(path.join(root, ".env.example"));
    const connectorsDocPath = path.join(root, "docs", "connectors.md");
    const composio = fs.existsSync(connectorsDocPath)
      ? parseComposioSnapshot(fs.readFileSync(connectorsDocPath, "utf-8"))
      : undefined;

    return NextResponse.json({
      mcpServers,
      services,
      configuredCount: services.filter((s) => s.configured).length,
      composio,
    });
  } catch (error) {
    console.error("GET /api/connectors error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
