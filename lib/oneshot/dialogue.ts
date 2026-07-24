import { loadProject, findParentImage } from "../server/projects-server";
import { buildLyricsDigest } from "../batch-plan";
import { callLLM, extractJson } from "../server/llm";
import { loadSongStructure } from "../server/suggest-server";
import { structureBlock } from "./scene-plan";
import { TONE_DIRECTIVES, type OneshotTone } from "./types";

/**
 * ② 方針対話（3〜5問・選択式）。仕様書§2-2:
 * - フリーチャットではない。「AかBか」なら答えられる
 * - 質問はAIが動的に生成する（親画像を見て・歌詞を読んで・曲構造を見て）
 * - 会話ログは捨てる。成果物は方針テキスト（meta.direction）のみ
 *   （v1は mv-plan.json の完全スキーマではなく、回答→方針文への合成で実装。編集はゲート1のtextarea）
 */

export interface DialogueQuestion {
  id: string;
  question: string;
  options: { label: string; detail?: string }[];
}

export function buildQuestionsPrompt(
  title: string,
  parent: string,
  lyricsDigest: string,
  structText: string,
): string {
  return `あなたはMVの演出プランナーです。これからこの曲のMVを自動生成します。その前に、依頼者の「ぼんやりした理想」を選択式の質問で掘り起こしてください。まず親画像をReadで見てから質問を設計すること。

# 親画像（必ずReadで見ること）
${parent}

# 曲: ${title}
${structText}# 歌詞
${lyricsDigest}

# ルール
- 質問は3〜5問。フリー入力は求めない（選択肢で答えられる形にする）
- 各質問の選択肢は2〜4個。親画像・歌詞・曲構造から具体的に作る（一般論の選択肢にしない）
- 聞くべきことの例: 世界観・色調 ／ サビの見せ方（顔アップで感情 or 引きで情景）／ キャラと情景の比率 ／ 物語性（歌詞をなぞる or 雰囲気重視）
- 演出の強さ（テロップ等）はシステム側で別途聞くので質問しない

# 出力形式（このJSONだけを出力）
{"questions": [{"id": "q1", "question": "サビはどう見せますか？", "options": [{"label": "顔アップで感情を出す", "detail": "歌詞の主人公に寄る"}, {"label": "引きの情景で聴かせる"}]}]}`;
}

/** 質問を生成して検疫（3〜5問・選択肢2〜4にクランプ） */
export async function generateQuestions(
  projectName: string,
  model: string,
): Promise<DialogueQuestion[]> {
  const parent = findParentImage(projectName);
  if (!parent) throw new Error("親画像がありません（対話は親画像を見て質問を作ります）");
  const project = await loadProject(projectName);
  if (project.lines.length === 0) {
    throw new Error("歌詞がありません（先に歌詞を取り込むか、歌詞テキストと一緒に一発出ししてください）");
  }
  const prompt = buildQuestionsPrompt(
    project.meta.title,
    parent,
    buildLyricsDigest(project.lines),
    structureBlock(loadSongStructure(projectName)),
  );
  const raw = await callLLM(prompt, model, { images: [parent] });
  const parsed = extractJson<{ questions?: DialogueQuestion[] }>(raw);
  const qs = (parsed.questions ?? [])
    .filter((q) => q && typeof q.question === "string" && Array.isArray(q.options))
    .map((q, i) => ({
      id: typeof q.id === "string" ? q.id : `q${i + 1}`,
      question: q.question,
      options: q.options
        .filter((o) => o && typeof o.label === "string")
        .slice(0, 4)
        .map((o) => ({ label: o.label, ...(o.detail ? { detail: o.detail } : {}) })),
    }))
    .filter((q) => q.options.length >= 2)
    .slice(0, 5);
  if (qs.length < 3) {
    throw new Error("質問の生成に失敗しました（3問未満）。もう一度お試しください");
  }
  return qs;
}

/** 回答＋自由記述＋トーンを方針テキスト（meta.direction）に合成する（純関数・会話ログは捨てる） */
export function composeDirection(
  answers: { question: string; answer: string }[],
  freeText: string,
  tone: OneshotTone,
): string {
  const lines: string[] = [];
  if (freeText.trim()) lines.push(freeText.trim());
  for (const a of answers) {
    if (a.answer.trim()) lines.push(`${a.question} → ${a.answer.trim()}`);
  }
  lines.push(TONE_DIRECTIVES[tone]);
  return lines.join("\n");
}
