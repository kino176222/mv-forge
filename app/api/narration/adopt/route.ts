import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir, projectFile, probeDuration } from "@/lib/server/projects-server";

export const dynamic = "force-dynamic";

/**
 * テイクの採用: narration/のテイクを prologue.mp3 にコピーして尺を計測して返す。
 * project.json の更新はクライアント（store→自動保存）に任せる。二重書き込みを避けるため。
 */
export async function POST(req: NextRequest) {
  const { project, file } = (await req.json()) as {
    project: string;
    file: string;
  };
  if (!project || !file) {
    return NextResponse.json({ error: "project & file required" }, { status: 400 });
  }
  let src: string;
  try {
    src = projectFile(project, file);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  if (!fs.existsSync(src)) {
    return NextResponse.json({ error: "take not found" }, { status: 404 });
  }
  // 毎回一意な名前で書き出す: 同名上書きだとRemotionプレビューが古い音声を
  // キャッシュしたまま再生することがあるため（URLが変われば確実に読み直す）
  const destName = `prologue_${Date.now()}.mp3`;
  const pdir = projectDir(project);
  fs.copyFileSync(src, path.join(pdir, destName));
  for (const f of fs.readdirSync(pdir)) {
    if (/^prologue(_\d+)?\.mp3$/.test(f) && f !== destName) {
      fs.unlinkSync(path.join(pdir, f));
    }
  }
  const duration = await probeDuration(project, destName);
  return NextResponse.json({ ok: true, audioFile: destName, duration });
}
