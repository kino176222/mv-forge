import { NextRequest, NextResponse } from "next/server";
import {
  readRoster,
  writeRoster,
  isValidVoiceId,
} from "@/lib/server/el-voices-server";
import { listVoices } from "@/lib/server/elevenlabs-server";

export const dynamic = "force-dynamic";

/**
 * 📒 ボイス手帳（ElevenLabsボイチェンの変換先リスト）のCRUD。
 * GET は My Voices（voices_read権限がある場合のみ）も返し、一括登録に使える。
 */

export async function GET() {
  const voices = readRoster();
  // My Voices はおまけ（キーに voices_read が無ければ空配列で返す）
  let myVoices: { id: string; name: string; category: string }[] = [];
  try {
    myVoices = await listVoices();
  } catch {
    // 権限なし・オフライン等は無視（手帳だけで運用できる）
  }
  return NextResponse.json({ voices, myVoices });
}

export async function POST(req: NextRequest) {
  const { id, name } = (await req.json()) as { id: string; name: string };
  if (!id?.trim() || !name?.trim()) {
    return NextResponse.json({ error: "id & name required" }, { status: 400 });
  }
  const vid = id.trim();
  if (!isValidVoiceId(vid)) {
    return NextResponse.json({ error: "voiceId不正" }, { status: 400 });
  }
  const roster = readRoster().filter((v) => v.id !== vid); // 同IDは上書き（改名に使える）
  roster.push({ id: vid, name: name.trim() });
  writeRoster(roster);
  return NextResponse.json({ ok: true, voices: roster });
}

export async function DELETE(req: NextRequest) {
  const { id } = (await req.json()) as { id: string };
  if (!id?.trim()) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const roster = readRoster().filter((v) => v.id !== id.trim());
  writeRoster(roster);
  return NextResponse.json({ ok: true, voices: roster });
}
