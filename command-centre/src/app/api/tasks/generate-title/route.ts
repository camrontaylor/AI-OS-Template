import { NextRequest, NextResponse } from "next/server";
import { killChildProcessTree, spawnUiProcess } from "@/lib/subprocess";

function quickExtract(description: string): string {
  // Take the first sentence or first 50 chars, whichever is shorter
  const firstLine = description.split("\n")[0].trim();
  const firstSentence = firstLine.match(/^[^.!?]+[.!?]?/)?.[0] || firstLine;
  if (firstSentence.length <= 60) return firstSentence;
  return firstSentence.slice(0, 57).replace(/\s+\S*$/, "") + "...";
}

export async function POST(request: NextRequest) {
  try {
    const { description } = await request.json();
    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    const fallback = quickExtract(description);

    // Try AI-generated title with a fast timeout
    try {
      const title = await generateTitle(description);
      if (title) {
        return NextResponse.json({ title });
      }
    } catch {
      // Fall back to quick extract
    }

    return NextResponse.json({ title: fallback });
  } catch (error) {
    console.error("POST /api/tasks/generate-title error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function generateTitle(description: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { killChildProcessTree(proc); } catch { /* gone */ }
      resolve(null);
    }, 8000);

    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const prompt = `Summarise this task as a short label (max 6 words, lowercase). Write it like a human would say it casually, e.g. "blog post about pricing", "linkedin carousel for launch", "fix header alignment bug". Do NOT prefix with "Task:", "Write:", or any label. Return ONLY the summary, nothing else.\n\n${description.slice(0, 500)}`;

    const proc = spawnUiProcess("claude", ["-p", "--output-format", "text", "--", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    if (proc.stdin) proc.stdin.end();

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        // Clean up the response — remove quotes, prefixes, trim
        let title = stdout.trim().replace(/^["']|["']$/g, "");
        // Strip common AI-generated prefixes
        title = title.replace(/^(task|title|summary|label)\s*:\s*/i, "");
        if (title.length > 60) {
          title = title.slice(0, 57).replace(/\s+\S*$/, "") + "...";
        }
        resolve(title);
      } else {
        resolve(null);
      }
    });

    proc.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}
