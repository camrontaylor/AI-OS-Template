const { execSync, spawnSync } = require("child_process");

const port = String(process.env.PORT || "3000");

function killPortOnWindows(targetPort) {
  let output = "";

  try {
    output = execSync("netstat -ano -p tcp", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    output = error.stdout?.toString() || "";
  }

  const pids = new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(`:${targetPort}`) && line.includes("LISTENING"))
      .map((line) => line.split(/\s+/).at(-1))
      .filter((pid) => pid && /^\d+$/.test(pid) && pid !== "0")
  );

  for (const pid of pids) {
    spawnSync("taskkill", ["/F", "/PID", pid], {
      stdio: "ignore",
    });
  }

  if (pids.size > 0) {
    console.log(`[predev] Freed port ${targetPort} by stopping PID(s): ${[...pids].join(", ")}`);
  }
}

function killPortOnUnix(targetPort) {
  let pids = [];

  try {
    const output = execSync(`lsof -ti :${targetPort}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (output) {
      pids = output.split(/\r?\n/).filter(Boolean);
    }
  } catch {
    return;
  }

  if (pids.length === 0) {
    return;
  }

  spawnSync("kill", ["-9", ...pids], {
    stdio: "ignore",
  });

  console.log(`[predev] Freed port ${targetPort} by stopping PID(s): ${pids.join(", ")}`);
}

if (process.platform === "win32") {
  killPortOnWindows(port);
} else {
  killPortOnUnix(port);
}
