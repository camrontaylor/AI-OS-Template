import { NextRequest, NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { fetchTeamSecretsForSync } from "@/lib/team-api-context";
import { syncTeamSecretsToManagedEnv } from "@/lib/team-secrets-env";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const client = typeof body.client === "string" ? body.client : null;
    const overwriteConflicts = body.overwriteConflicts === true;
    const payload = await fetchTeamSecretsForSync(client);
    const result = await syncTeamSecretsToManagedEnv(getConfig().aiOsDir, payload, {
      overwriteConflicts,
    });
    if (result.conflicts.length > 0) {
      return NextResponse.json(
        {
          error: "Local .env has user-owned values for synced keys.",
          conflicts: result.conflicts.map((conflict) => ({
            filePath: conflict.filePath,
            label: conflict.label,
            keys: conflict.keys,
          })),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      filesChanged: result.filesChanged,
      files: result.files.map((file) => ({
        filePath: file.filePath,
        label: file.label,
        keys: file.keys,
        changed: file.changed,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Team secret sync failed" },
      { status: 400 },
    );
  }
}
