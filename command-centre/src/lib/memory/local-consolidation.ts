import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function kickLocalMemoryConsolidation(input: {
  rootDir: string;
  client?: string | null;
  reason?: string;
}): boolean {
  const script = path.join(input.rootDir, "command-centre", "scripts", "memory-consolidation-tick.cjs");
  if (!fs.existsSync(script)) return false;

  const args = [script, "--quiet", "--reason", input.reason || "command-centre"];
  const client = typeof input.client === "string" ? input.client.trim() : "";
  if (client) args.push("--client", client);

  try {
    const child = spawn(process.execPath, args, {
      cwd: path.join(input.rootDir, "command-centre"),
      env: process.env,
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
