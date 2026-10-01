/**
 * Memory — live sync.
 *
 * Watches the memory source roots (chokidar) and reindexes as soon as a change
 * lands on disk, covering files edited, deleted, or moved outside a Claude session.
 *
 * Does not hold a MemoryStore open: PGLite enforces single-process exclusive
 * access, so a long-lived handle would lock out the Stop hook and CLIs. Each
 * cycle opens the store, runs the idempotent pipeline, and closes immediately.
 * The embedder is kept resident across cycles since it is expensive to load.
 */

import { watch, type FSWatcher } from "chokidar";
import path from "node:path";

import { openMemoryStore } from "./store";
import type { Embedder } from "./embedder";
import { refreshIndex } from "./capture";
import { deleteSource } from "./ingest";
import { isIndexable, DEFAULT_SOURCE_ROOTS } from "./discovery";
import type { Scope } from "./types";

export interface MemoryWatcherOptions {
  embedder: Embedder;
  scope: Scope;
  /** AI-OS workspace root. */
  rootDir: string;
  /** Source roots (relative to rootDir). Defaults to the discovery defaults. */
  roots?: string[];
  /** Persisted PGLite data directory, opened/closed fresh for each cycle. */
  dataDir: string;
  /** Debounce window for add/change events. Default 2000ms. */
  debounceMs?: number;
  /** Progress/error logger. Silent (no-op) when omitted. */
  log?: (msg: string) => void;
}

export interface MemoryWatcher {
  /**
   * Resolves once chokidar's initial scan finishes. Await before making changes
   * that must fire as events rather than be folded into the initial scan.
   */
  ready(): Promise<void>;
  /** Stop watching, draining any in-flight reindex/delete cycle first. */
  close(): Promise<void>;
}

/** Start watching the memory source roots for live reindexing. */
export function startMemoryWatcher(opts: MemoryWatcherOptions): MemoryWatcher {
  const roots = opts.roots ?? [...DEFAULT_SOURCE_ROOTS];
  const debounceMs = opts.debounceMs ?? 2000;
  const log = opts.log ?? (() => {});
  const absRoots = roots.map((root) => path.join(opts.rootDir, root));
  const embedDim = opts.embedder.dim;

  // Serialize every store-touching cycle through one chain so two events firing
  // close together never open two store handles at once from this process.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>): void => {
    chain = chain.then(fn).catch((error) => {
      log(`memory-watcher: error: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      enqueue(runRefresh);
    }, debounceMs);
  };

  async function runRefresh(): Promise<void> {
    const store = await openMemoryStore({ dataDir: opts.dataDir, embedDim });
    try {
      const { summary, skipped } = await refreshIndex({
        store,
        embedder: opts.embedder,
        scope: opts.scope,
        rootDir: opts.rootDir,
        roots,
        reason: "file_change",
        debounceMs: 0,
      });
      if (skipped) {
        log(`memory-watcher: refresh ${skipped}`);
      } else if (summary) {
        log(
          `memory-watcher: indexed ${summary.sourcesIndexed} source(s), ` +
            `+${summary.chunksInserted} chunk(s)${summary.chunksPruned ? `, pruned ${summary.chunksPruned}` : ""}`,
        );
      }
    } finally {
      await store.close();
    }
  }

  async function runDelete(absPath: string): Promise<void> {
    const sourcePath = toSourcePath(opts.rootDir, absPath);
    const store = await openMemoryStore({ dataDir: opts.dataDir, embedDim });
    try {
      const result = await deleteSource(store, opts.scope, sourcePath);
      if (result.deleted) log(`memory-watcher: removed ${sourcePath}`);
    } finally {
      await store.close();
    }
  }

  /** Defensive: covers the case where only a dir-level event fires for a removed folder. */
  async function runDeleteDir(absDir: string): Promise<void> {
    const prefix = toSourcePath(opts.rootDir, absDir);
    const store = await openMemoryStore({ dataDir: opts.dataDir, embedDim });
    try {
      const { rows } = await store.client.query<{ source_path: string }>(
        `SELECT source_path FROM memory_sources
          WHERE source_path LIKE $1
            AND visibility = $2
            AND COALESCE(team_id, '')   = COALESCE($3, '')
            AND COALESCE(client_id, '') = COALESCE($4, '')
            AND COALESCE(user_id, '')   = COALESCE($5, '')`,
        [
          `${prefix}/%`,
          opts.scope.visibility,
          opts.scope.teamId,
          opts.scope.clientId,
          opts.scope.userId,
        ],
      );
      for (const row of rows) {
        const result = await deleteSource(store, opts.scope, row.source_path);
        if (result.deleted) log(`memory-watcher: removed ${row.source_path}`);
      }
    } finally {
      await store.close();
    }
  }

  const watcher: FSWatcher = watch(absRoots, {
    ignoreInitial: true,
    ignored: [/(^|[/\\])\./, /node_modules/],
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  });

  watcher.on("add", (absPath: string) => {
    if (isIndexable(absPath)) scheduleRefresh();
  });
  watcher.on("change", (absPath: string) => {
    if (isIndexable(absPath)) scheduleRefresh();
  });
  watcher.on("unlink", (absPath: string) => {
    enqueue(() => runDelete(absPath));
  });
  watcher.on("unlinkDir", (absDir: string) => {
    enqueue(() => runDeleteDir(absDir));
  });
  watcher.on("error", (error: unknown) => {
    log(`memory-watcher: error: ${error instanceof Error ? error.message : String(error)}`);
  });

  const readyPromise = new Promise<void>((resolve) => watcher.on("ready", () => resolve()));

  return {
    ready(): Promise<void> {
      return readyPromise;
    },
    async close(): Promise<void> {
      if (debounceTimer) clearTimeout(debounceTimer);
      await watcher.close();
      await chain.catch(() => {});
    },
  };
}

function toSourcePath(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}
