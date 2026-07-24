import { NextRequest, NextResponse } from "next/server";
import { startOneshot, oneshotJobs, confirmCost } from "@/lib/oneshot/orchestrator";
import { generateQuestions } from "@/lib/oneshot/dialogue";
import { getPersistedJob } from "@/lib/server/jobs-server";
import type { MetaphorLevel, OneshotMode, OneshotTone } from "@/lib/oneshot/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600; // 方針対話の質問生成は claude CLI で数分かかることがある

const MODES = new Set(["ume", "take", "matsu"]);

/**
 * 一発出しモード。
 * POST action:
 *  - "start"（既定）: 実行開始（ノンストップ。コスト超過時のみ cost-gate で停止）
 *  - "confirm-cost": cost-gate の承認
 *  - "questions": 方針対話の選択式質問をAIが生成（親画像＋歌詞＋曲構造を見る）
 * GET: 進捗（?project=&id=）
 * キャンセルは既存の DELETE /api/jobs に相乗り。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action?: "start" | "confirm-cost" | "questions";
    project?: string;
    id?: string;
    mode?: string;
    model?: string;
    i2vModel?: string;
    tone?: string;
    metaphor?: string;
    lyricsText?: string;
    audioFile?: string;
    direction?: string;
  };
  if (!body.project) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const action = body.action ?? "start";

  if (action === "confirm-cost") {
    if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const ok = confirmCost(body.id);
    if (!ok) {
      return NextResponse.json(
        { error: "承認できませんでした（ジョブが cost-gate 待ちではありません）" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, job: oneshotJobs().get(body.id) ?? null });
  }

  if (action === "questions") {
    try {
      const questions = await generateQuestions(body.project, body.model ?? "");
      return NextResponse.json({ questions });
    } catch (e) {
      return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
    }
  }

  const mode = (body.mode ?? "ume") as OneshotMode;
  if (!MODES.has(mode)) {
    return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 });
  }
  const tone = (["calm", "standard", "bold"].includes(body.tone ?? "")
    ? body.tone
    : "calm") as OneshotTone;
  const metaphor = (["literal", "balanced", "poetic"].includes(body.metaphor ?? "")
    ? body.metaphor
    : "balanced") as MetaphorLevel;
  try {
    const job = startOneshot({
      projectName: body.project,
      mode,
      model: body.model,
      i2vModel: body.i2vModel,
      tone,
      metaphor,
      lyricsText: body.lyricsText,
      audioFile: body.audioFile,
      direction: body.direction,
    });
    return NextResponse.json({ job });
  } catch (e) {
    // startOneshot の同期throwは多重起動ガードのみ（本処理のエラーは非同期でjobに載る）
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 409 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");
  const id = searchParams.get("id");
  if (!project || !id) {
    return NextResponse.json({ error: "project & id required" }, { status: 400 });
  }
  const live = oneshotJobs().get(id);
  if (live) return NextResponse.json({ job: live });
  // サーバー再起動後は jobs.json の記録を返す（sweepOrphans が interrupted に落とす）
  const rec = getPersistedJob(project, id);
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job: rec.payload });
}
