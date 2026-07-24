import { NextRequest, NextResponse } from "next/server";
import { listAssets } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("project");
  if (!name) return NextResponse.json({ error: "project required" }, { status: 400 });
  try {
    return NextResponse.json(listAssets(name));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
