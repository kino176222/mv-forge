import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { callLLM, extractJson } from "@/lib/server/llm";
import { projectFile, loadProject } from "@/lib/server/projects-server";
import type { MotionIdea } from "@/lib/ai-models";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 💡 i2vの「動きの指示」AIレコメンド。
 * 画像をclaude CLI（Readツール）に見せて、控えめ/普通/大胆の3案を提案する。
 * AI参謀と同じくヘッドレス（MAX定額）なのでAPI課金なし。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    project: string;
    image: string;
    lineText?: string;
    model?: string;
  };
  if (!body.project || !body.image) {
    return NextResponse.json({ error: "project & image required" }, { status: 400 });
  }
  let abs: string;
  try {
    abs = projectFile(body.project, body.image);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: `画像がありません: ${body.image}` }, { status: 404 });
  }

  let title = "";
  let direction = "";
  try {
    const meta = (await loadProject(body.project)).meta;
    title = meta.title;
    direction = meta.direction.trim();
  } catch {
    /* タイトル無しでも提案は出せる */
  }

  const prompt = `あなたはMVの演出家です。この画像を必ずReadツールで見てから、i2v（画像→動画、5〜10秒）の「動きの指示」を3案設計してください。

# 画像（必ずReadで見ること）
${abs}

# 文脈
- 曲: ${title || "不明"}
- この場面の歌詞: ${body.lineText?.trim() || "（間奏・歌詞なし）"}
${direction ? `- 演出方針（ユーザー指定。最優先で尊重すること）: ${direction}` : ""}

# 設計ルール
- 3案は強度違いで: subtle（繊細。髪・光・呼吸レベル）/ medium（カメラワーク主体）/ bold（大胆。ダイナミックなカメラ・天候・環境演出）
- アニメ調の1枚絵は、キャラの顔や体を大きく動かすと絵柄が崩れる。boldでも「カメラと環境を派手に、キャラの変形は控えめに」を守る
- promptは英語60語以内。カメラの動き＋被写体の動き＋雰囲気＋「keep the character's face and art style unchanged」等の保持指示を含める
- labelは日本語で短く（例:「風と光のゆらぎ」）、reasonはこの絵と歌詞になぜ合うか1文

# 出力形式（このJSONだけを出力）
{"ideas": [{"label": "...", "intensity": "subtle", "prompt": "...", "reason": "..."}, {"label": "...", "intensity": "medium", ...}, {"label": "...", "intensity": "bold", ...}]}`;

  try {
    const raw = await callLLM(prompt, body.model ?? "", { images: [abs] });
    const parsed = extractJson<{ ideas: MotionIdea[] }>(raw);
    const ideas = (parsed.ideas ?? []).filter((i) => i.prompt && i.label);
    if (ideas.length === 0) throw new Error("提案が空でした");
    return NextResponse.json({ ideas });
  } catch (e) {
    return NextResponse.json(
      { error: `AI提案に失敗: ${e instanceof Error ? e.message : e}` },
      { status: 502 },
    );
  }
}
