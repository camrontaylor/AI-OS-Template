import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const baseDir = clientId ? getClientAiOsDir(clientId) : getConfig().aiOsDir;
    const brandDir = path.join(baseDir, "brand_context");

    const checkFile = (name: string): boolean => {
      const filePath = path.join(brandDir, name);
      try {
        if (!isMaterializedPathAccessible(filePath)) return false;
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size === 0) return false;
        const content = fs.readFileSync(filePath, "utf-8").trim();
        return content.length > 0;
      } catch {
        return false;
      }
    };

    const voiceProfile = checkFile("voice-profile.md");
    const positioning = checkFile("positioning.md");
    const icp = checkFile("icp.md");

    return NextResponse.json({
      hasBrandContext: voiceProfile,
      files: { voiceProfile, positioning, icp },
    });
  } catch (error) {
    console.error("GET /api/context/brand error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
