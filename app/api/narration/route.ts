import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/server/projects-server";
import {
  generateTts,
  narrationDir,
  readTakesMeta,
  writeTakesMeta,
} from "@/lib/server/fish-server";
import { renderedSilences } from "@/lib/server/narration-gaps-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 🎙️ プロローグ朗読のTTS生成（Fish Audio S2-Pro）。
 * POST: タグ入りテキスト＋声モデルで複数テイクを narration/ に生成
 * GET:  生成済みテイクの一覧
 */

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  if (!project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const pdir = projectDir(project);
  const dir = narrationDir(pdir);
  if (!fs.existsSync(dir)) return NextResponse.json({ takes: [] });
  const meta = readTakesMeta(pdir);
  // 更新時刻の降順（本当の新しい順）。名前ソートだと _ を含む名前が先頭に固定される
  // silences はレンダリング後座標に変換して返す（メタは元音声座標で保存されている）
  const takes = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => ({
      file: `narration/${f}`,
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      silences: renderedSilences(meta[`narration/${f}`]?.silences ?? []),
      kind: meta[`narration/${f}`]?.kind ?? null,
      voiceName: meta[`narration/${f}`]?.voiceName ?? null,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json({ takes });
}

export async function POST(req: NextRequest) {
  const { project, text, referenceId, voiceLabel, temperature, speed, takes } =
    (await req.json()) as {
      project: string;
      text: string;
      referenceId: string;
      voiceLabel?: string;
      temperature?: number;
      speed?: number;
      takes?: number;
    };
  if (!project || !text?.trim() || !referenceId?.trim()) {
    return NextResponse.json(
      { error: "project, text, referenceId は必須です" },
      { status: 400 },
    );
  }

  const pdir = projectDir(project);
  const dir = narrationDir(pdir);
  fs.mkdirSync(dir, { recursive: true });
  // ms込みで衝突回避（秒精度だと連打で同名上書きになる）
  const stamp = new Date().toISOString().slice(5, 23).replace(/[-:T.]/g, "");
  const n = Math.min(Math.max(takes ?? 2, 1), 4);

  const files: string[] = [];
  const errors: string[] = [];
  // 日本語はタグの発火が不安定なので、同一設定で複数テイク生成して選抜する前提
  for (let i = 1; i <= n; i++) {
    try {
      const buf = await generateTts({
        text,
        referenceId,
        temperature: temperature ?? 0.75,
        speed: speed ?? 0.9,
      });
      const name = `take_${stamp}_${i}.mp3`;
      fs.writeFileSync(path.join(dir, name), buf);
      files.push(`narration/${name}`);
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: `生成に失敗しました: ${errors[0] ?? "unknown"}` },
      { status: 502 },
    );
  }
  // 台帳に出自を記録
  const meta = readTakesMeta(pdir);
  for (const f of files) {
    meta[f] = {
      silences: [],
      kind: "tts",
      voiceId: referenceId,
      voiceName: voiceLabel?.trim() || undefined,
    };
  }
  writeTakesMeta(pdir, meta);
  return NextResponse.json({ ok: true, files, errors });
}
