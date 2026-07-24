/**
 * 拡張テロップの表示窓計算（歌詞テロップ・行クレジット共通の純関数）。
 * 行の尺（フレーム）の中で「出だし遅れ delay 秒から duration 秒だけ出す」窓を返す。
 * duration=0 は「行末まで」。負値は0扱い。窓は必ず行内に収まり durF>=1 を保証する。
 */
export function telopWindow(
  delaySec: number,
  durationSec: number,
  lineDurF: number,
  fps: number,
): { fromF: number; durF: number } {
  const delay = Math.max(0, delaySec);
  const duration = Math.max(0, durationSec);
  // 遅れが行尺を食い潰しても最低1フレームは残す
  const fromF = Math.min(Math.max(0, Math.round(delay * fps)), Math.max(0, lineDurF - 1));
  const endF =
    duration > 0
      ? Math.min(lineDurF, fromF + Math.round(duration * fps))
      : lineDurF;
  return { fromF, durF: Math.max(1, endF - fromF) };
}

/** 歌い終わり自動消灯の余白（最後の単語の発声終了からフェード開始までの秒） */
export const LYRIC_AUTO_HIDE_MARGIN_SEC = 0.8;
/** 自動消灯でも最低これだけは見せる（窓頭からの秒。極端なwordsデータの保険） */
export const LYRIC_MIN_SHOW_SEC = 1.0;

/**
 * 歌詞行の表示窓（自前演出・拡張テロップ共通）。優先順位:
 *  1. 手動 duration>0（つまみ）が常に勝つ
 *  2. autoHide かつ words あり → 最後の単語の歌い終わり+余白で消える
 *     （wordsの終了時刻はASRが外しやすいので start+0.05s を下限に、行内にクランプ）
 *  3. どちらも無ければ従来どおり行末まで
 * words の時刻は曲内絶対秒（lineStartSec で行ローカルへ換算）。
 */
export function lyricWindow(opts: {
  delaySec: number;
  durationSec: number;
  autoHide: boolean;
  words: { start: number; end: number }[];
  lineStartSec: number;
  lineDurF: number;
  fps: number;
}): { fromF: number; durF: number } {
  const { delaySec, durationSec, autoHide, words, lineStartSec, lineDurF, fps } = opts;
  if (durationSec > 0) return telopWindow(delaySec, durationSec, lineDurF, fps);
  if (autoHide && words.length > 0) {
    const last = words[words.length - 1];
    const delay = Math.max(0, delaySec);
    const lineDurSec = lineDurF / fps;
    // 毒データガード①: 最後の単語が行の時間範囲外なら words を丸ごと信用しない
    // （実事故: 重複歌詞の行に別の出現位置の時刻が配られる。LRC自動生成のアライメント由来）
    if (
      last.start < lineStartSec - 0.5 ||
      last.start > lineStartSec + lineDurSec + 0.5
    ) {
      return telopWindow(delaySec, 0, lineDurF, fps);
    }
    // 毒データガード②: 最後の単語のASR引き伸ばしをキャップ（2×中央値・下限1s）。
    // ロングトーン/メリスマで「最後の単語のend」は次の行頭まで伸びがち（実事故: 「泳いでる」の
    // 「る」が2.24s）。行内の他の単語の尺の中央値と連動させるので、全体がゆったりの
    // バラード行は切り詰めない。単語1個の行は比較材料が無いのでキャップしない
    let lastDur = Math.max(0.05, last.end - last.start);
    if (words.length >= 2) {
      const durs = words
        .slice(0, -1)
        .map((w, i) => {
          const end = Math.min(Math.max(w.end, w.start + 0.05), words[i + 1].start);
          return Math.max(0.05, end - w.start);
        })
        .sort((a, b) => a - b);
      const median = durs[Math.floor(durs.length / 2)];
      lastDur = Math.min(lastDur, Math.max(1.0, 2 * median));
    }
    const endAbs = last.start + lastDur + LYRIC_AUTO_HIDE_MARGIN_SEC;
    // 行ローカル秒へ換算し、最低表示保証と行末でクランプ
    const endLocal = Math.min(
      lineDurSec,
      Math.max(endAbs - lineStartSec, delay + LYRIC_MIN_SHOW_SEC),
    );
    if (endLocal - delay > 0) {
      return telopWindow(delay, endLocal - delay, lineDurF, fps);
    }
  }
  return telopWindow(delaySec, 0, lineDurF, fps);
}

/**
 * 行クレジット用の絶対フレーム窓。
 * - duration=0: 従来どおり「行の窓」に従う（呼び出し側が渡す lineDurF ＝次の行まで/最終行+8s等）
 * - duration>0: 行末の推定をやめて指定どおり出す。上限は動画終端の exitMarginSec 秒前
 *   （端ぴったりで切るとブツ切りになるため、退場アニメの余白を残す）
 */
/**
 * クレジット/タイトルのフェード包絡（Sequence内ローカルフレーム→不透明度）。
 * デザイン自身の入退場アニメとは独立の「上掛け」＝どのタイトルデザインにも一律で効く。
 * fadeIn/fadeOut が 0 のときは常に1（従来挙動と完全一致）。
 */
export function fadeEnvelopeOpacity(
  frame: number,
  durF: number,
  fadeInF: number,
  fadeOutF: number,
): number {
  let o = 1;
  if (fadeInF > 0) o = Math.min(o, frame / fadeInF);
  if (fadeOutF > 0) o = Math.min(o, (durF - frame) / fadeOutF);
  return Math.max(0, Math.min(1, o));
}

// ---- クレジットの入退場モーション（純関数） ----
// 「ふわっ」の正体はイージング。線形だと機械的に見えるので smoothstep で減速を付ける。
// スタイルはフェードを土台に、rise/fall=縦の滑り込み・blur=ぼかしが晴れる・pop=わずかな拡縮を重ねる。

export type CreditMotionStyle = "fade" | "rise" | "fall" | "blur" | "pop";

export interface CreditMotion {
  opacity: number;
  /** px（1080p基準の合成座標） */
  translateY: number;
  /** px */
  blur: number;
  scale: number;
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** smoothstep: 出だしも終わりも滑らか＝「ふわっ」 */
const ease = (t: number) => t * t * (3 - 2 * t);

const STYLE_Y: Record<CreditMotionStyle, number> = {
  fade: 0,
  rise: 28, // 下から浮き上がる
  fall: -28, // 上から降りてくる
  blur: 0,
  pop: 0,
};

/**
 * 入退場の合成モーション。progress=1（アニメ完了）で必ず素の状態
 * （opacity1/移動0/ぼかし0/等倍）＝表示中の見た目はスタイルに依存しない。
 */
export function creditEnterExit(
  frame: number,
  durF: number,
  inF: number,
  outF: number,
  enterStyle: CreditMotionStyle,
  exitStyle: CreditMotionStyle,
): CreditMotion {
  const tIn = inF > 0 ? ease(clamp01(frame / inF)) : 1;
  const tOut = outF > 0 ? ease(clamp01((durF - frame) / outF)) : 1;

  const opacity = Math.min(tIn, tOut);
  const translateY =
    STYLE_Y[enterStyle] * (1 - tIn) + STYLE_Y[exitStyle] * (1 - tOut);
  const blur =
    (enterStyle === "blur" ? 14 * (1 - tIn) : 0) +
    (exitStyle === "blur" ? 14 * (1 - tOut) : 0);
  const scale =
    (enterStyle === "pop" ? 0.92 + 0.08 * tIn : 1) *
    (exitStyle === "pop" ? 0.96 + 0.04 * tOut : 1);

  return { opacity, translateY, blur, scale };
}

export function telopWindowAbs(
  delaySec: number,
  durationSec: number,
  lineStartF: number,
  lineDurF: number,
  videoEndF: number,
  fps: number,
  exitMarginSec = 0.5,
): { fromF: number; durF: number } {
  if (durationSec <= 0) {
    const w = telopWindow(delaySec, 0, lineDurF, fps);
    return { fromF: lineStartF + w.fromF, durF: w.durF };
  }
  const capF = Math.max(lineStartF + 1, videoEndF - Math.round(exitMarginSec * fps));
  const fromF = Math.min(
    lineStartF + Math.max(0, Math.round(Math.max(0, delaySec) * fps)),
    capF - 1,
  );
  const endF = Math.min(fromF + Math.max(1, Math.round(durationSec * fps)), capF);
  return { fromF, durF: Math.max(1, endF - fromF) };
}
