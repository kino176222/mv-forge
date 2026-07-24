import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/server/projects-server";
import { generateTts, narrationDir } from "@/lib/server/fish-server";
import { VOICE_SAMPLE_TEXT } from "@/lib/fish-voices";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 🔈 声の試聴サンプル。voiceIdごとに narration/samples/ へキャッシュし、
 * 2回目以降はAPIを叩かず即返す。
 */
export async function POST(req: NextRequest) {
  const { project, voiceId } = (await req.json()) as {
    project: string;
    voiceId: string;
  };
  if (!project || !voiceId?.trim()) {
    return NextResponse.json(
      { error: "project & voiceId required" },
      { status: 400 },
    );
  }
  if (!/^[a-f0-9]{16,64}$/i.test(voiceId)) {
    return NextResponse.json({ error: "voiceId不正" }, { status: 400 });
  }

  const dir = path.join(narrationDir(projectDir(project)), "samples");
  const file = `narration/samples/${voiceId}.mp3`;
  const abs = path.join(dir, `${voiceId}.mp3`);
  if (fs.existsSync(abs)) {
    return NextResponse.json({ ok: true, file, cached: true });
  }

  fs.mkdirSync(dir, { recursive: true });
  try {
    const buf = await generateTts({
      text: VOICE_SAMPLE_TEXT,
      referenceId: voiceId,
      temperature: 0.7,
      speed: 0.95,
    });
    fs.writeFileSync(abs, buf);
    return NextResponse.json({ ok: true, file, cached: false });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(-300) }, { status: 502 });
  }
}
