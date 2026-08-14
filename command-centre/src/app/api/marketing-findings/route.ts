import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readMarketingAnalyticsSnapshot } from "@/lib/marketing-analytics-source.server";
import {
  getMarketingFindingsSummary,
  listMarketingFindings,
  syncMarketingFindingsFromSnapshot,
  type MarketingFindingListOptions,
  type MarketingFindingStatus,
} from "@/lib/marketing-findings";

const validStatuses: MarketingFindingStatus[] = [
  "open",
  "materialized",
  "blocked",
  "verified",
  "consumed",
  "dismissed",
];

function normalizeStatus(value: string | null): MarketingFindingStatus | undefined {
  if (!value) return undefined;
  return validStatuses.includes(value as MarketingFindingStatus)
    ? (value as MarketingFindingStatus)
    : undefined;
}

function normalizeLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(500, Math.floor(parsed));
}

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const snapshot = readMarketingAnalyticsSnapshot();
    const sync = syncMarketingFindingsFromSnapshot(db, snapshot);
    const searchParams = request.nextUrl.searchParams;
    const options: MarketingFindingListOptions = {
      status: normalizeStatus(searchParams.get("status")),
      channel: searchParams.get("channel") || undefined,
      source: searchParams.get("source") || undefined,
      clientId: searchParams.has("clientId") ? searchParams.get("clientId") : undefined,
      since: searchParams.get("since") || undefined,
      unconsumedOnly: searchParams.get("unconsumedOnly") === "true",
      limit: normalizeLimit(searchParams.get("limit")),
    };
    const findings = listMarketingFindings(db, options);
    const summaryFindings = listMarketingFindings(db, {
      ...options,
      limit: 500,
    });

    return NextResponse.json({
      findings,
      summary: getMarketingFindingsSummary(summaryFindings),
      sync: {
        inserted: sync.inserted,
        updated: sync.updated,
      },
      sources: snapshot.sources,
    });
  } catch (error) {
    if (error instanceof Error && /source files are missing/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("GET /api/marketing-findings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
