import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import {
  fetchTeamUserConfigFile,
  TeamApiError,
  writeTeamUserConfigFile,
} from "@/lib/team-api-context";
import {
  assertMaterializedPathAccessible,
  assertMaterializedPathWritable,
  MaterializedFileAccessError,
  registerMaterializedFiles,
} from "@/lib/materialized-file-ownership";

function getMcpPath(): string {
  return path.join(getConfig().aiOsDir, ".mcp.json");
}

function writeLocalMcpFile(mcpPath: string, content: string): void {
  assertMaterializedPathWritable(mcpPath);
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });
  const tmpPath = `${mcpPath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, mcpPath);
  registerMaterializedFiles([mcpPath], { scope: "config", kind: "team-mcp-config" });
}

async function restoreRemoteMcpIfAvailable(mcpPath: string) {
  try {
    const remote = await fetchTeamUserConfigFile(".mcp.json");
    if (!remote) return null;
    writeLocalMcpFile(mcpPath, remote.content);
    return remote;
  } catch {
    return null;
  }
}

async function backupRemoteMcp(content: string) {
  try {
    const remote = await fetchTeamUserConfigFile(".mcp.json");
    const written = await writeTeamUserConfigFile(".mcp.json", content, remote?.sha256);
    return {
      status: "saved",
      sha256: written.sha256 ?? null,
      updatedAt: written.updatedAt ?? null,
    };
  } catch (error) {
    if (error instanceof TeamApiError) {
      if (error.code === "secret_crypto_unavailable") {
        return {
          status: "disabled",
          message: "Remote MCP backup is disabled because TEAM_OS_SECRETS_KEYS is not configured on the server.",
        };
      }
      if (error.status === 409) {
        return {
          status: "conflict",
          message: "Remote MCP backup changed on the server. Run context:sync before saving again.",
        };
      }
      return {
        status: "skipped",
        message: error.message,
      };
    }
    return {
      status: "skipped",
      message: "Remote MCP backup unavailable.",
    };
  }
}

export async function GET() {
  try {
    const mcpPath = getMcpPath();

    if (!fs.existsSync(mcpPath)) {
      const remote = await restoreRemoteMcpIfAvailable(mcpPath);
      if (remote && fs.existsSync(mcpPath)) {
        const stat = fs.statSync(mcpPath);
        return NextResponse.json({
          content: remote.content,
          exists: true,
          lastModified: stat.mtime.toISOString(),
          restoredFromServer: true,
          remoteSha256: remote.sha256 ?? null,
        });
      }
      return NextResponse.json({ content: "", exists: false, lastModified: null });
    }

    assertMaterializedPathAccessible(mcpPath);
    const content = fs.readFileSync(mcpPath, "utf-8");
    const stat = fs.statSync(mcpPath);

    return NextResponse.json({
      content,
      exists: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch (err) {
    if (err instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Configuration not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Failed to read .mcp.json";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, lastModified } = body as { content: string; lastModified?: string };

    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }

    // Validate JSON before saving
    try {
      JSON.parse(content);
    } catch (parseErr) {
      const parseMessage = parseErr instanceof Error ? parseErr.message : "Invalid JSON";
      return NextResponse.json({ error: `Invalid JSON: ${parseMessage}` }, { status: 400 });
    }

    const mcpPath = getMcpPath();
    assertMaterializedPathWritable(mcpPath);

    // Optimistic concurrency check
    if (lastModified && fs.existsSync(mcpPath)) {
      const stat = fs.statSync(mcpPath);
      const currentModified = stat.mtime.toISOString();
      if (currentModified !== lastModified) {
        return NextResponse.json(
          { error: "File was modified since you loaded it. Reload and try again." },
          { status: 409 }
        );
      }
    }

    writeLocalMcpFile(mcpPath, content);

    const stat = fs.statSync(mcpPath);
    const remoteBackup = await backupRemoteMcp(content);

    return NextResponse.json({
      saved: true,
      lastModified: stat.mtime.toISOString(),
      remoteBackup,
    });
  } catch (err) {
    if (err instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Configuration not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Failed to save .mcp.json";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
