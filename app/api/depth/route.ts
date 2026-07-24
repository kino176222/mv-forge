import { NextRequest, NextResponse } from "next/server";
import { generateDepth } from "@/lib/server/depth-server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** 深度マップ生成。{project, image} → images/<名前>.depth.png */
export async function POST(req: NextRequest) {
  const { project, image } = (await req.json()) as {
    project: string;
    image: string;
  };
  if (!project || !image) {
    return NextResponse.json({ error: "project & image required" }, { status: 400 });
  }
  try {
    const depthFile = await generateDepth(project, image);
    return NextResponse.json({ ok: true, depthFile });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
