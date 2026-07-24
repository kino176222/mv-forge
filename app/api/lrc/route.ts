import { NextRequest, NextResponse } from "next/server";
import {
  LrcError,
  applyLrcToProject,
  generateLrcAuto,
} from "@/lib/server/lrc-server";

export const dynamic = "force-dynamic";

/**
 * ①LRC自動生成/取込の薄いラッパ。実体は lib/lrc-server.ts（一発出しモードと共用）。
 * auto=Scribeで自動生成 / import=既存LRCテキスト読込
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    mode: "auto" | "import";
    audioFile?: string; // autoで使う（vocals.mp3等）
    lyricsText?: string; // autoで使う正解歌詞（改行区切り）
    lrcText?: string; // importで使う
    merge?: boolean; // 既存linesの装飾を引き継ぐ
  };

  try {
    if (body.mode === "import") {
      if (!body.lrcText) {
        return NextResponse.json({ error: "lrcText required" }, { status: 400 });
      }
      const result = await applyLrcToProject(
        body.project,
        body.lrcText,
        [],
        body.merge ?? false,
      );
      return NextResponse.json(result);
    }

    if (!body.audioFile || !body.lyricsText) {
      return NextResponse.json(
        { error: "audioFile と lyricsText が必要です" },
        { status: 400 },
      );
    }
    const result = await generateLrcAuto(
      body.project,
      body.audioFile,
      body.lyricsText,
      body.merge ?? false,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof LrcError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
