import { NextRequest, NextResponse } from "next/server";

import {
  LocalProfileLockedError,
  localProfileErrorBody,
  resolveLocalProfileDescriptor,
} from "@/lib/local-profile";
import {
  assertLocalProfileRequest,
  LocalProfileRequestError,
  localProfileRequestErrorBody,
} from "@/lib/local-profile-lifecycle";

const PROFILE_RECOVERY_ROUTES = new Set([
  "/api/team/session",
  "/api/team/status",
]);

function isUnauthenticatedRecoveryRequest(request: NextRequest): boolean {
  if (request.nextUrl.pathname === "/api/team/status") return true;
  return request.nextUrl.pathname === "/api/team/session" && request.method === "POST";
}

export function proxy(request: NextRequest): NextResponse {
  if (PROFILE_RECOVERY_ROUTES.has(request.nextUrl.pathname) && isUnauthenticatedRecoveryRequest(request)) {
    return NextResponse.next();
  }
  try {
    const descriptor = resolveLocalProfileDescriptor();
    assertLocalProfileRequest(descriptor, request.headers);
    return NextResponse.next();
  } catch (error) {
    if (error instanceof LocalProfileRequestError) {
      return NextResponse.json(localProfileRequestErrorBody(error), { status: error.status });
    }
    if (error instanceof LocalProfileLockedError) {
      return NextResponse.json(localProfileErrorBody(error), { status: error.status });
    }
    throw error;
  }
}

export const config = {
  matcher: [
    "/api",
    "/api/((?!events/?$).*)",
  ],
};
