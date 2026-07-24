import { NextRequest, NextResponse } from "next/server";
import { loadProject } from "@/lib/server/projects-server";
import { callLLM, extractJson } from "@/lib/server/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * ✨ 朗読のAIレコメンド。
 * 詩（字幕の連 or 現在の台本）と曲の文脈から、S2-Pro向けの
 * タグ入り台本・声モデル検索キーワード・パラメータを claude CLI に提案させる。
 */

interface NarrationSuggestion {
  script: string;
  voiceQueries: string[];
  temperature: number;
  speed: number;
  reason: string;
}

export async function POST(req: NextRequest) {
  const { project: projectName, model } = (await req.json()) as {
    project: string;
    model?: string;
  };
  if (!projectName) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }

  const project = await loadProject(projectName);
  const poem =
    project.prologue.subtitle.stanzas.map((s) => s.text).join("\n\n") ||
    project.prologue.gen.script.replace(/\[[^\]]*\]\s*/g, "");
  if (!poem.trim()) {
    return NextResponse.json(
      { error: "詩がありません。先に字幕（連）か台本を入力してください" },
      { status: 400 },
    );
  }
  const lyricsHead = project.lines
    .map((l) => l.lyricText)
    .filter(Boolean)
    .slice(0, 16)
    .join(" / ");

  const prompt = `あなたは音声演出家です。MVのプロローグとして流す「詩の朗読」を、Fish Audio S2-Pro のTTSで生成するための演出プランを提案してください。

# 詩（この本文は一字一句変えないこと）
${poem}

# 曲の文脈（冒頭の歌詞）
${lyricsHead || "（不明）"}

# S2-Proのタグ仕様と鉄則（公式ベストプラクティス準拠）
- タグは[角括弧]。本文と同じ日本語で自由記述できる
- 冒頭に朗読全体の演出を1つの[一括指示]として書く（トーン・速さ・感情・余韻）。文ごとに感情タグを刻むと朗読がパッチワーク化して不自然になるので禁止
- タメが欲しい語の直前にだけ [pause] を置く（最大2〜3箇所）
- temperature: 表現力。感情的な詩は0.7〜0.85
- speed: 囁き系は0.85〜0.95

# 出力形式（説明文は書かず、このJSONだけを出力）
{
 "script": "[一括演出指示] 詩の本文（改行維持、必要箇所にだけ [pause]）",
 "voiceQueries": ["Fishマーケットプレイスで声を探す日本語キーワードを3つ。詩の話者像（年齢・性別・質感）に合わせる"],
 "temperature": 0.75,
 "speed": 0.9,
 "reason": "演出意図を2文で"
}`;

  try {
    const raw = await callLLM(prompt, model ?? "", { timeoutMs: 4 * 60 * 1000 });
    const suggestion = extractJson<NarrationSuggestion>(raw);
    return NextResponse.json({ ok: true, suggestion });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
