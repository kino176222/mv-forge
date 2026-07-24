/**
 * CinematicTitle02 — クリーンルーム再実装（外部非参照）。
 *
 * 機能記述: 「荘厳に流れる、極細のワイドトラッキング（字間広め）のシネマタイトル」。
 * - 極細ウェイトの大文字1行タイトルを画面中央にワイドトラッキングで配置。
 * - 文字がキャラ単位で左→右へ、ソフトブラー+フェード+微スライドで順に解像する。
 * - 表示中はごくゆっくり字間が広がり続け、「流れている」荘厳さを保つ。
 * - 終端はキャラ単位で左から順にほどけ、行全体が右へ静かに抜ける。
 *
 * 既定フォントは Google Fonts の Raleway（weight 100）。配布可能で
 * Mac内蔵限定フォントに依存しない。fontFamily prop で差し替え可。
 */
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont as loadRaleway } from "@remotion/google-fonts/Raleway";

const raleway = loadRaleway("normal", { weights: ["100", "200"], subsets: ["latin"] });

export interface CinematicTitle2GRNProps {
  /** タイトル本文（自動で大文字表示） */
  text: string;
  /** 総尺（フレーム）。入退場タイミングはこれに追随する */
  durationInFrames: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Raleway（Google Fonts, 配布可） */
  fontFamily?: string;
  /** 極細ウェイト */
  fontWeight?: number;
  /** 文字色 */
  color?: string;
  /** 基本トラッキング(em)。ワイドが身上 */
  letterSpacingEm?: number;
  /** 全尺かけて広がる追加トラッキング(em)。0で固定 */
  trackingGrowEm?: number;
  /** タイトル中心の縦位置（0=上端, 1=下端） */
  verticalPosition?: number;
  /** 1文字あたりの入場ずらし(フレーム) */
  enterStagger?: number;
  /** 1文字の入場所要(フレーム) */
  enterDuration?: number;
  /** 1文字あたりの退場ずらし(フレーム) */
  exitStagger?: number;
  /** 1文字の退場所要(フレーム) */
  exitDuration?: number;
  /** 入退場時のソフトブラー最大値(px) */
  maxBlurPx?: number;
  /** 退場時に行全体が右へ流れる距離（画面幅比 0〜1） */
  exitDriftRatio?: number;
  /** 大文字化を無効にしたいとき false */
  uppercase?: boolean;
  /** 任意の極小サブタイトル（空なら非表示） */
  subtitle?: string;
  /** サブタイトルのサイズ(px) */
  subtitleFontSize?: number;
}

export const CinematicTitle02: React.FC<CinematicTitle2GRNProps> = ({
  text,
  durationInFrames,
  fontSize = 112,
  fontFamily = raleway.fontFamily,
  fontWeight = 200,
  color = "#ffffff",
  letterSpacingEm = 0.34,
  trackingGrowEm = 0.05,
  verticalPosition = 0.51,
  enterStagger = 1.8,
  enterDuration = 9,
  exitStagger = 2.0,
  exitDuration = 9,
  maxBlurPx = 7,
  exitDriftRatio = 0.02,
  uppercase = true,
  subtitle = "",
  subtitleFontSize = 26,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  const display = uppercase ? text.toUpperCase() : text;
  const chars = useMemo(() => Array.from(display), [display]);
  const n = Math.max(chars.length, 1);

  // 全尺に対する進行度。トラッキングは常にゆっくり広がり続ける（荘厳な「流れ」）。
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const trackingEm = letterSpacingEm + trackingGrowEm * progress;

  // 退場は「最後の文字が尺内に消え切る」ところから逆算して開始。
  const exitSpan = (n - 1) * exitStagger + exitDuration;
  const exitStart = Math.max(durationInFrames - exitSpan - 1, durationInFrames * 0.72);

  // 行全体は退場中に右へ静かに抜ける。
  const drift = interpolate(
    frame,
    [exitStart, durationInFrames],
    [0, width * exitDriftRatio],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.quad),
    }
  );

  // サブタイトルは行全体のフェードに同調（キャラ単位ではなく面で解像）。
  const lineIn = interpolate(frame, [0, (n - 1) * enterStagger + enterDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineOut = interpolate(frame, [exitStart, exitStart + exitSpan], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${verticalPosition * 100}%`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `translateY(-50%) translateX(${drift}px)`,
        }}
      >
        <div
          style={{
            whiteSpace: "pre",
            fontFamily,
            fontWeight,
            fontSize,
            color,
            // letter-spacing は各文字の後ろに付くため、末尾1文字分を打ち消して光学中央に。
            marginRight: `${-trackingEm}em`,
          }}
        >
          {chars.map((ch, i) => {
            const enterFrom = i * enterStagger;
            const appear = interpolate(frame, [enterFrom, enterFrom + enterDuration], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            const exitFrom = exitStart + i * exitStagger;
            const vanish = interpolate(frame, [exitFrom, exitFrom + exitDuration], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.in(Easing.cubic),
            });
            const visibility = appear * vanish;
            const blur = maxBlurPx * (1 - visibility);
            // 入場は左からわずかに滑り込み、退場は右へ送り出す。
            const slide =
              (appear - 1) * fontSize * 0.18 + (1 - vanish) * fontSize * 0.22;
            return (
              <span
                key={`${i}-${ch}`}
                style={{
                  display: "inline-block",
                  letterSpacing: `${trackingEm}em`,
                  opacity: visibility,
                  filter: `blur(${blur.toFixed(2)}px)`,
                  transform: `translateX(${slide.toFixed(2)}px)`,
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: fontSize * 0.55,
              fontFamily,
              fontWeight: Math.min(fontWeight + 100, 300),
              fontSize: subtitleFontSize,
              color,
              letterSpacing: `${trackingEm * 1.6}em`,
              marginRight: `${-trackingEm * 1.6}em`,
              whiteSpace: "pre",
              opacity: lineIn * lineOut * 0.85,
            }}
          >
            {uppercase ? subtitle.toUpperCase() : subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
