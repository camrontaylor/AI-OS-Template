import { watch, type FSWatcher } from "chokidar";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getConfig } from "./config";
import { getDb } from "./db";
import { emitTaskEvent } from "./event-bus";
import type { Task } from "@/types/task";

/**
 * Watches the AI-OS projects/ directory for new files created
 * during a task's execution. Detected files are stored in task_outputs
 * and broadcast via the event bus.
 */
class FileWatcher {
  private watchers = new Map<string, FSWatcher>();
  private taskWatchDirs = new Map<string, string>();

  /**
   * Start watching for output files created by a task.
   * Each task gets its own scoped watcher to prevent misattribution.
   */
  async startWatching(taskId: string, projectSlug?: string | null, clientId?: string | null): Promise<void> {
    if (this.watchers.has(taskId)) {
      return;
    }

    const config = getConfig();
    const baseDir = clientId
      ? path.join(config.agenticOsDir, "clients", clientId)
      : config.agenticOsDir;

    // Scope the watch directory: if the task belongs to a project, watch only that project's folder.
    // Otherwise watch the general projects/ directory.
    let watchDir: string;
    if (projectSlug) {
      watchDir = path.join(baseDir, "projects", "briefs", projectSlug);
    } else {
      watchDir = path.join(baseDir, "projects");
    }

    // Ensure the directory exists before watching
    if (!fs.existsSync(watchDir)) {
      // Fall back to general projects/ if scoped dir doesn't exist
      watchDir = path.join(baseDir, "projects");
      if (!fs.existsSync(watchDir)) {
        console.warn(`[file-watcher] Projects directory does not exist: ${watchDir}`);
        return;
      }
    }

    // Track this task's watch directory to prevent cross-task attribution
    this.taskWatchDirs.set(taskId, watchDir);

    const watcher = watch(watchDir, {
      ignoreInitial: true,
      depth: 5,
      ignored: [
        /(^|[/\\])\./,           // dotfiles
        /node_modules/,           // node_modules
        /\.next/,                 // Next.js build output
        /briefs\/command-centre/, // legacy in-project Command Centre folder
        /\.lock$/,                // lock files
        /tsconfig/,               // TypeScript configs
        /tsbuildinfo$/,           // TS build info
      ],
    });

    watcher.on("add", (filePath: string) => {
      // Only attribute files inside this task's scoped directory
      const normalizedPath = path.resolve(filePath);
      const normalizedWatch = path.resolve(watchDir);
      if (!normalizedPath.startsWith(normalizedWatch)) return;

      this.handleNewFile(taskId, filePath, config.agenticOsDir);
    });

    watcher.on("error", (error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[file-watcher] Error watching for task ${taskId}:`, msg);
    });

    this.watchers.set(taskId, watcher);
  }

  /**
   * Stop watching for a given task.
   */
  async stopWatching(taskId: string): Promise<void> {
    const watcher = this.watchers.get(taskId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(taskId);
    }
    this.taskWatchDirs.delete(taskId);
  }

  /**
   * Close all active watchers. Called on server shutdown.
   */
  cleanupAll(): void {
    for (const [taskId, watcher] of this.watchers) {
      console.log(`[file-watcher] Cleaning up watcher for task ${taskId}`);
      watcher.close().catch(() => {});
    }
    this.watchers.clear();
  }

  private handleNewFile(taskId: string, filePath: string, agenticOsDir: string): void {
    try {
      const fileName = path.basename(filePath);
      const extension = path.extname(filePath).replace(".", "").toLowerCase();

      // Skip source code, config, and extensionless files — track everything else as deliverables.
      // Blocklist approach: any extension NOT in this set is considered a deliverable output.
      const skipExtensions = new Set([
        // Source code
        "ts", "tsx", "js", "jsx", "css", "scss", "less",
        "py", "rb", "go", "rs", "java", "c", "cpp", "h",
        "sh", "bash", "zsh", "sql",
        // Config / build artifacts
        "lock", "map", "d.ts", "tsbuildinfo", "env", "log",
        "gitignore", "eslintrc", "prettierrc",
      ]);

      if (extension === "") {
        console.log(`[file-watcher] Skipping extensionless file: ${fileName}`);
        return;
      }
      if (skipExtensions.has(extension)) {
        console.log(`[file-watcher] Skipping source/config file: ${fileName}`);
        return;
      }

      const stat = fs.statSync(filePath);
      const relativePath = path.relative(agenticOsDir, filePath);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const db = getDb();

      // Deduplicate: skip if this exact file path is already recorded for ANY task.
      // This prevents concurrent watchers (from parallel cron runs) from attributing
      // the same file to multiple tasks.
      const existing = db.prepare(
        "SELECT id FROM task_outputs WHERE filePath = ? LIMIT 1"
      ).get(filePath) as { id: string } | undefined;

      if (existing) {
        console.log(`[file-watcher] Skipping duplicate output ${fileName} (already tracked)`);
        return;
      }

      // Insert into task_outputs
      db.prepare(
        "INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, taskId, fileName, filePath, relativePath, extension, stat.size, now);

      // Fetch fresh task for event emission
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
      if (task) {
        emitTaskEvent({ type: "task:output", task, timestamp: now });
      }
    } catch (err) {
      console.error(`[file-watcher] Error recording file ${filePath} for task ${taskId}:`, err);
    }
  }
}

// Singleton instance
export const fileWatcher = new FileWatcher();
