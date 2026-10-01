import { NextRequest, NextResponse } from "next/server";
import { resolveLocalProfileDescriptor } from "@/lib/local-profile";
import { loadPromptTags, type PromptTagTrustMode } from "@/lib/prompt-tags";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  let trustMode: PromptTagTrustMode;
  try {
    trustMode = resolveLocalProfileDescriptor().mode === "team" ? "team" : "solo";
  } catch {
    return NextResponse.json({ tags: [] });
  }
  const tags = loadPromptTags(clientId, trustMode);
  return NextResponse.json({ tags });
}
