import { NextResponse } from "next/server";

import { TeamApiError } from "@/lib/team-api-context";

export function companyRouteError(error: unknown, fallback: string) {
  const status = error instanceof TeamApiError ? error.status : 500;
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
      ...(error instanceof TeamApiError ? { code: error.code } : {}),
    },
    { status },
  );
}
