import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir, projectFile } from "@/lib/server/projects-server";
import { narrationDir, readTakesMeta, writeTakesMeta } from "@/lib/server/fish-server";
import { speechToSpeech } from "@/lib/server/elevenlabs-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 🎭 ボイチェン: 録音テイク（narration/take_rec_*.mp3 等）を ElevenLabs STS に
 * かけて声色だけ変換し、narration/take_vc_*.mp3 として保存する。
 * 元テイクは残るので、別の声での再変換やA/B比較ができる。
 */
export async function POST(req: NextRequest) {
  const { project, file, voiceId, voiceName } = (await req.json()) as {
    project: string;
    file: string;
    voiceId: string;
    voiceName?: string;
  };
  if (!project || !file || !voiceId?.trim()) {
    return NextResponse.json(
      { error: "project, file, voiceId は必須です" },
      { status: 400 },
    );
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
    return NextResponse.json({ error: "voiceId不正" }, { status: 400 });
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

  try {
    const buf = await speechToSpeech({
      audio: fs.readFileSync(src),
      filename: path.basename(src),
      voiceId,
    });
    const pdir = projectDir(project);
    const dir = narrationDir(pdir);
    const stamp = new Date().toISOString().slice(5, 23).replace(/[-:T.]/g, "");
    const name = `take_vc_${stamp}.mp3`;
    fs.writeFileSync(path.join(dir, name), buf);
    // 台帳に出自を記録（どの声で変換したか・変換元はどのテイクか）
    const meta = readTakesMeta(pdir);
    meta[`narration/${name}`] = {
      silences: [],
      kind: "vc",
      voiceId,
      voiceName: voiceName?.trim() || undefined,
      source: file,
    };
    writeTakesMeta(pdir, meta);
    return NextResponse.json({ ok: true, file: `narration/${name}` });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(-300) }, { status: 502 });
  }
}
