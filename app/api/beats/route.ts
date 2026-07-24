import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { analyzeSong } from "@/lib/server/beats-analyze-server";
import { projectDir } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";

/** 検出済みビート（beats.json）を返す */
export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  if (!project) return NextResponse.json({ error: "project required" }, { status: 400 });
  const file = path.join(projectDir(project), "beats.json");
  if (!fs.existsSync(file)) return NextResponse.json({ beats: [] });
  return NextResponse.json(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** ビート検出を実行して beats.json に保存（④音ハメ磁石の下ごしらえ） */
export async function POST(req: NextRequest) {
  const { project, file } = (await req.json()) as { project: string; file: string };
  if (!project || !file) {
    return NextResponse.json({ error: "project & file required" }, { status: 400 });
  }
  try {
    // beats.json v2: 旧キー(file/beats/duration)を保持したまま、拍節グリッド＋
    // サビ検出（bpm/beatGrid/downbeats/sections）を追加して保存・返却する。
    const out = await analyzeSong(project, file);
    fs.writeFileSync(
      path.join(projectDir(project), "beats.json"),
      JSON.stringify(out, null, 2),
    );
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
