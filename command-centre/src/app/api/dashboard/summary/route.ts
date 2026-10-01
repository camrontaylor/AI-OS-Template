import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { getActiveLocalProfileDescriptor, getDb } from "@/lib/db";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import type { DashboardSummary } from "@/types/dashboard";
import type { Task } from "@/types/task";
import { parseRoadmap } from "@/lib/gsd-parser";
import { getVisibleEditedTasks } from "@/lib/task-branch-ui";
import { isWorkScopeError, normalizeWorkScopedRow, workScopeErrorBody } from "@/lib/identity/work-scope";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";
import { listSkillFolderNames, readClientHiddenSkills } from "@/lib/skill-catalog";

interface StatsCache {
  lastComputedDate?: string;
  dailyActivity?: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  }>;
  dailyModelTokens?: Array<{
    date: string;
    tokensByModel: Record<string, number>;
  }>;
  totalSessions?: number;
  totalMessages?: number;
}

function readClaudeStats(): StatsCache | null {
  const statsPath = path.join(os.homedir(), ".claude", "stats-cache.json");
  if (!fs.existsSync(statsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statsPath, "utf-8"));
  } catch {
    return null;
  }
}

function getClaudeUsage(stats: StatsCache | null) {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekStart = sevenDaysAgo.toISOString().slice(0, 10);

  // Month start (1st of current month)
  const monthStart = today.slice(0, 7) + "-01";

  let todayTokens = 0;
  let weekTokens = 0;
  let monthTokens = 0;
  let todaySessions = 0;
  let weekSessions = 0;
  let todayMessages = 0;
  let weekMessages = 0;
  const weekModelTokens: Record<string, number> = {};

  if (stats?.dailyActivity) {
    for (const day of stats.dailyActivity) {
      if (day.date === today) {
        todaySessions = day.sessionCount;
        todayMessages = day.messageCount;
      }
      if (day.date >= weekStart) {
        weekSessions += day.sessionCount;
        weekMessages += day.messageCount;
      }
    }
  }

  if (stats?.dailyModelTokens) {
    for (const day of stats.dailyModelTokens) {
      const dayTotal = Object.values(day.tokensByModel).reduce((a, b) => a + b, 0);
      if (day.date === today) {
        todayTokens = dayTotal;
      }
      if (day.date >= weekStart) {
        weekTokens += dayTotal;
        for (const [model, tokens] of Object.entries(day.tokensByModel)) {
          weekModelTokens[model] = (weekModelTokens[model] || 0) + tokens;
        }
      }
      if (day.date >= monthStart) {
        monthTokens += dayTotal;
      }
    }
  }

  const byModel = Object.entries(weekModelTokens)
    .map(([model, tokens]) => ({
      model: model.replace(/^claude-/, "").replace(/-\d{8}$/, ""),
      tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  // Daily token budget from env — only show percentage when explicitly configured
  const budgetEnv = process.env.CLAUDE_DAILY_TOKEN_BUDGET;
  const dailyTokenBudget = budgetEnv ? parseInt(budgetEnv, 10) : 0;

  // When stats were last refreshed (updates at end of Claude sessions)
  const lastUpdated = stats?.lastComputedDate as string | undefined ?? null;

  return { todayTokens, weekTokens, monthTokens, todaySessions, weekSessions, todayMessages, weekMessages, byModel, dailyTokenBudget, lastUpdated };
}

export async function GET(request: NextRequest) {
  try {
    const clientId = request.nextUrl.searchParams.get("clientId");
    const baseDir = clientId && clientId !== "root"
      ? getClientAiOsDir(clientId)
      : getConfig().aiOsDir;

    const db = getDb();
    const activeProfile = getActiveLocalProfileDescriptor();
    const isSolo = activeProfile.mode === "solo";

    // ── User name from USER.md ──────────────────────────────────────────
    let userName: string | null = null;
    const userMdPath = path.join(baseDir, "context", "USER.md");
    if (isSolo && fs.existsSync(userMdPath) && isMaterializedPathAccessible(userMdPath)) {
      const userContent = fs.readFileSync(userMdPath, "utf-8");
      const nameMatch = userContent.match(/^- Name:\s*(.+)/m);
      if (nameMatch && nameMatch[1].trim()) {
        userName = nameMatch[1].trim();
      }
    }

    // ── Client filtering ────────────────────────────────────────────────
    const clientCondition = clientId === "root"
      ? " AND clientId IS NULL"
      : clientId ? " AND clientId = ?" : "";
    const clientParams = clientId && clientId !== "root" ? [clientId] : [];
    const taskRows = db
      .prepare(`SELECT * FROM tasks WHERE 1 = 1${clientCondition}`)
      .all(...clientParams) as Array<Task & { workScope: string | null }>;
    const visibleTasks = getVisibleEditedTasks(
      taskRows.map((task) => ({ ...normalizeWorkScopedRow(task), needsInput: Boolean(task.needsInput) })),
    );

    // ── Claude Code real usage from stats-cache.json ────────────────────
    const stats = isSolo ? readClaudeStats() : null;
    const claudeUsage = getClaudeUsage(stats);

    // ── Week task stats from SQLite ─────────────────────────────────────
    const taskStatsCutoff = new Date();
    taskStatsCutoff.setDate(taskStatsCutoff.getDate() - 7);
    const completedThisWeek = visibleTasks.filter((task) => {
      if (task.status !== "done" || !task.completedAt) return false;
      const completedAt = new Date(task.completedAt).getTime();
      return Number.isFinite(completedAt) && completedAt > taskStatsCutoff.getTime();
    });
    const statsRow = {
      count: completedThisWeek.length,
      cost: completedThisWeek.reduce((sum, task) => sum + (task.costUsd ?? 0), 0),
    };

    // ── Session count from memory files ─────────────────────────────────
    const memoryDir = path.join(baseDir, "context", "memory");
    let sessionsCount = 0;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (isSolo && fs.existsSync(memoryDir)) {
      const memFiles = fs.readdirSync(memoryDir)
        .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
        .filter(f => new Date(f.replace(".md", "")) >= sevenDaysAgo);

      for (const file of memFiles) {
        const memoryPath = path.join(memoryDir, file);
        if (!isMaterializedPathAccessible(memoryPath)) continue;
        const content = fs.readFileSync(memoryPath, "utf-8");
        const matches = content.match(/^## Session \d+/gm);
        if (matches) sessionsCount += matches.length;
      }
    }

    // ── Awaiting review (tasks needing attention) ───────────────────────
    const reviewRows = visibleTasks
      .filter((task) =>
        task.status !== "done" &&
        (task.status === "review" || task.needsInput === true || task.errorMessage !== null)
      )
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const reviewCount = reviewRows.filter(t => t.status === "review").length;
    const needsInputCount = reviewRows.filter(t => t.needsInput === true).length;
    const errorCount = reviewRows.filter(t => t.errorMessage !== null && t.status !== "review").length;

    // ── Active projects ─────────────────────────────────────────────────
    const briefsDir = path.join(baseDir, "projects", "briefs");
    const activeProjects: DashboardSummary["activeProjects"] = [];

    if (fs.existsSync(briefsDir)) {
      const entries = fs.readdirSync(briefsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const briefPath = path.join(briefsDir, entry.name, "brief.md");
        if (!fs.existsSync(briefPath)) continue;
        if (!isMaterializedPathAccessible(briefPath)) continue;

        const content = fs.readFileSync(briefPath, "utf-8");
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;

        const fm = fmMatch[1];
        if (!fm.includes("status: active")) continue;

        const levelMatch = fm.match(/level:\s*(\d+)/);
        const level = levelMatch ? parseInt(levelMatch[1], 10) : 2;

        const nameMatch = fm.match(/project:\s*(.+)/);
        const name = nameMatch
          ? nameMatch[1].trim()
          : entry.name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

        const goalMatch = content.match(/## Goal\s*\n+(.+)/);
        const goal = goalMatch ? goalMatch[1].trim() : "";

        const checked = (content.match(/- \[x\]/gi) || []).length;
        const unchecked = (content.match(/- \[ \]/g) || []).length;

        const boardTaskCount = visibleTasks.filter(
          (task) => task.projectSlug === entry.name && task.status !== "done",
        ).length;

        // A GSD project (level 3) is active if its own .planning/ exists
        const briefPlanningDir = path.join(briefsDir, entry.name, ".planning");
        const briefHasPlanning =
          fs.existsSync(briefPlanningDir) &&
          fs.existsSync(path.join(briefPlanningDir, "PROJECT.md")) &&
          isMaterializedPathAccessible(path.join(briefPlanningDir, "PROJECT.md"));
        const isGsdWithPlanning = level === 3 && briefHasPlanning;

        // For GSD projects, use phase progress instead of brief checkboxes
        let completedItems = checked;
        let totalItems = checked + unchecked;
        if (isGsdWithPlanning) {
          try {
            const roadmapPath = path.join(briefPlanningDir, "ROADMAP.md");
            const phasesDir = path.join(briefPlanningDir, "phases");
            if (fs.existsSync(roadmapPath) && isMaterializedPathAccessible(roadmapPath)) {
              const roadmap = fs.readFileSync(roadmapPath, "utf-8");
              const gsdPhases = parseRoadmap(roadmap, phasesDir);
              totalItems = gsdPhases.length;
              completedItems = gsdPhases.filter((p) => p.status === "complete").length;
            }
          } catch { /* fall back to brief checkboxes */ }
        }

        // Include if: has active board tasks OR is a GSD project with .planning/
        if (boardTaskCount > 0 || isGsdWithPlanning) {
          activeProjects.push({
            name,
            slug: entry.name,
            level,
            goal,
            completedItems,
            totalItems,
            boardTaskCount,
            hasPlanning: isGsdWithPlanning,
          });
        }
      }
    }

    // ── Recent completed tasks ──────────────────────────────────────────
    const recentRows = visibleTasks
      .filter((task) => task.status === "done")
      .sort((a, b) => new Date(b.completedAt ?? b.updatedAt).getTime() - new Date(a.completedAt ?? a.updatedAt).getTime())
      .slice(0, 5)
      .map((task) => ({
        id: task.id,
        title: task.title,
        completedAt: task.completedAt ?? task.updatedAt,
        durationMs: task.durationMs,
        costUsd: task.costUsd,
        level: task.level,
      }));

    // ── Cron health ─────────────────────────────────────────────────────
    const cronJobsDir = path.join(baseDir, "cron", "jobs");
    let cronActive = 0;
    let cronTotal = 0;

    if (fs.existsSync(cronJobsDir)) {
      const cronFiles = fs.readdirSync(cronJobsDir)
        .filter(f => f.endsWith(".md"))
        .filter(f => isMaterializedPathAccessible(path.join(cronJobsDir, f)));
      cronTotal = cronFiles.length;
      for (const file of cronFiles) {
        const content = fs.readFileSync(path.join(cronJobsDir, file), "utf-8");
        // Cron jobs use active: "true" or active: true in frontmatter
        if (/active:\s*"?true"?/i.test(content)) cronActive++;
      }
    }

    let cronLastRun: DashboardSummary["system"]["cronLastRun"] = null;
    const cronStatusDir = path.join(baseDir, "cron", "status");
    if (fs.existsSync(cronStatusDir)) {
      const statusFiles = fs.readdirSync(cronStatusDir).filter(f => f.endsWith(".json"));
      let latestTime = "";
      for (const file of statusFiles) {
        try {
          const slug = file.replace(/\.json$/, "");
          const jobPath = path.join(cronJobsDir, `${slug}.md`);
          if (!fs.existsSync(jobPath) || !isMaterializedPathAccessible(jobPath)) continue;
          const raw = fs.readFileSync(path.join(cronStatusDir, file), "utf-8");
          const status = JSON.parse(raw);
          const time = status.last_run || status.lastRun || status.completedAt || "";
          if (time > latestTime) {
            latestTime = time;
            cronLastRun = {
              jobName: file.replace(".json", ""),
              time,
              result: status.result || status.status || "unknown",
            };
          }
        } catch { /* skip */ }
      }
    }

    // ── Skills count ────────────────────────────────────────────────────
    // A client workspace no longer carries copies of the root skills: Claude Code
    // resolves them from the repository root, and the client folder only holds
    // client-owned skills. The count a client sees is therefore the union of root
    // skills and client-only skills, deduped by folder name — the same merge
    // `skill-catalog.ts` performs for the skills page.
    const rootSkillsDir = path.join(getConfig().aiOsDir, ".claude", "skills");
    const skillFolders = new Set(
      listSkillFolderNames(rootSkillsDir, isMaterializedPathAccessible),
    );
    if (clientId && clientId !== "root") {
      for (const folderName of listSkillFolderNames(
        path.join(baseDir, ".claude", "skills"),
        isMaterializedPathAccessible,
      )) {
        skillFolders.add(folderName);
      }
      // Skills this client turned off via skillOverrides are not part of
      // what it sees, so they do not count.
      for (const hiddenName of readClientHiddenSkills(baseDir)) {
        skillFolders.delete(hiddenName);
      }
    }
    const skillsInstalled = skillFolders.size;

    // ── Brand context file count ────────────────────────────────────────
    const brandDir = path.join(baseDir, "brand_context");
    const brandFiles = ["voice-profile.md", "positioning.md", "icp.md", "samples.md", "assets.md"];
    let brandContextFiles = 0;
    if (fs.existsSync(brandDir)) {
      for (const file of brandFiles) {
        const brandPath = path.join(brandDir, file);
        if (fs.existsSync(brandPath) && isMaterializedPathAccessible(brandPath)) brandContextFiles++;
      }
    }

    // ── Assemble response ───────────────────────────────────────────────
    const summary: DashboardSummary = {
      userName,
      weekStats: {
        sessionsCount: Math.max(sessionsCount, claudeUsage.weekSessions),
        messagesCount: claudeUsage.weekMessages,
        tasksCompleted: statsRow.count,
        totalCostUsd: statsRow.cost,
      },
      claudeUsage,
      awaitingReview: {
        reviewCount,
        needsInputCount,
        errorCount,
        tasks: reviewRows.slice(0, 10).map(t => ({ id: t.id, title: t.title, status: t.status })),
      },
      activeProjects,
      recentTasks: recentRows,
      system: {
        cronActive,
        cronTotal,
        cronLastRun,
        skillsInstalled,
        brandContextFiles,
      },
    };

    return NextResponse.json(summary);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/dashboard/summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
