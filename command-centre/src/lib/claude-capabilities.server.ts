import { killChildProcessTree, spawnManagedTaskProcess } from "@/lib/subprocess";
import {
  AUTO_MODE_MINIMUM_CLI_VERSION,
  compareVersions,
  getAutoModeModelError,
  parseClaudeCliVersion,
  permissionStateUsesAuto,
  type AutoModeUnavailable,
  type ClaudeCapabilities,
} from "@/lib/claude-auto-mode";
import type { ClaudeModel, PermissionMode } from "@/types/task";

const VERSION_CHECK_TIMEOUT_MS = 5_000;
const MAX_VERSION_OUTPUT_BYTES = 4_096;
const SUCCESS_CACHE_MS = 5 * 60_000;
const UNKNOWN_CACHE_MS = 30_000;

type ProbeResult = Omit<ClaudeCapabilities, "checkedAt">;
type ProbeObservation = {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
  timedOut?: boolean;
};

let cachedResult: { value: ClaudeCapabilities; expiresAt: number } | null = null;
let inFlightCheck: Promise<ClaudeCapabilities> | null = null;

function buildProbeResult(
  status: ClaudeCapabilities["cli"]["status"],
  version: string | null,
  compatibility: ClaudeCapabilities["autoMode"]["cliCompatibility"],
  reason: ClaudeCapabilities["autoMode"]["reason"],
): ProbeResult {
  return {
    cli: { status, version },
    autoMode: {
      cliCompatibility: compatibility,
      minimumVersion: AUTO_MODE_MINIMUM_CLI_VERSION,
      reason,
    },
  };
}

export function buildClaudeCapabilityFromVersionOutput(output: string): ProbeResult {
  const version = parseClaudeCliVersion(output);
  if (!version) {
    return buildProbeResult("available", null, "unknown", "version_unparseable");
  }
  if (compareVersions(version, AUTO_MODE_MINIMUM_CLI_VERSION) < 0) {
    return buildProbeResult("available", version, "incompatible", "cli_too_old");
  }
  return buildProbeResult("available", version, "compatible", null);
}

export function classifyClaudeVersionProbe(observation: ProbeObservation): ProbeResult {
  if (observation.timedOut) {
    return buildProbeResult("unknown", null, "unknown", "check_timeout");
  }
  if (observation.errorCode === "ENOENT") {
    return buildProbeResult("missing", null, "incompatible", "cli_missing");
  }
  if (observation.errorCode) {
    return buildProbeResult("unknown", null, "unknown", "check_failed");
  }
  if (observation.exitCode === 0) {
    return buildClaudeCapabilityFromVersionOutput(
      `${observation.stdout ?? ""}\n${observation.stderr ?? ""}`,
    );
  }

  const detail = `${observation.stdout ?? ""}\n${observation.stderr ?? ""}`;
  if (/not recognized|not found|command not found|enoent/i.test(detail)) {
    return buildProbeResult("missing", null, "incompatible", "cli_missing");
  }
  return buildProbeResult("unknown", null, "unknown", "check_failed");
}

function runClaudeVersionProbe(): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let finished = false;
    let output = "";
    let errorOutput = "";
    let proc: ReturnType<typeof spawnManagedTaskProcess>;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: ProbeResult) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };

    const append = (current: string, chunk: Buffer | string) =>
      (current + chunk.toString()).slice(0, MAX_VERSION_OUTPUT_BYTES);

    try {
      proc = spawnManagedTaskProcess("claude", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    } catch (error) {
      resolve(classifyClaudeVersionProbe({ errorCode: (error as NodeJS.ErrnoException).code }));
      return;
    }

    timeout = setTimeout(() => {
      killChildProcessTree(proc, "SIGKILL");
      finish(classifyClaudeVersionProbe({ timedOut: true }));
    }, VERSION_CHECK_TIMEOUT_MS);

    proc.stdout?.on("data", (chunk: Buffer | string) => {
      output = append(output, chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      errorOutput = append(errorOutput, chunk);
    });
    proc.on("error", (error: NodeJS.ErrnoException) => {
      finish(classifyClaudeVersionProbe({ errorCode: error.code }));
    });
    proc.on("close", (code) => {
      finish(classifyClaudeVersionProbe({ exitCode: code, stdout: output, stderr: errorOutput }));
    });
  });
}

export async function getClaudeCapabilities(
  options: { force?: boolean; probe?: () => Promise<ProbeResult> } = {},
): Promise<ClaudeCapabilities> {
  const now = Date.now();
  if (!options.force && cachedResult && cachedResult.expiresAt > now) {
    return cachedResult.value;
  }
  if (!options.force && inFlightCheck) return inFlightCheck;

  inFlightCheck = (options.probe ?? runClaudeVersionProbe)().then((result) => {
    const value: ClaudeCapabilities = { checkedAt: new Date().toISOString(), ...result };
    const ttl = result.cli.status === "available" ? SUCCESS_CACHE_MS : UNKNOWN_CACHE_MS;
    cachedResult = { value, expiresAt: Date.now() + ttl };
    return value;
  }).finally(() => {
    inFlightCheck = null;
  });

  return inFlightCheck;
}

export function resetClaudeCapabilityCacheForTests(): void {
  cachedResult = null;
  inFlightCheck = null;
}

export async function getAutoModeUnavailability({
  permissionMode,
  executionPermissionMode,
  model,
}: {
  permissionMode: PermissionMode | string | null | undefined;
  executionPermissionMode?: PermissionMode | string | null;
  model: ClaudeModel | null | undefined;
}): Promise<AutoModeUnavailable | null> {
  if (!permissionStateUsesAuto(permissionMode, executionPermissionMode)) return null;

  const capabilities = await getClaudeCapabilities();
  if (capabilities.autoMode.reason === "cli_missing") {
    return {
      code: "auto_mode_unavailable",
      reason: "cli_missing",
      error: `Auto needs Claude Code ${AUTO_MODE_MINIMUM_CLI_VERSION} or later. Claude Code was not found.`,
    };
  }
  if (capabilities.autoMode.reason === "cli_too_old") {
    return {
      code: "auto_mode_unavailable",
      reason: "cli_too_old",
      error: `Auto needs Claude Code ${AUTO_MODE_MINIMUM_CLI_VERSION} or later. Installed: ${capabilities.cli.version ?? "unknown"}.`,
    };
  }

  const modelError = getAutoModeModelError(model);
  if (modelError) {
    return { code: "auto_mode_unavailable", reason: "model_incompatible", error: modelError };
  }

  return null;
}
