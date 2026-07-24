import { NextRequest, NextResponse } from "next/server";
import { renderThumbnail } from "@/lib/server/render-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 現在フレームの静止画書き出し（YouTubeサムネ等）。{project, frame} → {file} */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { project: string; frame: number };
  if (!body.project || typeof body.frame !== "number") {
    return NextResponse.json({ error: "project & frame required" }, { status: 400 });
  }
  try {
    const file = await renderThumbnail({
      projectName: body.project,
      assetBase: req.nextUrl.origin,
      frame: Math.round(body.frame),
    });
    return NextResponse.json({ ok: true, file });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
