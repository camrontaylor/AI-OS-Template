export const CLIENT_SLUG_MAX_LENGTH = 60;

const CLIENT_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED_CLIENT_SLUGS = new Set(["root"]);
const WINDOWS_RESERVED_FILE_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/;

function needsGeneratedSuffix(slug: string): boolean {
  return RESERVED_CLIENT_SLUGS.has(slug) || WINDOWS_RESERVED_FILE_NAME_RE.test(slug);
}

export function normalizeClientSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function suggestClientSlug(name: string, attempt = 1): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CLIENT_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  const slug = base || "client";
  const sequence = needsGeneratedSuffix(slug) ? attempt + 1 : attempt;
  const suffix = sequence === 1 ? "" : `-${sequence}`;
  const fittedSlug = slug
    .slice(0, CLIENT_SLUG_MAX_LENGTH - suffix.length)
    .replace(/-+$/g, "");
  return `${fittedSlug}${suffix}`;
}

export function clientSlugValidationError(value: string): string | null {
  const slug = normalizeClientSlug(value);
  if (!slug) return "Client slug is required.";
  if (RESERVED_CLIENT_SLUGS.has(slug)) {
    return `"${slug}" is reserved for the main workspace.`;
  }
  if (!CLIENT_SLUG_RE.test(slug)) {
    return "Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number.";
  }
  if (slug.length > CLIENT_SLUG_MAX_LENGTH) {
    return `Client slug must be ${CLIENT_SLUG_MAX_LENGTH} characters or fewer.`;
  }
  if (slug.endsWith(".")) {
    return "Client slug cannot end with a dot.";
  }
  if (WINDOWS_RESERVED_FILE_NAME_RE.test(slug)) {
    return `"${slug}" is reserved by Windows and cannot be used as a client folder.`;
  }
  return null;
}
