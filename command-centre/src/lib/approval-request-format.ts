function getPathLike(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;

  if ("file_path" in input && typeof input.file_path === "string" && input.file_path.trim()) {
    return input.file_path.trim();
  }

  if ("path" in input && typeof input.path === "string" && input.path.trim()) {
    return input.path.trim();
  }

  return null;
}

function getCommandLike(input: unknown): string | null {
  if (typeof input === "string" && input.trim()) {
    return input.trim();
  }

  if (!input || typeof input !== "object") return null;

  if ("command" in input && typeof input.command === "string" && input.command.trim()) {
    return input.command.trim();
  }

  return null;
}

function safeJsonStringify(value: unknown, spaces = 0): string {
  try {
    return JSON.stringify(value ?? {}, null, spaces);
  } catch {
    return String(value);
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function parseApprovalRequestInput(inputJson: string | null | undefined): unknown {
  if (!inputJson?.trim()) {
    return {};
  }

  try {
    return JSON.parse(inputJson);
  } catch {
    return inputJson;
  }
}

export function formatApprovalRequestSummary(
  toolName: string,
  input: unknown,
  previewLimit = 120,
): string {
  const pathLike = getPathLike(input);

  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    return pathLike
      ? `Claude wants to edit ${pathLike}.`
      : "Claude wants to edit files.";
  }

  if (toolName.startsWith("Bash")) {
    const command = getCommandLike(input) ?? safeJsonStringify(input);
    return `Claude wants to run a command: ${truncate(command, previewLimit)}`;
  }

  return `Claude wants to use ${toolName}.`;
}

export function formatApprovalRequestDetail(
  toolName: string,
  input: unknown,
): { label: string | null; text: string | null } {
  const pathLike = getPathLike(input);

  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit") {
    const detail = pathLike ? `Path: ${pathLike}` : safeJsonStringify(input, 2);
    return {
      label: "full input",
      text: detail || null,
    };
  }

  if (toolName.startsWith("Bash")) {
    return {
      label: "full command",
      text: getCommandLike(input) ?? safeJsonStringify(input, 2),
    };
  }

  const prettyJson = safeJsonStringify(input, 2);
  if (!prettyJson || prettyJson === "{}") {
    return { label: null, text: null };
  }

  return {
    label: "full input",
    text: prettyJson,
  };
}

export function getApprovalRequestDisplay(request: {
  toolName: string;
  inputJson: string;
  description?: string | null;
}): { summary: string; detailLabel: string | null; detailText: string | null } {
  const input = parseApprovalRequestInput(request.inputJson);
  return {
    summary:
      request.description?.trim() ||
      formatApprovalRequestSummary(request.toolName, input),
    detailLabel: formatApprovalRequestDetail(request.toolName, input).label,
    detailText: formatApprovalRequestDetail(request.toolName, input).text,
  };
}
