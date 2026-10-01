import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import {
  TASK_FILE_ROOTS,
  TASK_ROOT_FILES,
  isAllowedTaskFilePath,
  normalizeTaskRelativePath,
} from "./workspace-file-reference";

export interface WorkspaceDirectoryChangedEvent {
  type: "workspace:directory-changed";
  directory: string;
}

type WorkspaceFileSubscriber = (event: WorkspaceDirectoryChangedEvent) => void;
type WatchFactory = typeof watch;

interface WorkspaceWatchEntry {
  watcher: FSWatcher;
  subscribers: Set<WorkspaceFileSubscriber>;
  pendingDirectories: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const HEAVY_DIRECTORY_NAMES = new Set(["node_modules", ".next"]);
const WATCH_DEBOUNCE_MS = 80;

function slashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function allowedRootForPath(relativePath: string): string | null {
  const matchingRoot = [...TASK_FILE_ROOTS]
    .sort((left, right) => right.length - left.length)
    .find((root) => relativePath === root || relativePath.startsWith(`${root}/`));
  return matchingRoot ?? null;
}

export function shouldIgnoreWorkspaceWatchPath(baseDir: string, candidatePath: string): boolean {
  const relative = slashPath(path.relative(path.resolve(baseDir), path.resolve(candidatePath)));
  if (!relative) return false;
  if (relative === ".." || relative.startsWith("../")) return true;

  // Chokidar must be allowed to descend through ancestors such as `.claude`
  // before it reaches the permitted `.claude/skills` root.
  if (TASK_FILE_ROOTS.some((root) => root.startsWith(`${relative}/`))) return false;
  if (TASK_ROOT_FILES.includes(relative as typeof TASK_ROOT_FILES[number])) return false;
  if (!isAllowedTaskFilePath(relative)) return true;

  const allowedRoot = allowedRootForPath(relative);
  if (!allowedRoot) return true;
  const remainder = relative.slice(allowedRoot.length).replace(/^\/+/, "");
  if (!remainder) return false;
  return remainder
    .split("/")
    .some((segment) => segment.startsWith(".") || HEAVY_DIRECTORY_NAMES.has(segment));
}

export function workspaceDirectoryForFileEvent(baseDir: string, changedPath: string): string | null {
  const relative = normalizeTaskRelativePath(slashPath(path.relative(path.resolve(baseDir), path.resolve(changedPath))));
  if (!relative || !isAllowedTaskFilePath(relative)) return null;
  const parent = path.posix.dirname(relative);
  return parent === "." ? "" : normalizeTaskRelativePath(parent);
}

export class WorkspaceFileWatcherService {
  private readonly entries = new Map<string, WorkspaceWatchEntry>();

  constructor(
    private readonly watchFactory: WatchFactory = watch,
    private readonly debounceMs = WATCH_DEBOUNCE_MS,
  ) {}

  subscribe(options: {
    profileKey: string;
    baseDir: string;
    onChange: WorkspaceFileSubscriber;
  }): () => void {
    const baseDir = path.resolve(options.baseDir);
    const key = `${options.profileKey}\0${baseDir}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.createEntry(baseDir);
      this.entries.set(key, entry);
    }
    entry.subscribers.add(options.onChange);

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      const current = this.entries.get(key);
      if (!current) return;
      current.subscribers.delete(options.onChange);
      if (current.subscribers.size > 0) return;
      this.entries.delete(key);
      if (current.flushTimer) clearTimeout(current.flushTimer);
      current.pendingDirectories.clear();
      void current.watcher.close();
    };
  }

  cleanupAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.flushTimer) clearTimeout(entry.flushTimer);
      entry.pendingDirectories.clear();
      void entry.watcher.close();
    }
    this.entries.clear();
  }

  private createEntry(baseDir: string): WorkspaceWatchEntry {
    const entry: WorkspaceWatchEntry = {
      watcher: null as unknown as FSWatcher,
      subscribers: new Set(),
      pendingDirectories: new Set(),
      flushTimer: null,
    };
    const watcher = this.watchFactory(baseDir, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (candidatePath) => shouldIgnoreWorkspaceWatchPath(baseDir, candidatePath),
    });
    entry.watcher = watcher;

    const queueChange = (changedPath: string) => {
      const directory = workspaceDirectoryForFileEvent(baseDir, changedPath);
      if (directory === null) return;
      entry.pendingDirectories.add(directory);
      if (entry.flushTimer) return;
      entry.flushTimer = setTimeout(() => {
        entry.flushTimer = null;
        const directories = [...entry.pendingDirectories];
        entry.pendingDirectories.clear();
        for (const directory of directories) {
          const event: WorkspaceDirectoryChangedEvent = {
            type: "workspace:directory-changed",
            directory,
          };
          for (const subscriber of [...entry.subscribers]) subscriber(event);
        }
      }, this.debounceMs);
    };

    watcher.on("add", queueChange);
    watcher.on("change", queueChange);
    watcher.on("unlink", queueChange);
    watcher.on("addDir", queueChange);
    watcher.on("unlinkDir", queueChange);
    watcher.on("error", (error) => {
      console.warn("[workspace-file-watcher] Watcher error:", error instanceof Error ? error.message : error);
    });
    return entry;
  }
}

export const workspaceFileWatcher = new WorkspaceFileWatcherService();
