import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projectDir } from "@/lib/server/projects-server";
import { narrationDir, readTakesMeta, writeTakesMeta } from "@/lib/server/fish-server";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 🎙️ マイク録音のアップロード。ブラウザのwebm/mp4を受けてmp3化し、
 * narration/take_rec_*.mp3 として保存する（既存のテイク一覧・採用・間編集に合流）。
 * mp3化は必須: テイク一覧GETは .mp3 しか列挙しないため。
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const project = form.get("project");
  const audio = form.get("audio");
  if (typeof project !== "string" || !project || !(audio instanceof File)) {
    return NextResponse.json(
      { error: "project & audio required" },
      { status: 400 },
    );
  }

  let dir: string;
  try {
    dir = narrationDir(projectDir(project));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  fs.mkdirSync(dir, { recursive: true });

  // ms込みで衝突回避（narration/route.ts と同形式）
  const stamp = new Date().toISOString().slice(5, 23).replace(/[-:T.]/g, "");
  const name = `take_rec_${stamp}.mp3`;
  // 一時ファイルは「.」始まり: 変換失敗の残骸が listAssets の音声一覧を汚さないように
  const tmp = path.join(dir, `.rec_tmp_${stamp}`);
  fs.writeFileSync(tmp, Buffer.from(await audio.arrayBuffer()));
  try {
    // loudnorm: AGCオフ録音は-50dB前後まで小さくなり、そのままSTSに渡すと
    // モデルが言葉を幻覚する（実際に別言語へ化けた例あり）。-16LUFSへ正規化して防ぐ。
    // LRA=11で演技のダイナミクスは保つ。44.1kHz stereo mp3 は narration-gaps.ts と同じ
    await execFileAsync("ffmpeg", [
      "-y", "-i", tmp,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=44100:channel_layouts=stereo",
      "-c:a", "libmp3lame", "-q:a", "2",
      path.join(dir, name),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: `録音の変換に失敗しました: ${String(e).slice(-300)}` },
      { status: 500 },
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  // 台帳に出自を記録（UIはここから種別バッジを描画する）
  const pdir = projectDir(project);
  const meta = readTakesMeta(pdir);
  meta[`narration/${name}`] = { silences: [], kind: "rec" };
  writeTakesMeta(pdir, meta);
  return NextResponse.json({ ok: true, file: `narration/${name}` });
}
