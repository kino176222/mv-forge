import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadNotoSansJP } from "@remotion/google-fonts/NotoSansJP";

// 旧既定は Mac ローカルの 'Avenir Next'（幾何学系サンセリフ Medium）。
// 配布ビルドで化けないよう、字形の近い Montserrat 500 に置換し、
// 和文グリフは Noto Sans JP 500 で受ける（旧フォールバックの Hiragino 相当）。
const { fontFamily: MONTSERRAT } = loadMontserrat("normal", {
  weights: ["500"],
  subsets: ["latin", "latin-ext"],
});
const { fontFamily: NOTO_SANS_JP } = loadNotoSansJP("normal", {
  weights: ["500"],
  subsets: ["japanese", "latin"],
});

/**
 * SubtitleKaraoke10 — 画面下部で黄色が流れていく定番のカラオケ塗り字幕。
 *
 * クリーンルーム実装（機能記述と旧レンダの見た目のみを根拠に白紙から作成）。
 * 3幕構成のスイープをすべて「左→右の文字単位ソフトエッジ」で統一している:
 *   1. 入場: 白文字が左から順にフェードイン
 *   2. 塗り: 黄色のハイライトが左→右に流れ、歌い終わった文字を塗り替える
 *   3. 退場: 左から順にフェードアウト
 * レイアウト・色・サイズ・タイミングはすべて props のつまみで調整可能。
 */
export type SubtitleKaraoke10Props = {
  /** 表示する歌詞・字幕（1行） */
  text: string;
  /** この字幕が画面に居る総フレーム数（Sequence の長さに合わせる） */
  durationInFrames: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Montserrat（幾何学系サンセリフ）→ Noto Sans JP フォールバック */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number;
  /** 字間(em)。カラオケ字幕らしい広めトラッキングが既定 */
  letterSpacingEm?: number;
  /** 塗られる前の文字色 */
  baseColor?: string;
  /** 塗り終わった文字色（カラオケハイライト） */
  fillColor?: string;
  /** 行の水平中心 0..1（0.5=画面中央） */
  posX?: number;
  /** 行の垂直中心 0..1（既定は下部 0.8） */
  posY?: number;
  /** 入場スイープの長さ(フレーム) */
  inDurationFrames?: number;
  /** 退場スイープの長さ(フレーム) */
  outDurationFrames?: number;
  /**
   * 塗りが始まるフレーム。省略時は入場完了直後。
   * ワードタイミングに合わせたい時にここと fillEndFrame を差し替える。
   */
  fillStartFrame?: number;
  /** 塗りが完了するフレーム。省略時は退場開始の少し手前 */
  fillEndFrame?: number;
  /** スイープ先端のぼかし幅（文字数）。大きいほど柔らかく流れる */
  edgeSoftnessChars?: number;
};

/** "#rrggbb" → [r,g,b]（省略形 #rgb も許容） */
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

const mixRgb = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): string => {
  const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
};

/**
 * 左→右スイープの文字別進捗。
 * progress(0..1) がスイープ全体の進み、i が文字番号。
 * 先端に softness 文字ぶんの勾配を持たせ、0(未到達)→1(通過済み) を返す。
 */
const sweepAmount = (
  progress: number,
  charIndex: number,
  charCount: number,
  softness: number,
): number => {
  const edge = progress * (charCount + softness);
  return Math.min(1, Math.max(0, (edge - charIndex) / Math.max(softness, 0.001)));
};

export const SubtitleKaraoke10: React.FC<SubtitleKaraoke10Props> = ({
  text,
  durationInFrames,
  fontSize = 74,
  fontFamily = `'${MONTSERRAT}', '${NOTO_SANS_JP}', sans-serif`,
  fontWeight = 500,
  letterSpacingEm = 0.16,
  baseColor = "#ffffff",
  fillColor = "#ffea6a",
  posX = 0.5,
  posY = 0.8,
  inDurationFrames = 8,
  outDurationFrames = 10,
  fillStartFrame,
  fillEndFrame,
  edgeSoftnessChars = 5,
}) => {
  const frame = useCurrentFrame();
  const chars = useMemo(() => Array.from(text), [text]);
  const n = chars.length;

  const outStart = durationInFrames - outDurationFrames;
  const fillFrom = fillStartFrame ?? inDurationFrames + 4;
  const fillTo = fillEndFrame ?? Math.max(fillFrom + 1, outStart - 4);

  const inProgress = interpolate(frame, [0, inDurationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fillProgress = interpolate(frame, [fillFrom, fillTo], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outProgress = interpolate(frame, [outStart, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const baseRgb = useMemo(() => hexToRgb(baseColor), [baseColor]);
  const fillRgb = useMemo(() => hexToRgb(fillColor), [fillColor]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: `${posY * 100}%`,
          left: `${(posX - 0.5) * 100}%`,
          width: "100%",
          transform: "translateY(-50%)",
          textAlign: "center",
          whiteSpace: "nowrap",
          fontFamily,
          fontWeight,
          fontSize,
          letterSpacing: `${letterSpacingEm}em`,
          lineHeight: 1.2,
        }}
      >
        {chars.map((ch, i) => {
          const appear = sweepAmount(inProgress, i, n, edgeSoftnessChars);
          const paint = sweepAmount(fillProgress, i, n, edgeSoftnessChars);
          const vanish = sweepAmount(outProgress, i, n, edgeSoftnessChars);
          const opacity = appear * (1 - vanish);
          return (
            <span
              key={i}
              style={{
                color: mixRgb(baseRgb, fillRgb, paint),
                opacity,
              }}
            >
              {ch === " " ? " " : ch}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
