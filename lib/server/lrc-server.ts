import "./server-guard";
import fs from "node:fs";
import path from "node:path";
import {
  loadProject,
  saveProject,
  projectFile,
  projectDir,
} from "./projects-server";
import { analyzeSong } from "./beats-analyze-server";
import {
  alignLyricsDetailed,
  type AlignedLineDetailed,
  type RecognizedWord,
} from "../align";
import {
  lrcToLines,
  mergeLrcIntoLines,
  linesToLrc,
  formatTime,
  insertGapMarkers,
  attachAlignedWords,
} from "../lrc";
import type { Project } from "../schema";

/**
 * ①LRC自動生成の実体（app/api/lrc から抽出。一発出しモードと共用する）。
 * ボーカル音声（Sunoのボーカルステム推奨）を ElevenLabs Scribe v2 で
 * 単語タイムスタンプ付き文字起こし → 正解歌詞とアライメント → lines[] を生成。
 * AIは下書き、ズレた行は人間がGUIで直す。
 */

/** 失敗をHTTPステータス付きで運ぶ（routeがそのまま status に流せるように） */
export class LrcError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "LrcError";
  }
}

export interface LrcApplyResult {
  project: Project;
  lineCount: number;
  insertedMarkers: number;
  analyzedStructure: boolean;
}

/** Scribe文字起こし→正解歌詞との編集距離DPアライメント（LRCテキストと単語時刻を返す） */
export async function transcribeAndAlign(
  projectName: string,
  audioFile: string,
  lyricsText: string,
): Promise<{ lrcText: string; aligned: AlignedLineDetailed[] }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new LrcError(
      "ELEVENLABS_API_KEY が未設定です。mv-forge/.env.local に ELEVENLABS_API_KEY=... を書いて再起動してください。",
      400,
    );
  }
  const abs = projectFile(projectName, audioFile);
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(abs)]), path.basename(abs));
  form.append("model_id", "scribe_v2");
  form.append("timestamps_granularity", "word");
  form.append("language_code", "ja");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new LrcError(`Scribe API error ${res.status}: ${await res.text()}`, 502);
  }
  const data = (await res.json()) as {
    words?: { text: string; start: number; end: number; type?: string }[];
  };
  const words: RecognizedWord[] = (data.words ?? [])
    .filter((w) => (w.type ?? "word") === "word")
    .map((w) => ({ text: w.text, start: w.start, end: w.end }));

  const lyricLines = lyricsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const aligned = alignLyricsDetailed(lyricLines, words);
  const lrcText = aligned
    .map((a) => `[${formatTime(a.start ?? 0)}] ${a.text}`)
    .join("\n");
  return { lrcText, aligned };
}

/**
 * LRCテキストを lines[] へ反映して保存する共通路（auto/import両モードの合流点）。
 * マーカー挿入・lyrics.generated.lrc の保存・曲構造（beats.json）の自動解析込み。
 */
export async function applyLrcToProject(
  projectName: string,
  lrcText: string,
  aligned: AlignedLineDetailed[],
  merge: boolean,
): Promise<LrcApplyResult> {
  const project = await loadProject(projectName);
  let lines =
    merge && project.lines.length > 0
      ? mergeLrcIntoLines(lrcText, project.lines)
      : lrcToLines(lrcText);
  // 単語タイムスタンプを行に割り付ける（カラオケ塗り等の土台）。
  // テキスト一致だけだと「サビ」等の重複歌詞行に別の出現位置の時刻を配ってしまうため、
  // テキスト一致候補の中から実効時刻の最近傍を1行に1出現ずつ割り当てる（attachAlignedWords）。
  if (aligned.length > 0) {
    lines = attachAlignedWords(lines, aligned);
  }
  // Scribe待ちの間（数十秒〜）にユーザーが編集した textStyle 等を巻き戻さないよう、
  // 保存直前に再ロードして lines だけを差し替える
  const fresh = await loadProject(projectName);
  // 前奏・間奏・アウトロの空白に空マーカー行を入れる（歌詞の残留防止）
  const withMarkers = insertGapMarkers(lines, fresh.meta.songDuration);
  fresh.lines = withMarkers.lines;
  saveProject(projectName, fresh);

  // 生成したLRCもファイルとして保存しておく（他ツールでも使えるように）
  fs.writeFileSync(
    path.join(projectDir(projectName), "lyrics.generated.lrc"),
    linesToLrc(fresh.lines) + "\n",
  );

  // ①LRC完了時に曲構造（案3）を自動解析して押し忘れを無くす。
  // 拍とエネルギーはフルミックスで測るのが正しいので、ボーカルステムでLRCを
  // 作った場合でも解析対象は本編音源（meta.songFile）にする。
  // 失敗してもLRC生成の成否には影響させない（握って一言だけ残す）。
  let analyzedStructure = false;
  try {
    const out = await analyzeSong(projectName, fresh.meta.songFile);
    fs.writeFileSync(
      path.join(projectDir(projectName), "beats.json"),
      JSON.stringify(out, null, 2),
    );
    analyzedStructure = true;
  } catch (e) {
    console.error(`[lrc] 曲構造の自動解析に失敗（LRCは成功）: ${String(e)}`);
  }

  return {
    project: fresh,
    lineCount: lines.length,
    insertedMarkers: withMarkers.inserted,
    analyzedStructure,
  };
}

/** ①LRC自動生成の一気通貫（Scribe→アライメント→lines保存→beats.json） */
export async function generateLrcAuto(
  projectName: string,
  audioFile: string,
  lyricsText: string,
  merge = false,
): Promise<LrcApplyResult> {
  const { lrcText, aligned } = await transcribeAndAlign(
    projectName,
    audioFile,
    lyricsText,
  );
  return applyLrcToProject(projectName, lrcText, aligned, merge);
}
