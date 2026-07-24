import { NextRequest, NextResponse } from "next/server";
import { searchVoices } from "@/lib/server/fish-server";

export const dynamic = "force-dynamic";

/** Fishマーケットプレイスの声モデル検索（日本語対応のみ） */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q required" }, { status: 400 });
  }
  try {
    const voices = await searchVoices(q);
    return NextResponse.json({ voices });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
