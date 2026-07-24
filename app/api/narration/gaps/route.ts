import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { projectFile } from "@/lib/server/projects-server";
import {
  ensureSrc,
  renderTake,
  renderedSilences,
  toOriginalAt,
} from "@/lib/server/narration-gaps-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * ⏸️ 「間」の非破壊編集。テイクは同名で上書き更新される（複製しない）。
 * op: {type:"insert", at, dur} … at はレンダリング後（＝いま聴いている音声）の秒
 * op: {type:"delete", index}  … 間リストのインデックス
 */
export async function POST(req: NextRequest) {
  const { project, file, op } = (await req.json()) as {
    project: string;
    file: string;
    op:
      | { type: "insert"; at: number; dur: number }
      | { type: "delete"; index: number };
  };
  if (!project || !file || !op?.type) {
    return NextResponse.json(
      { error: "project, file, op が必要です" },
      { status: 400 },
    );
  }
  try {
    const abs = projectFile(project, file);
    if (!fs.existsSync(abs)) {
      return NextResponse.json({ error: "take not found" }, { status: 404 });
    }

    const gaps = await ensureSrc(project, file);

    if (op.type === "insert") {
      if (!(op.at >= 0) || !(op.dur > 0) || op.dur > 15) {
        return NextResponse.json(
          { error: "at(0以上)とdur(0〜15秒)が必要です" },
          { status: 400 },
        );
      }
      gaps.push({ at: toOriginalAt(gaps, op.at), dur: op.dur });
    } else {
      const sorted = [...gaps].sort((a, b) => a.at - b.at);
      if (op.index < 0 || op.index >= sorted.length) {
        return NextResponse.json({ error: "index不正" }, { status: 400 });
      }
      sorted.splice(op.index, 1);
      gaps.length = 0;
      gaps.push(...sorted);
    }

    await renderTake(project, file, gaps);
    return NextResponse.json({
      ok: true,
      file,
      silences: renderedSilences(gaps),
      mtime: fs.statSync(abs).mtimeMs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `間の編集に失敗: ${String(e).slice(-300)}` },
      { status: 502 },
    );
  }
}
