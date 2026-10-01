export interface EnvEntry {
  key: string;
  value: string;
  isComment: boolean;
  raw: string;
}

export function parseEnv(content: string): EnvEntry[] {
  return content.split("\n").map((raw) => {
    if (raw.startsWith("#") || raw.trim() === "") {
      return { key: "", value: "", isComment: true, raw };
    }
    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) return { key: raw, value: "", isComment: false, raw };
    return {
      key: raw.slice(0, eqIdx),
      value: raw.slice(eqIdx + 1),
      isComment: false,
      raw,
    };
  });
}

export function serializeEnv(entries: EnvEntry[]): string {
  return entries.map((e) => (e.isComment ? e.raw : `${e.key}=${e.value}`)).join("\n");
}
