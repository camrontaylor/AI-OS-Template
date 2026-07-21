import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { getDb } from "@/lib/db";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import type { DashboardSummary } from "@/types/dashboard";
import { parseRoadmap } from "@/lib/gsd-parser";

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
      : getConfig().agenticOsDir;

    const db = getDb();

    // ── User name from USER.md ──────────────────────────────────────────
    let userName: string | null = null;
    const userMdPath = path.join(baseDir, "context", "USER.md");
    if (fs.existsSync(userMdPath)) {
      const userContent = fs.readFileSync(userMdPath, "utf-8");
      const nameMatch = userContent.match(/^- Name:\s*(.+)/m);
      if (nameMatch && nameMatch[1].trim()) {
        userName = nameMatch[1].trim();
      }
    }

    // ── Client filtering ────────────────────────────────────────────────
    const clientCondition = clientId && clientId !== "root"
      ? " AND clientId = ?"
      : "";
    const clientParams = clientId && clientId !== "root" ? [clientId] : [];

    // ── Claude Code real usage from stats-cache.json ────────────────────
    const stats = readClaudeStats();
    const claudeUsage = getClaudeUsage(stats);

    // ── Week task stats from SQLite ─────────────────────────────────────
    const statsRow = db.prepare(
      `SELECT
         COUNT(*) as count,
         COALESCE(SUM(costUsd), 0) as cost
       FROM tasks
       WHERE status = 'done'
         AND completedAt > datetime('now', '-7 days')${clientCondition}`
    ).get(...clientParams) as { count: number; cost: number };

    // ── Session count from memory files ─────────────────────────────────
    const memoryDir = path.join(baseDir, "context", "memory");
    let sessionsCount = 0;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (fs.existsSync(memoryDir)) {
      const memFiles = fs.readdirSync(memoryDir)
        .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
        .filter(f => new Date(f.replace(".md", "")) >= sevenDaysAgo);

      for (const file of memFiles) {
        const content = fs.readFileSync(path.join(memoryDir, file), "utf-8");
        const matches = content.match(/^## Session \d+/gm);
        if (matches) sessionsCount += matches.length;
      }
    }

    // ── Awaiting review (tasks needing attention) ───────────────────────
    const reviewRows = db.prepare(
      `SELECT id, title, status, needsInput, errorMessage
       FROM tasks
       WHERE (status = 'review' OR needsInput = 1 OR errorMessage IS NOT NULL)
         AND status != 'done'${clientCondition}
       ORDER BY updatedAt DESC
       LIMIT 10`
    ).all(...clientParams) as Array<{
      id: string; title: string; status: string;
      needsInput: number; errorMessage: string | null;
    }>;

    const reviewCount = reviewRows.filter(t => t.status === "review").length;
    const needsInputCount = reviewRows.filter(t => t.needsInput === 1).length;
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

        const taskCountRow = db.prepare(
          `SELECT COUNT(*) as count FROM tasks
           WHERE projectSlug = ? AND status != 'done'${clientCondition}`
        ).get(entry.name, ...clientParams) as { count: number };

        // A GSD project (level 3) is active if its own .planning/ exists
        const briefPlanningDir = path.join(briefsDir, entry.name, ".planning");
        const briefHasPlanning =
          fs.existsSync(briefPlanningDir) &&
          fs.existsSync(path.join(briefPlanningDir, "PROJECT.md"));
        const isGsdWithPlanning = level === 3 && briefHasPlanning;

        // For GSD projects, use phase progress instead of brief checkboxes
        let completedItems = checked;
        let totalItems = checked + unchecked;
        if (isGsdWithPlanning) {
          try {
            const roadmapPath = path.join(briefPlanningDir, "ROADMAP.md");
            const phasesDir = path.join(briefPlanningDir, "phases");
            if (fs.existsSync(roadmapPath)) {
              const roadmap = fs.readFileSync(roadmapPath, "utf-8");
              const gsdPhases = parseRoadmap(roadmap, phasesDir);
              totalItems = gsdPhases.length;
              completedItems = gsdPhases.filter((p) => p.status === "complete").length;
            }
          } catch { /* fall back to brief checkboxes */ }
        }

        // Include if: has active board tasks OR is a GSD project with .planning/
        if (taskCountRow.count > 0 || isGsdWithPlanning) {
          activeProjects.push({
            name,
            slug: entry.name,
            level,
            goal,
            completedItems,
            totalItems,
            boardTaskCount: taskCountRow.count,
            hasPlanning: isGsdWithPlanning,
          });
        }
      }
    }

    // ── Recent completed tasks ──────────────────────────────────────────
    const recentRows = db.prepare(
      `SELECT id, title, completedAt, durationMs, costUsd, level
       FROM tasks
       WHERE status = 'done'${clientCondition}
       ORDER BY completedAt DESC
       LIMIT 5`
    ).all(...clientParams) as Array<{
      id: string; title: string; completedAt: string;
      durationMs: number | null; costUsd: number | null; level: string;
    }>;

    // ── Cron health ─────────────────────────────────────────────────────
    const cronJobsDir = path.join(baseDir, "cron", "jobs");
    let cronActive = 0;
    let cronTotal = 0;

    if (fs.existsSync(cronJobsDir)) {
      const cronFiles = fs.readdirSync(cronJobsDir).filter(f => f.endsWith(".md"));
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
    const skillsDir = path.join(baseDir, ".claude", "skills");
    let skillsInstalled = 0;
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      skillsInstalled = entries.filter(
        e => e.isDirectory() && e.name !== "_catalog"
      ).length;
    }

    // ── Brand context file count ────────────────────────────────────────
    const brandDir = path.join(baseDir, "brand_context");
    const brandFiles = ["voice-profile.md", "positioning.md", "icp.md", "samples.md", "assets.md"];
    let brandContextFiles = 0;
    if (fs.existsSync(brandDir)) {
      for (const file of brandFiles) {
        if (fs.existsSync(path.join(brandDir, file))) brandContextFiles++;
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
        tasks: reviewRows.map(t => ({ id: t.id, title: t.title, status: t.status })),
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
    console.error("GET /api/dashboard/summary error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
