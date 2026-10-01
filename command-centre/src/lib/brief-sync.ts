/**
 * Brief ↔ Subtask synchronization.
 *
 * - Parses deliverables from a brief.md file
 * - Detects new deliverables that don't have matching subtasks
 * - Appends new subtask titles to the brief's deliverables section
 */

/** Strip checkbox prefix (e.g. "[ ] " or "[x] ") from a deliverable string */
function stripCheckbox(text: string): string {
  return text.replace(/^\[[ xX]\]\s*/, "");
}

/** Strip markdown inline formatting for plain-text comparison */
function stripMarkdownInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/** Extract deliverable lines from brief markdown content */
export function parseDeliverables(content: string): string[] {
  const lines = content.split("\n");
  let inDeliverables = false;
  const deliverables: string[] = [];

  for (const line of lines) {
    // Detect start of deliverables section
    if (/^##\s+Deliverables/i.test(line.trim())) {
      inDeliverables = true;
      continue;
    }
    // Stop at the next heading
    if (inDeliverables && /^##\s+/.test(line.trim())) {
      break;
    }
    // Collect bullet items
    if (inDeliverables && /^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, "").trim();
      if (text) deliverables.push(stripMarkdownInline(stripCheckbox(text)));
    }
  }

  return deliverables;
}

/**
 * Toggle a deliverable checkbox in brief.md content.
 * Fuzzy-matches subtaskTitle against deliverable lines (same includes logic as findNewDeliverables).
 * Rewrites `- [ ]` ↔ `- [x]` for the matched line.
 * Returns the updated content, or the original content if no match found.
 */
export function toggleDeliverableCheckbox(
  content: string,
  subtaskTitle: string,
  checked: boolean,
): string {
  const lines = content.split("\n");
  let inDeliverables = false;
  const normalizedTitle = subtaskTitle.toLowerCase().trim();

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Deliverables/i.test(lines[i].trim())) {
      inDeliverables = true;
      continue;
    }
    if (inDeliverables && /^##\s+/.test(lines[i].trim())) {
      break;
    }
    if (inDeliverables && /^\s*[-*]\s+/.test(lines[i])) {
      const text = lines[i].replace(/^\s*[-*]\s+/, "").trim();
      const cleanText = stripMarkdownInline(stripCheckbox(text)).toLowerCase().trim();
      // Fuzzy match: either contains the other
      if (cleanText.includes(normalizedTitle) || normalizedTitle.includes(cleanText)) {
        if (checked) {
          // Replace `- [ ] ` with `- [x] ` or add `[x] ` if no checkbox
          if (/^\s*[-*]\s+\[ \]/.test(lines[i])) {
            lines[i] = lines[i].replace("[ ]", "[x]");
          } else if (!/^\s*[-*]\s+\[x\]/i.test(lines[i])) {
            // No checkbox at all — add one
            lines[i] = lines[i].replace(/^(\s*[-*]\s+)/, "$1[x] ");
          }
        } else {
          // Replace `- [x] ` with `- [ ] `
          if (/^\s*[-*]\s+\[x\]/i.test(lines[i])) {
            lines[i] = lines[i].replace(/\[x\]/i, "[ ]");
          }
        }
        return lines.join("\n");
      }
    }
  }

  return content; // No match found
}

/** Append a new deliverable line to the brief's Deliverables section */
export function appendDeliverable(content: string, newDeliverable: string): string {
  const lines = content.split("\n");
  let inDeliverables = false;
  let lastDeliverableIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Deliverables/i.test(lines[i].trim())) {
      inDeliverables = true;
      continue;
    }
    if (inDeliverables && /^##\s+/.test(lines[i].trim())) {
      break;
    }
    if (inDeliverables && /^\s*[-*]\s+/.test(lines[i])) {
      lastDeliverableIdx = i;
    }
  }

  if (lastDeliverableIdx >= 0) {
    // Insert after the last deliverable bullet
    lines.splice(lastDeliverableIdx + 1, 0, `- ${newDeliverable}`);
  } else {
    // No deliverables section found — append one
    lines.push("", "## Deliverables", `- ${newDeliverable}`);
  }

  return lines.join("\n");
}

/** Find deliverables in brief that don't have a matching subtask title */
export function findNewDeliverables(
  deliverables: string[],
  existingTitles: string[],
): string[] {
  const normalizedTitles = new Set(
    existingTitles.map((t) => t.toLowerCase().trim()),
  );

  return deliverables.filter((d) => {
    const normalized = d.toLowerCase().trim();
    // Check if any existing title contains this deliverable or vice versa
    for (const title of normalizedTitles) {
      if (title.includes(normalized) || normalized.includes(title)) {
        return false;
      }
    }
    return true;
  });
}
