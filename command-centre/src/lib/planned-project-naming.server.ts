import { runClaudeTextPrompt } from "@/lib/run-claude-text-prompt";
import {
  buildPlannedProjectNameFromAi,
  buildPlannedProjectNameFromFallback,
  buildPlannedProjectNameFromTitle,
  type PlannedProjectNameResult,
} from "@/lib/planned-project-naming";

interface ResolvePlannedProjectNameOptions {
  userTitle?: string | null;
  prompt: string;
}

export async function resolvePlannedProjectName(
  options: ResolvePlannedProjectNameOptions,
): Promise<PlannedProjectNameResult> {
  const titleResult = buildPlannedProjectNameFromTitle(options.userTitle);
  if (titleResult) return titleResult;

  const prompt = options.prompt.trim();
  if (prompt) {
    const generated = await runClaudeTextPrompt({
      model: "haiku",
      timeoutMs: 12_000,
      prompt: `Name this planned project.

Use the full request, not only the first sentence. If the user clearly gave a project name inside the request, use that name. Otherwise infer a short name from the task or plan description.

Rules:
- Return only the project name.
- Use 3-6 words when possible.
- No markdown, no quotes, no explanation.
- Do not include words like "project", "task", or "request" unless they are part of the natural name.

Request:
${prompt}`,
    }).catch(() => null);

    const aiResult = buildPlannedProjectNameFromAi(generated);
    if (aiResult) return aiResult;
  }

  return buildPlannedProjectNameFromFallback(options.prompt);
}
