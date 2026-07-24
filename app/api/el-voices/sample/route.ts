import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { sampleDir, isValidVoiceId } from "@/lib/server/el-voices-server";
import { textToSpeech } from "@/lib/server/elevenlabs-server";
import { VOICE_SAMPLE_TEXT } from "@/lib/fish-voices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 🔈 ボイス手帳の試聴サンプル。voiceIdごとにTTS生成して
 * projects/el-voice-samples/ にキャッシュ（Fishの voice-sample と同じ方式）。
 * POST: 生成（キャッシュ済みなら即返す） / GET: mp3を配信
 */

function samplePath(voiceId: string): string {
  return path.join(sampleDir(), `${voiceId}.mp3`);
}

export async function POST(req: NextRequest) {
  const { voiceId } = (await req.json()) as { voiceId: string };
  if (!voiceId?.trim() || !isValidVoiceId(voiceId)) {
    return NextResponse.json({ error: "voiceId不正" }, { status: 400 });
  }
  const abs = samplePath(voiceId);
  if (fs.existsSync(abs)) {
    return NextResponse.json({ ok: true, cached: true });
  }
  fs.mkdirSync(sampleDir(), { recursive: true });
  try {
    const buf = await textToSpeech({ text: VOICE_SAMPLE_TEXT, voiceId });
    fs.writeFileSync(abs, buf);
    return NextResponse.json({ ok: true, cached: false });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(-300) }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const voiceId = req.nextUrl.searchParams.get("voiceId") ?? "";
  if (!isValidVoiceId(voiceId)) {
    return NextResponse.json({ error: "voiceId不正" }, { status: 400 });
  }
  const abs = samplePath(voiceId);
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "sample not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=86400", // voiceIdごとに不変
    },
  });
}
