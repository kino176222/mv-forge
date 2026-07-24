/**
 * SubtitleSink01 — 読むほど沈む、赤いカラオケ風ローワーサード字幕（クリーンルーム再実装）。
 *
 * 挙動（機能記述と旧レンダーの見た目のみを根拠に設計）:
 *  1. イン: 文字が左から右へ高速タイプライターで現れる（明るい赤＋赤グロー）
 *  2. カラオケ沈み: 「読み終わった」文字が左から順に暗い赤へ沈み、グローが消える
 *  3. ホールド: 全文が暗赤のまま静止
 *  4. アウト: 左から順に文字が消えていく高速デリート
 *
 * レイアウト・色・タイミングはすべて props で調整可能。既定値だけで完成した見た目になる。
 */
import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

const { fontFamily: POPPINS } = loadPoppins("normal", {
  weights: ["800", "900"],
  subsets: ["latin", "latin-ext"],
});

/* ---------- 色ユーティリティ ---------- */

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const s =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mixRgb = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

const rgbCss = (c: [number, number, number], alpha = 1) =>
  alpha >= 1
    ? `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

/** 0→1 の滑らかな補間（境界を数文字ぶんソフトにするため） */
const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/* ---------- Props ---------- */

export interface SubtitleSink2897LineStyle {
  /** この行だけ色を変える（未読色） */
  color?: string;
  /** この行だけ沈み色を変える */
  sunkColor?: string;
  /** この行だけ文字サイズを変える（px） */
  fontSize?: number;
}

export interface SubtitleSink2897Props {
  /** 歌詞・字幕テキスト。"\n" で複数行（中央揃え） */
  text?: string;
  /** エフェクト全体の尺（フレーム）。イン/沈み/アウトの既定タイミングはこれに比例 */
  durationInFrames?: number;
  /** 文字サイズ（px） */
  fontSize?: number;
  /** 行送り（fontSize に対する倍率） */
  lineHeight?: number;
  /** フォント。既定は超極太ジオメトリックサンズ */
  fontFamily?: string;
  fontWeight?: React.CSSProperties["fontWeight"];
  /** 字間。詰め気味が既定 */
  letterSpacing?: string;
  /** 未読部分の色（明るい赤） */
  color?: string;
  /** 読了部分の沈み色。省略時は color を暗くした色を自動生成 */
  sunkColor?: string;
  /** グロー強度 0..1（0 でグローなし） */
  glow?: number;
  /** テキストブロック中心の横位置（画面幅に対する %） */
  posX?: number;
  /** テキストブロック中心の縦位置（画面高に対する %） */
  posY?: number;
  /** タイプイン所要フレーム数。省略時は尺の約10% */
  typeInFrames?: number;
  /** タイプアウト（左から消える）所要フレーム数。省略時は尺の約8.5% */
  typeOutFrames?: number;
  /** 沈み開始フレーム。省略時は尺の約14% */
  sinkStartFrame?: number;
  /** 沈み完了フレーム。省略時は尺の約87% */
  sinkEndFrame?: number;
  /** 沈み境界のソフトさ（文字数） */
  sinkSoftness?: number;
  /** 行ごとの上書きスタイル（0始まり。副題行だけ色を変える等） */
  lineStyles?: SubtitleSink2897LineStyle[];
}

/* ---------- 本体 ---------- */

export const SubtitleSink01: React.FC<SubtitleSink2897Props> = ({
  text = "Hold me close and we will light the way\nto carry on because I'm meant to stay",
  durationInFrames = 72,
  fontSize = 72,
  lineHeight = 1.05,
  fontFamily = POPPINS,
  fontWeight = 900,
  letterSpacing = "-0.02em",
  color = "#FF180C",
  sunkColor,
  glow = 1,
  posX = 50,
  posY = 51,
  typeInFrames,
  typeOutFrames,
  sinkStartFrame,
  sinkEndFrame,
  sinkSoftness = 3,
  lineStyles = [],
}) => {
  const frame = useCurrentFrame();

  // Array.from はサロゲートペア（絵文字等）を1文字として数える（.length は破壊する）
  const lines = useMemo(() => text.split("\n").map((l) => Array.from(l)), [text]);
  const totalChars = useMemo(
    () => lines.reduce((acc, l) => acc + l.length, 0),
    [lines],
  );

  // 既定タイミング（尺に比例、props で個別上書き可）
  const tIn = typeInFrames ?? Math.max(2, durationInFrames * 0.085);
  const tOut = typeOutFrames ?? Math.max(2, durationInFrames * 0.078);
  const sinkStart = sinkStartFrame ?? durationInFrames * 0.14;
  const sinkEnd = sinkEndFrame ?? durationInFrames * 0.875;

  const brightRgb = useMemo(() => hexToRgb(color), [color]);
  const defaultSunkRgb = useMemo(
    () => mixRgb(brightRgb, [0, 0, 0], 0.7),
    [brightRgb],
  );

  // 沈みスイープの現在位置（文字インデックス単位）。境界ソフト分だけ余分に走らせる
  const sweep = interpolate(
    frame,
    [sinkStart, sinkEnd],
    [0, totalChars + sinkSoftness * 2],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // 最後の文字のフェードが尺の終端ちょうどで終わるよう、フェード分を先に引く
  const outStart = durationInFrames - tOut - 0.5;

  let globalIndex = 0;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${posX}%`,
          top: `${posY}%`,
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          whiteSpace: "pre",
          fontFamily,
          fontWeight,
          fontSize,
          letterSpacing,
          lineHeight,
        }}
      >
        {lines.map((line, li) => {
          const ls = lineStyles[li] ?? {};
          const lineBright = ls.color ? hexToRgb(ls.color) : brightRgb;
          const lineSunk = ls.sunkColor
            ? hexToRgb(ls.sunkColor)
            : ls.color
              ? mixRgb(lineBright, [0, 0, 0], 0.7)
              : sunkColor
                ? hexToRgb(sunkColor)
                : defaultSunkRgb;
          const lineSize = ls.fontSize;

          return (
            <div key={li} style={lineSize ? { fontSize: lineSize } : undefined}>
              {line.map((ch, ci) => {
                const i = globalIndex++;

                // イン: 左から高速タイプ（1文字ずつポップイン）
                const appearAt = (i / Math.max(1, totalChars)) * tIn;
                const inOpacity = interpolate(
                  frame,
                  [appearAt, appearAt + 0.15],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                );

                // アウト: 左から高速デリート
                const vanishAt =
                  outStart + (i / Math.max(1, totalChars)) * tOut;
                const outOpacity = interpolate(
                  frame,
                  [vanishAt, vanishAt + 0.8],
                  [1, 0],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                );

                // カラオケ沈み: スイープが通過した文字は暗赤へ
                const sink = smoothstep(
                  (sweep - i) / Math.max(0.001, sinkSoftness),
                );

                const fill = mixRgb(lineBright, lineSunk, sink);
                const glowAlpha = glow * (1 - sink) * inOpacity * outOpacity;

                const style: React.CSSProperties = {
                  color: rgbCss(fill),
                  opacity: inOpacity * outOpacity,
                };
                if (glowAlpha > 0.01) {
                  style.textShadow = [
                    `0 0 0.1em ${rgbCss(lineBright, 0.7 * glowAlpha)}`,
                    `0 0 0.26em ${rgbCss(lineBright, 0.4 * glowAlpha)}`,
                  ].join(", ");
                }

                return (
                  <span key={ci} style={style}>
                    {ch}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
