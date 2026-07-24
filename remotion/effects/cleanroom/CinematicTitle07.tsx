import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadJost } from "@remotion/google-fonts/Jost";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";

/**
 * CinematicTitle07 — クリーンルーム再実装
 *
 * 文字がランダム順に灯る、荘厳なシネマティックタイトル。
 * 細身サンセリフ・全大文字・広トラッキングのメインタイトルが画面中央
 * やや上に置かれ、1文字ずつランダムな順番でフワッとフェードイン
 * （わずかに上へドリフト）して灯る。荘厳にホールドしたのち、終端側では
 * 再びランダム順にディゾルブして消える。最下部には極小・広トラッキングの
 * クレジット行（強調トークンのみ明るく太い）が少し遅れてフェードイン、
 * 終端で先にフェードアウトする。背景は既定で透過。
 *
 * 機能記述「文字がランダム順に灯る、荘厳なシネマティックタイトル」を
 * 出発点に、旧レンダリング（見た目のものさし）と同等以上の質感を
 * 白紙から構成したもの。フォントは配布可能な Google Fonts
 * （Jost / Oswald）のみに依存する。
 */

const { fontFamily: JOST } = loadJost("normal", {
  weights: ["200", "300"],
  subsets: ["latin"],
});
const { fontFamily: OSWALD } = loadOswald("normal", {
  weights: ["300", "600"],
  subsets: ["latin"],
});

export type CinematicTitle07Props = {
  /**
   * 表示する文言。1行目がメインタイトル。
   * "\n" で2行目を書くと最下部クレジット行の文言になる。
   */
  text?: string;
  /** 演出全体の尺（フレーム）。イン→ホールド→アウトをこの中に収める。 */
  durationInFrames?: number;

  /** メインタイトルの文字サイズ(px) */
  fontSize?: number;
  /** メインタイトルのフォント */
  fontFamily?: string;
  /** メインタイトルの太さ（細身が既定） */
  fontWeight?: number | string;
  /** メインタイトルの文字色 */
  color?: string;
  /** メインタイトルのトラッキング（fontSize に対する em 比） */
  trackingEm?: number;
  /** タイトル行の中心位置 Y（0〜1、画面高比。中央よりやや上が既定） */
  posY?: number;
  /** 大文字化するか */
  uppercase?: boolean;

  /** クレジット行を表示するか */
  showCredit?: boolean;
  /** クレジット行の文言（text の2行目があればそちらを優先） */
  creditText?: string;
  /** クレジット行の文字サイズ(px) */
  creditFontSize?: number;
  /** クレジット行のフォント（コンデンス系が既定） */
  creditFontFamily?: string;
  /** クレジット行の基本色（控えめなグレーが既定） */
  creditColor?: string;
  /** クレジット行の強調トークンの色 */
  creditAccentColor?: string;
  /** 強調するトークン（空白区切りの語のindex。省略時は中央の語） */
  creditAccentToken?: number;
  /** クレジット行のトラッキング（em 比） */
  creditTrackingEm?: number;
  /** クレジット行の中心位置 Y（0〜1、画面高比） */
  creditPosY?: number;

  /** 全文字が灯り終わるまでの窓（秒） */
  inSeconds?: number;
  /** 1文字のフェードイン所要（秒） */
  charFadeSeconds?: number;
  /** フェードイン時に上へドリフトする距離(px) */
  driftPx?: number;
  /** 全文字が消え終わるまでの窓（秒）。尺の末尾から確保する */
  outSeconds?: number;
  /** 1文字のフェードアウト所要（秒） */
  charOutSeconds?: number;
  /** クレジット行が出始めるまでの遅れ（秒） */
  creditDelaySeconds?: number;
  /** クレジット行のフェード所要（秒） */
  creditFadeSeconds?: number;

  /** 文字が灯る/消える順番を変えるシード */
  seed?: number;
  /** 背景色（既定は透過。黒地デモなら "#000"） */
  background?: string;
};

/** 決定的な擬似乱数（seed 固定で毎フレーム同じ並びを返す） */
const makeRandom = (seed: number) => {
  let state = (seed * 1103515245 + 12345) >>> 0;
  return () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state / 4294967295;
  };
};

/** 0..n-1 の決定的シャッフル順列 */
const shuffledOrder = (n: number, seed: number): number[] => {
  const rand = makeRandom(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const CinematicTitle07: React.FC<CinematicTitle07Props> = ({
  text = "ECLIPSE",
  durationInFrames,
  fontSize = 118,
  fontFamily = JOST,
  fontWeight = 200,
  color = "#ffffff",
  trackingEm = 0.34,
  posY = 0.475,
  uppercase = true,
  showCredit = true,
  creditText = "AN ORIGINAL MUSIC VIDEO PRODUCTION",
  creditFontSize = 27,
  creditFontFamily = OSWALD,
  creditColor = "rgba(255, 255, 255, 0.55)",
  creditAccentColor = "#ffffff",
  creditAccentToken,
  creditTrackingEm = 0.56,
  creditPosY = 0.875,
  inSeconds = 1.15,
  charFadeSeconds = 0.45,
  driftPx = 16,
  outSeconds = 1.75,
  charOutSeconds = 0.85,
  creditDelaySeconds = 0.7,
  creditFadeSeconds = 1.0,
  seed = 7,
  background = "transparent",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames: compDuration, height } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  // 1行目 = タイトル、2行目があればクレジット行として使う
  const [rawTitle, rawCredit] = useMemo(() => {
    const lines = text.split("\n").map((l) => l.trim());
    return [lines[0] ?? "", lines.slice(1).join(" ").trim()];
  }, [text]);
  const title = uppercase ? rawTitle.toUpperCase() : rawTitle;
  const credit = (rawCredit || creditText).toUpperCase();

  const chars = useMemo(() => Array.from(title), [title]);

  // 空白以外の文字だけをランダム順に灯す
  const animatable = useMemo(
    () => chars.map((c, i) => ({ c, i })).filter(({ c }) => c.trim() !== ""),
    [chars]
  );
  const inOrder = useMemo(
    () => shuffledOrder(animatable.length, seed),
    [animatable.length, seed]
  );
  const outOrder = useMemo(
    () => shuffledOrder(animatable.length, seed + 101),
    [animatable.length, seed]
  );

  const charFade = Math.max(1, charFadeSeconds * fps);
  const inWindow = Math.max(charFade, inSeconds * fps);
  const charOut = Math.max(1, charOutSeconds * fps);
  const outWindow = Math.max(charOut, outSeconds * fps);
  const outStart = Math.max(inWindow, total - outWindow);

  // 各文字のイン/アウト開始フレーム（順列位置を窓に散らす）
  const slots = useMemo(() => {
    const rand = makeRandom(seed + 977);
    const n = Math.max(1, animatable.length);
    return animatable.map((_, k) => {
      const jitter = (rand() - 0.5) * 0.6;
      const inPos = clamp01((inOrder[k] + 0.5 + jitter) / n);
      const outPos = clamp01((outOrder[k] + 0.5 + jitter) / n);
      return { inPos, outPos };
    });
  }, [animatable, inOrder, outOrder, seed]);

  const tracking = fontSize * trackingEm;

  // クレジット行の進行
  const creditIn = clamp01(
    (frame - creditDelaySeconds * fps) / Math.max(1, creditFadeSeconds * fps)
  );
  const creditOutDur = Math.max(1, 0.35 * fps);
  const creditOut = clamp01(
    (frame - (total - creditOutDur - 0.5 * fps)) / creditOutDur
  );
  const creditOpacity = easeOutCubic(creditIn) * (1 - creditOut);

  const creditTokens = useMemo(() => credit.split(/\s+/).filter(Boolean), [
    credit,
  ]);
  const accentIndex =
    creditAccentToken ?? Math.floor(creditTokens.length / 2);

  let animIdx = -1;

  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      {/* メインタイトル：1文字ずつランダム順に灯る */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: posY * height,
          transform: "translateY(-50%)",
          display: "flex",
          justifyContent: "center",
          whiteSpace: "pre",
        }}
      >
        {chars.map((c, i) => {
          const isSpace = c.trim() === "";
          let opacity = 1;
          let dy = 0;
          if (!isSpace) {
            animIdx++;
            const { inPos, outPos } = slots[animIdx] ?? {
              inPos: 0,
              outPos: 0,
            };
            const inStart = inPos * Math.max(0, inWindow - charFade);
            const tIn = easeOutCubic(clamp01((frame - inStart) / charFade));
            const outBegin =
              outStart + outPos * Math.max(0, outWindow - charOut);
            const tOut = easeInCubic(clamp01((frame - outBegin) / charOut));
            opacity = tIn * (1 - tOut);
            dy = (1 - tIn) * driftPx - tOut * driftPx * 0.35;
          }
          return (
            <span
              key={`${i}-${c}`}
              style={{
                fontFamily,
                fontWeight,
                fontSize,
                color,
                opacity,
                transform: `translateY(${dy}px)`,
                marginRight: i === chars.length - 1 ? 0 : tracking,
                lineHeight: 1.1,
              }}
            >
              {c}
            </span>
          );
        })}
      </div>

      {/* 最下部クレジット行：少し遅れて全体フェード、強調トークンのみ明るく太い */}
      {showCredit && creditTokens.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: creditPosY * height,
            transform: "translateY(-50%)",
            display: "flex",
            justifyContent: "center",
            whiteSpace: "pre",
            opacity: creditOpacity,
          }}
        >
          {creditTokens.map((token, ti) => (
            <span
              key={`${ti}-${token}`}
              style={{
                fontFamily: creditFontFamily,
                fontSize: creditFontSize,
                fontWeight: ti === accentIndex ? 600 : 300,
                color: ti === accentIndex ? creditAccentColor : creditColor,
                letterSpacing: creditFontSize * creditTrackingEm,
                marginRight:
                  ti === creditTokens.length - 1
                    ? 0
                    : creditFontSize * creditTrackingEm * 1.6,
                lineHeight: 1.2,
              }}
            >
              {token}
            </span>
          ))}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
