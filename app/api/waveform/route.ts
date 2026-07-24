import { NextRequest, NextResponse } from "next/server";
import { computeWaveform } from "@/lib/server/beats-analyze-server";

export const dynamic = "force-dynamic";

/** 曲の見取り図（波形ピーク列）。結果は素直に毎回計算（22kHzモノラルなので数百ms） */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const file = req.nextUrl.searchParams.get("file");
  if (!project || !file) {
    return NextResponse.json({ error: "project & file required" }, { status: 400 });
  }
  try {
    const wf = await computeWaveform(project, file);
    return NextResponse.json(wf);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
