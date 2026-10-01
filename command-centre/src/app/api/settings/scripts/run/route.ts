import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import { getScriptById } from "@/lib/script-registry";
import { spawnUiProcess } from "@/lib/subprocess";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";

const runningScripts = new Set<string>();
const UPDATE_TOKEN_ENV = "AI_OS_UPDATE_TOKEN";
const MEMORY_DATABASE_URL_ENV = "MEMORY_DATABASE_URL";
const MEMORY_SETUP_MODES = new Set(["check", "local", "postgres"]);

interface ScriptArgsResult {
  argValues: string[];
  memoryDatabaseUrl?: string;
  error?: string;
}

function trimSafeEnvValue(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return "";
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeEnvValue(rootDir: string, key: string, value: string) {
  const envPath = path.join(rootDir, ".env");
  const tmpPath = `${envPath}.tmp`;
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8")
    : "# Add your API keys here.\n";
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
  const lines = existing.split(/\r?\n/);
  const next: string[] = [];
  let updated = false;

  for (const line of lines) {
    if (pattern.test(line)) {
      if (!updated) {
        next.push(`${key}=${value}`);
        updated = true;
      }
      continue;
    }
    next.push(line);
  }

  if (!updated) {
    next.push(`${key}=${value}`);
  }

  fs.writeFileSync(tmpPath, `${next.join("\n").replace(/\n*$/, "")}\n`, "utf-8");
  fs.renameSync(tmpPath, envPath);
}

function buildMemorySetupArgs(args?: Record<string, string>): ScriptArgsResult {
  const mode = typeof args?.mode === "string" ? args.mode.trim() : "";
  if (!MEMORY_SETUP_MODES.has(mode)) {
    return { argValues: [], error: "Invalid memory setup mode" };
  }

  const memoryDatabaseUrl = trimSafeEnvValue(args?.memoryDatabaseUrl);
  if (typeof args?.memoryDatabaseUrl === "string" && args.memoryDatabaseUrl.trim() && !memoryDatabaseUrl) {
    return { argValues: [], error: "MEMORY_DATABASE_URL cannot contain line breaks" };
  }

  if (mode === "check") {
    return { argValues: ["--check"] };
  }

  if (mode === "local") {
    return { argValues: ["--backend", "local", "--yes"] };
  }

  return {
    argValues: ["--backend", "postgres", "--yes"],
    memoryDatabaseUrl: memoryDatabaseUrl || undefined,
  };
}

function buildScriptArgs(scriptId: string, args: Record<string, string> | undefined, scriptArgs: Array<{ name: string }>): ScriptArgsResult {
  if (scriptId === "memory-setup") {
    return buildMemorySetupArgs(args);
  }

  const argValues: string[] = [];
  for (const argDef of scriptArgs) {
    if (args && args[argDef.name]) {
      argValues.push(args[argDef.name]);
    }
  }
  return { argValues };
}

function buildAllowedEnv(
  scriptId: string,
  env?: Record<string, string>,
  memoryDatabaseUrl?: string,
): Partial<NodeJS.ProcessEnv> {
  const allowedEnv: Partial<NodeJS.ProcessEnv> = {};

  if (scriptId === "update") {
    const rawToken = env?.[UPDATE_TOKEN_ENV];
    const token = typeof rawToken === "string" ? rawToken.trim() : "";
    if (token) {
      allowedEnv[UPDATE_TOKEN_ENV] = token;
    }
  }

  if (scriptId === "memory-setup") {
    const safeMemoryDatabaseUrl =
      memoryDatabaseUrl || trimSafeEnvValue(env?.[MEMORY_DATABASE_URL_ENV]);
    if (safeMemoryDatabaseUrl) {
      allowedEnv[MEMORY_DATABASE_URL_ENV] = safeMemoryDatabaseUrl;
    }
  }

  return allowedEnv;
}

export async function POST(request: NextRequest) {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse();
    }

    const body = await request.json();
    const { scriptId, args, env } = body as {
      scriptId: string;
      args?: Record<string, string>;
      env?: Record<string, string>;
    };

    if (!scriptId || typeof scriptId !== "string") {
      return NextResponse.json({ error: "scriptId is required" }, { status: 400 });
    }

    const script = getScriptById(scriptId);
    if (!script) {
      return NextResponse.json({ error: `Script not found: ${scriptId}` }, { status: 404 });
    }

    const config = getConfig();
    const scriptPath = path.join(config.aiOsDir, "scripts", script.file);

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: `Script file not found: ${script.file}` }, { status: 404 });
    }

    // Validate required args
    for (const argDef of script.args) {
      if (argDef.required && (!args || !args[argDef.name])) {
        return NextResponse.json(
          { error: `Missing required argument: ${argDef.label}` },
          { status: 400 }
        );
      }
    }

    const scriptArgsResult = buildScriptArgs(scriptId, args, script.args);
    if (scriptArgsResult.error) {
      return NextResponse.json({ error: scriptArgsResult.error }, { status: 400 });
    }

    // Check if script is already running
    if (runningScripts.has(scriptId)) {
      return NextResponse.json({ error: "Script already running" }, { status: 409 });
    }

    if (scriptId === "memory-setup" && scriptArgsResult.memoryDatabaseUrl) {
      writeEnvValue(config.aiOsDir, MEMORY_DATABASE_URL_ENV, scriptArgsResult.memoryDatabaseUrl);
    }

    runningScripts.add(scriptId);

    const argValues = scriptArgsResult.argValues;
    const allowedEnv = buildAllowedEnv(scriptId, env, scriptArgsResult.memoryDatabaseUrl);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        let finalized = false;
        let streamClosed = false;
        let proc: ReturnType<typeof spawnUiProcess>;

        const enqueue = (obj: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            // Stream may have been closed by client
          }
        };

        const closeStream = () => {
          if (streamClosed) return;
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // Stream may already be closed.
          }
        };

        const finalize = (code: number, errorMessage?: string) => {
          if (finalized) return;
          finalized = true;
          if (errorMessage) {
            enqueue({ type: "stderr", data: errorMessage });
          }
          enqueue({ type: "exit", code });
          runningScripts.delete(scriptId);
          closeStream();
        };

        try {
          proc = spawnUiProcess("bash", [scriptPath, ...argValues], {
            cwd: config.aiOsDir,
            env: {
              ...process.env,
              ...allowedEnv,
            },
            stdio: ["pipe", "pipe", "pipe"],
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to start script";
          finalize(1, `Process error: ${message}`);
          return;
        }

        if (proc.stdin) {
          proc.stdin.end();
        }

        if (proc.stdout) {
          proc.stdout.on("data", (chunk: Buffer) => {
            enqueue({ type: "stdout", data: chunk.toString() });
          });
        }

        if (proc.stderr) {
          proc.stderr.on("data", (chunk: Buffer) => {
            enqueue({ type: "stderr", data: chunk.toString() });
          });
        }

        proc.on("error", (err) => {
          finalize(1, `Process error: ${err.message}`);
        });

        proc.on("close", (code) => {
          finalize(code ?? 1);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to execute script";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
