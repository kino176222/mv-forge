import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { appendLineage, projectDir, projectFile } from "@/lib/server/projects-server";
import { concatVideos } from "@/lib/server/video-concat-server";
import { makePingPong } from "@/lib/server/i2v-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 🔗 延長セグメントの連結（ユーザーがプレビューで確認してから叩く）。
 * {project, parent: videos/xxx.mp4, segment: videos/segments/seg_xxx.mp4}
 * → 親の寸法に正規化して連結し、往復版(.pp)も生成 → {file}
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    parent: string;
    segment: string;
  };
  if (!body.project || !body.parent || !body.segment) {
    return NextResponse.json(
      { error: "project & parent & segment required" },
      { status: 400 },
    );
  }
  try {
    const parentAbs = projectFile(body.project, body.parent);
    const segAbs = projectFile(body.project, body.segment);
    if (!fs.existsSync(parentAbs)) throw new Error(`親動画がありません: ${body.parent}`);
    if (!fs.existsSync(segAbs)) throw new Error(`セグメントがありません: ${body.segment}`);

    const stamp = new Date().toISOString().slice(5, 19).replace(/[-:T]/g, "");
    const outFile = `i2v_${stamp}_ext.mp4`;
    const outAbs = path.join(projectDir(body.project), "videos", outFile);
    await concatVideos([parentAbs, segAbs], outAbs);
    try {
      await makePingPong(outAbs);
    } catch (e) {
      console.warn(`[concat] pp生成に失敗（クロスフェード代替）: ${e}`);
    }
    // 🔗 系譜を記録（素材帯の「元→続き→合体」表示に使う）
    appendLineage(body.project, {
      ext: `videos/${outFile}`,
      parent: body.parent,
      segment: body.segment,
    });
    return NextResponse.json({ file: `videos/${outFile}` });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
