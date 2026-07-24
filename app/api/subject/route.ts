import { NextRequest, NextResponse } from "next/server";
import { generateSubject } from "@/lib/server/subject-server";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** 人物切り抜き生成。{project, image} → images/<名前>.subject.png（透過PNG） */
export async function POST(req: NextRequest) {
  const { project, image } = (await req.json()) as {
    project: string;
    image: string;
  };
  if (!project || !image) {
    return NextResponse.json({ error: "project & image required" }, { status: 400 });
  }
  try {
    const subjectFile = await generateSubject(project, image);
    return NextResponse.json({ ok: true, subjectFile });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
