import { NextResponse } from "next/server";
import { getClaudeCapabilities } from "@/lib/claude-capabilities.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const capabilities = await getClaudeCapabilities();
  return NextResponse.json(capabilities, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
