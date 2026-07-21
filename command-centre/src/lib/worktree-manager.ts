import { execSync, exec } from "child_process";
import path from "path";
import fs from "fs";
import { getConfig } from "./config";

export interface MergeResult {
  success: boolean;
  conflictingFiles?: string[];
  message: string;
}

/**
 * Manages git worktrees for parallel task execution.
 * Each concurrent task gets its own worktree so they can edit files
 * without conflicting with each other.
 */
class WorktreeManager {
  private worktreeBase: string;

  constructor() {
    const config = getConfig();
    this.worktreeBase = path.join(config.agenticOsDir, ".worktrees");
  }

  /**
   * Create a git worktree for a task.
   * Returns the absolute path to the worktree directory.
   */
  async createWorktree(
    taskId: string,
    baseBranch?: string,
  ): Promise<string> {
    const shortId = taskId.slice(0, 8);
    const branchName = `task/${shortId}`;
    const worktreePath = path.join(this.worktreeBase, shortId);

    // Ensure base directory exists
    if (!fs.existsSync(this.worktreeBase)) {
      fs.mkdirSync(this.worktreeBase, { recursive: true });
    }

    // Clean up if path already exists (stale worktree)
    if (fs.existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: this.getRepoRoot(),
          stdio: "pipe",
        });
      } catch {
        // Force remove the directory
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Delete stale branch if it exists
    try {
      execSync(`git branch -D "${branchName}"`, {
        cwd: this.getRepoRoot(),
        stdio: "pipe",
      });
    } catch {
      // Branch doesn't exist, that's fine
    }

    const base = baseBranch ?? "HEAD";

    execSync(
      `git worktree add "${worktreePath}" -b "${branchName}" ${base}`,
      {
        cwd: this.getRepoRoot(),
        stdio: "pipe",
      },
    );

    return worktreePath;
  }

  /**
   * Merge a task's worktree branch back into the target branch.
   * Returns the merge result with any conflicts.
   */
  async mergeWorktree(
    taskId: string,
    targetBranch?: string,
  ): Promise<MergeResult> {
    const shortId = taskId.slice(0, 8);
    const branchName = `task/${shortId}`;
    const repoRoot = this.getRepoRoot();
    const target = targetBranch ?? this.getCurrentBranch();

    try {
      // Check if the branch has any commits ahead of target
      const diffOutput = execSync(
        `git log "${target}..${branchName}" --oneline`,
        { cwd: repoRoot, stdio: "pipe" },
      ).toString().trim();

      if (!diffOutput) {
        return { success: true, message: "No changes to merge" };
      }

      // Try the merge
      execSync(`git checkout "${target}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });

      execSync(`git merge "${branchName}" --no-edit`, {
        cwd: repoRoot,
        stdio: "pipe",
      });

      return {
        success: true,
        message: `Merged ${branchName} into ${target} cleanly`,
      };
    } catch (error) {
      // Check for merge conflicts
      try {
        const conflictOutput = execSync("git diff --name-only --diff-filter=U", {
          cwd: repoRoot,
          stdio: "pipe",
        }).toString().trim();

        const conflictingFiles = conflictOutput
          ? conflictOutput.split("\n").filter(Boolean)
          : [];

        if (conflictingFiles.length > 0) {
          // Abort the merge — let the user resolve
          execSync("git merge --abort", {
            cwd: repoRoot,
            stdio: "pipe",
          });

          return {
            success: false,
            conflictingFiles,
            message: `Merge conflicts in ${conflictingFiles.length} file(s)`,
          };
        }
      } catch {
        // Can't determine conflict state
      }

      return {
        success: false,
        message: `Merge failed: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }

  /**
   * Remove a worktree and its branch.
   */
  async cleanupWorktree(taskId: string): Promise<void> {
    const shortId = taskId.slice(0, 8);
    const branchName = `task/${shortId}`;
    const worktreePath = path.join(this.worktreeBase, shortId);
    const repoRoot = this.getRepoRoot();

    // Remove worktree
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } catch {
      // May already be removed — clean up directory manually
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Prune worktree references
    try {
      execSync("git worktree prune", {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } catch {
      // Non-critical
    }

    // Delete the branch
    try {
      execSync(`git branch -D "${branchName}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
    } catch {
      // Branch may already be gone
    }
  }

  /**
   * Check if overlapping files might be modified by multiple tasks.
   * Returns list of potentially conflicting paths.
   */
  async checkOverlap(
    taskPlans: Array<{ taskId: string; paths: string[] }>,
  ): Promise<string[]> {
    const pathCount = new Map<string, number>();
    for (const plan of taskPlans) {
      for (const p of plan.paths) {
        pathCount.set(p, (pathCount.get(p) ?? 0) + 1);
      }
    }
    return Array.from(pathCount.entries())
      .filter(([, count]) => count > 1)
      .map(([p]) => p);
  }

  /**
   * Get the worktree path for a task (whether or not it exists).
   */
  getWorktreePath(taskId: string): string {
    const shortId = taskId.slice(0, 8);
    return path.join(this.worktreeBase, shortId);
  }

  /**
   * Get the branch name for a task's worktree.
   */
  getWorktreeBranch(taskId: string): string {
    const shortId = taskId.slice(0, 8);
    return `task/${shortId}`;
  }

  /**
   * List all active worktrees.
   */
  listWorktrees(): Array<{ path: string; branch: string }> {
    try {
      const output = execSync("git worktree list --porcelain", {
        cwd: this.getRepoRoot(),
        stdio: "pipe",
      }).toString();

      const worktrees: Array<{ path: string; branch: string }> = [];
      let currentPath = "";
      let currentBranch = "";

      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
          currentPath = line.slice(9);
        } else if (line.startsWith("branch ")) {
          currentBranch = line.slice(7).replace("refs/heads/", "");
        } else if (line === "") {
          if (currentPath && currentBranch.startsWith("task/")) {
            worktrees.push({ path: currentPath, branch: currentBranch });
          }
          currentPath = "";
          currentBranch = "";
        }
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  private getRepoRoot(): string {
    const config = getConfig();
    return config.agenticOsDir;
  }

  private getCurrentBranch(): string {
    try {
      return execSync("git branch --show-current", {
        cwd: this.getRepoRoot(),
        stdio: "pipe",
      }).toString().trim();
    } catch {
      return "dev";
    }
  }
}

// Singleton
export const worktreeManager = new WorktreeManager();
