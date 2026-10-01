import { killChildProcessTree, spawnUiProcess } from "@/lib/subprocess";

import type { ClaudeModel } from "@/types/task";

interface RunClaudeTextPromptOptions {
  prompt: string;
  model?: ClaudeModel;
  timeoutMs?: number;
}

export async function runClaudeTextPrompt(
  options: RunClaudeTextPromptOptions,
): Promise<string | null> {
  const { prompt, model, timeoutMs = 15_000 } = options;

  return new Promise((resolve) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const args = ["-p", "--output-format", "text"];
    if (model) {
      args.push("--model", model);
    }

    const proc = spawnUiProcess("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    let stdout = "";
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => {
      try {
        killChildProcessTree(proc);
      } catch {
        // Best-effort timeout cleanup only.
      }
      finish(null);
    }, timeoutMs);

    if (proc.stdin) {
      proc.stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") {
          console.warn("[run-claude-text-prompt] stdin error:", err.message);
        }
      });
      proc.stdin.end(prompt);
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", (code) => {
      finish(code === 0 && stdout.trim() ? stdout.trim() : null);
    });

    proc.on("error", () => {
      finish(null);
    });
  });
}
