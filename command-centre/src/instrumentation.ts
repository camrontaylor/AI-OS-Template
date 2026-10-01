/**
 * Next.js instrumentation hook.
 * Runs once on server startup. Used to initialize the queue watcher
 * which auto-executes tasks when they enter 'queued' status.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run on the server (Node.js runtime), not during build or in edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("./lib/config");
    const { LocalProfileLockedError, resolveLocalProfileDescriptor } = await import("./lib/local-profile");
    const { LocalProfileRequestError } = await import("./lib/local-profile-lifecycle");
    const { recoverLocalProfileCleanup } = await import("./lib/profile-shutdown-coordinator");
    try {
      const profile = resolveLocalProfileDescriptor();
      await recoverLocalProfileCleanup(profile, getConfig().aiOsDir);
    } catch (error) {
      if (error instanceof LocalProfileLockedError || error instanceof LocalProfileRequestError) {
        console.warn(
          "[local-profile] Local profile unavailable; background work is paused.",
          error.message,
        );
      } else {
        console.warn("[local-profile] Startup cleanup remains pending.", error instanceof Error ? error.message : error);
      }
    }

    const { initQueueWatcher } = await import("./lib/queue-watcher");
    initQueueWatcher();

    // Start the in-process cron scheduler used while the Command Centre is running.
    const { initCronScheduler } = await import("./lib/cron-scheduler");
    initCronScheduler();

    // Write port file so hooks can discover the command centre
    const fs = await import("fs");
    const path = await import("path");
    const port = process.env.PORT || "3000";
    const portDir = path.default.join(getConfig().aiOsDir, ".command-centre");
    fs.default.mkdirSync(portDir, { recursive: true });
    fs.default.writeFileSync(path.default.join(portDir, "port"), port);

    // Clean up file watchers on shutdown
    const { fileWatcher } = await import("./lib/file-watcher");
    const { workspaceFileWatcher } = await import("./lib/workspace-file-watcher");
    const cleanupFileWatchers = () => {
      fileWatcher.cleanupAll();
      workspaceFileWatcher.cleanupAll();
    };
    process.on("exit", cleanupFileWatchers);
    process.on("SIGTERM", cleanupFileWatchers);
    process.on("SIGINT", cleanupFileWatchers);
  }
}
