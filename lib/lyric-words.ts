import type { LineWord } from "./schema";

/**
 * 単語タイムスタンプ → 演出用の時間関数。
 * LyricLine（描画）と検証スクリプトの両方から使う純関数群。
 * 歌唱ASRの鉄則「単語の終了時刻は信用しない」（ロングトーン/メリスマで機械が最も外す）
 * に従い、終了は「次の単語の開始」で必ずクランプする。
 */

/** 単語の実効終了時刻: end を信用しすぎず、次の単語開始でクランプ */
function effectiveEnd(w: LineWord, next: LineWord | undefined): number {
  const minDur = 0.05;
  const rawEnd = Math.max(w.end, w.start + minDur);
  return next ? Math.min(rawEnd, next.start) : rawEnd;
}

/**
 * カラオケ塗りの進行度（0..1）。tAbs は曲内の絶対秒。
 * 単語の発声中は文字割合ぶん進み、単語間のギャップでは保持する（区分線形）。
 * words が空なら -1（呼び出し側が従来の均等塗りへフォールバック）。
 */
export function karaokeFillProgress(
  words: LineWord[],
  totalChars: number,
  tAbs: number,
): number {
  if (words.length === 0 || totalChars <= 0) return -1;
  let filledChars = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const end = effectiveEnd(w, words[i + 1]);
    if (tAbs >= end) {
      filledChars = w.charTo + 1;
      continue;
    }
    if (tAbs > w.start) {
      const span = Math.max(0.001, end - w.start);
      const within = (tAbs - w.start) / span;
      filledChars = w.charFrom + within * (w.charTo + 1 - w.charFrom);
    }
    break;
  }
  const last = words[words.length - 1];
  // 最後の単語を歌い終えたら、行末の残り（句読点等）まで塗り切る
  if (tAbs > effectiveEnd(last, undefined) + 0.15) filledChars = totalChars;
  return Math.min(1, Math.max(0, filledChars / totalChars));
}

/**
 * 各表示文字の「発声開始秒」（曲内絶対秒）。単語ごと出現アニメ用。
 * 単語内の文字は単語の尺で均等按分。単語に割り付かなかった文字（句読点等）は
 * 直前の文字の時刻を引き継ぐ（先頭なら最初の単語の開始）。
 */
/**
 * 各表示文字の出現開始「ローカルフレーム」（行頭基準）。文字送り系演出の歌クロック。
 * words が無い（手貼りLRC等）なら null を返し、呼び出し側が従来の等間隔
 * `i × staggerFrames` へフォールバックする＝既存プロジェクトの見た目を壊さない。
 * 換算式は lyric-word-pop の従来実装と同値（行頭前の発声は0にクランプ）。
 */
export function charStartFramesVocal(
  words: LineWord[],
  totalChars: number,
  lineStartSec: number,
  fps: number,
): number[] | null {
  if (words.length === 0 || totalChars <= 0) return null;
  return charAppearTimes(words, totalChars).map((t) =>
    Math.max(0, Math.round((t - lineStartSec) * fps)),
  );
}

export function charAppearTimes(words: LineWord[], totalChars: number): number[] {
  const times = new Array<number>(totalChars).fill(-1);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const end = effectiveEnd(w, words[i + 1]);
    const count = Math.max(1, w.charTo + 1 - w.charFrom);
    for (let c = w.charFrom; c <= Math.min(w.charTo, totalChars - 1); c++) {
      const within = (c - w.charFrom) / count;
      times[c] = w.start + within * (end - w.start) * 0.9;
    }
  }
  let lastSeen = words[0]?.start ?? 0;
  for (let c = 0; c < totalChars; c++) {
    if (times[c] < 0) times[c] = lastSeen;
    else lastSeen = times[c];
  }
  return times;
}
