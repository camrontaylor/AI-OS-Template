import { NextResponse } from "next/server";
import { detectClients, getRootName, getWorkspaceId } from "../../../lib/clients";
import { fetchTeamStatus } from "../../../lib/team-api-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rootName = getRootName();
    const workspaceId = getWorkspaceId();
    const teamStatus = await fetchTeamStatus();

    if (teamStatus.status === "connected") {
      const localClients = detectClients();
      const allowedSlugs = new Set(teamStatus.clients.map((client) => client.slug));
      return NextResponse.json({
        clients: localClients.filter((client) => allowedSlugs.has(client.slug)),
        rootName,
        workspaceId,
        source: "team",
        team: teamStatus.team ?? null,
      });
    }

    if (teamStatus.status === "unavailable" || teamStatus.status === "blocked") {
      return NextResponse.json(
        {
          clients: [],
          rootName,
          workspaceId,
          source: "team",
          error: teamStatus.error,
        },
        { status: teamStatus.status === "blocked" ? 403 : 503 },
      );
    }

    const clients = detectClients();
    return NextResponse.json({ clients, rootName, workspaceId, source: "local" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to detect clients";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
