function parseScalar(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  if (/^(true|false)$/i.test(raw)) {
    return raw.toLowerCase() === "true";
  }

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw);
  }

  return raw;
}

function parseFrontmatterData(frontmatter) {
  const data = {};
  const lines = String(frontmatter || "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2] ?? "";
    if (value === "") {
      const items = [];
      while (index + 1 < lines.length) {
        const itemMatch = lines[index + 1].match(/^\s*-\s+(.*)$/);
        if (!itemMatch) break;
        index += 1;
        items.push(parseScalar(itemMatch[1]));
      }
      data[key] = items.length > 0 ? items : "";
      continue;
    }

    if (value === ">" || value === "|") {
      const block = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].replace(/^\s{2}/, ""));
      }
      data[key] = value === ">" ? block.join(" ").trim() : block.join("\n");
      continue;
    }

    data[key] = parseScalar(value);
  }

  return data;
}

function parseMarkdownFrontmatter(raw) {
  const text = String(raw || "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    return {
      data: {},
      content: text,
    };
  }

  return {
    data: parseFrontmatterData(match[1]),
    content: text.slice(match[0].length),
  };
}

function quoteScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  const raw = String(value);
  if (!raw) return "''";
  if (/^[A-Za-z0-9_.\/ -]+$/.test(raw) && !/^(true|false|null|~)$/i.test(raw)) {
    return raw;
  }
  return `'${raw.replace(/'/g, "''")}'`;
}

function stringifyMarkdownFrontmatter(content, data) {
  const safeData = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const lines = [];

  for (const [key, value] of Object.entries(safeData)) {
    if (value === undefined) {
      continue;
    }

    if (typeof value === "string" && value.includes("\n")) {
      lines.push(`${key}: |`);
      for (const blockLine of value.split(/\r?\n/)) {
        lines.push(`  ${blockLine}`);
      }
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${quoteScalar(item)}`);
      }
      continue;
    }

    lines.push(`${key}: ${quoteScalar(value)}`);
  }

  const body = String(content || "").trim();
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

module.exports = {
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter,
};
