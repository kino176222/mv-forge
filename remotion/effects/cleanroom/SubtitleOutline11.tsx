import React, { useMemo } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { loadFont } from "@remotion/google-fonts/Khand";

const { fontFamily: defaultFontFamily } = loadFont("normal", {
  weights: ["400", "500"],
  subsets: ["latin"],
});

/**
 * SubtitleOutline11 — クリーンルーム実装
 *
 * 巨大な白い輪郭文字を内側から白で埋めていくカラオケ式字幕。
 * 1. イントロ: 文字ごとに左→右の順で輪郭がすばやくフェードイン
 * 2. 塗り:     単語ごとに右→左の順で白ベタがフェードイン（輪郭は常時表示）
 * 3. アウトロ: 文字ごとに左→右の順で全体（輪郭+塗り）がフェードアウト
 *
 * タイミングは durationInFrames に対する割合で持つため、尺を変えても
 * 同じ振り付けで伸縮する。
 */
export type SubtitleOutline11Props = {
  /** 表示する文言（スペース区切りで単語単位の塗りになる） */
  text?: string;
  /** エフェクト全体の長さ（フレーム）。タイミングはこの値に比例して伸縮 */
  durationInFrames?: number;
  /** 文字サイズ(px) */
  fontSize?: number;
  /** フォント。既定は Khand（コンデンス体・輪郭がきれいに出る） */
  fontFamily?: string;
  /** フォントウェイト */
  fontWeight?: number | string;
  /** 輪郭・塗りの色 */
  color?: string;
  /** 輪郭の太さ(px) */
  outlineWidth?: number;
  /** 字間(em) */
  letterSpacing?: number;
  /** 単語間の追加スペース(em) */
  wordSpacing?: number;
  /** 横方向の圧縮率（1で等倍、小さいほどコンデンス） */
  condense?: number;
  /** 中心位置X（画面幅に対する%） */
  posX?: number;
  /** 中心位置Y（画面高さに対する%） */
  posY?: number;
  /** イントロ完了位置（全体に対する割合 0-1） */
  introEndRatio?: number;
  /** 塗り開始位置（全体に対する割合 0-1） */
  fillStartRatio?: number;
  /** 塗り終了位置（全体に対する割合 0-1） */
  fillEndRatio?: number;
  /** 1単語の塗りフェード長（全体に対する割合 0-1） */
  fillFadeRatio?: number;
  /** アウトロ開始位置（全体に対する割合 0-1） */
  outStartRatio?: number;
  /** アウトロ完了位置（全体に対する割合 0-1） */
  outEndRatio?: number;
};

type CharCell = {
  char: string;
  /** スペースを除いた通し番号（ステガー用） */
  charIndex: number;
  /** 所属する単語番号（左から0..） */
  wordIndex: number;
};

export const SubtitleOutline11: React.FC<SubtitleOutline11Props> = ({
  text = "CALL ME UP",
  durationInFrames = 72,
  fontSize = 570,
  fontFamily = defaultFontFamily,
  fontWeight = 500,
  color = "#ffffff",
  outlineWidth = 4,
  letterSpacing = 0.016,
  wordSpacing = -0.042,
  condense = 0.83,
  posX = 50.3,
  posY = 48.6,
  introEndRatio = 0.105,
  fillStartRatio = 0.305,
  fillEndRatio = 0.695,
  fillFadeRatio = 0.085,
  outStartRatio = 0.73,
  outEndRatio = 0.955,
}) => {
  const frame = useCurrentFrame();

  const cells = useMemo<CharCell[]>(() => {
    const result: CharCell[] = [];
    let wordIndex = 0;
    let charIndex = 0;
    for (const ch of [...text.toUpperCase()]) {
      if (ch === " ") {
        wordIndex += 1;
        result.push({ char: ch, charIndex: -1, wordIndex });
        continue;
      }
      result.push({ char: ch, charIndex, wordIndex });
      charIndex += 1;
    }
    return result;
  }, [text]);

  const totalChars = cells.filter((c) => c.charIndex >= 0).length;
  const wordCount = cells.length ? cells[cells.length - 1].wordIndex + 1 : 0;

  // --- タイムライン（全体長に比例） ---
  // イントロ: 文字ごとフェードイン（左→右）
  const introEnd = durationInFrames * introEndRatio;
  const introFade = introEnd * 0.35;
  const introStagger =
    totalChars > 1 ? (introEnd - introFade) / (totalChars - 1) : 0;

  // 塗り: 単語ごとフェードイン（右→左）。輪郭はそのまま残る
  const fillStart = durationInFrames * fillStartRatio;
  const fillEnd = durationInFrames * fillEndRatio;
  const fillFade = durationInFrames * fillFadeRatio;
  const fillStagger =
    wordCount > 1 ? (fillEnd - fillStart - fillFade) / (wordCount - 1) : 0;

  // アウトロ: 文字ごと素早くフェードアウト（左→右）
  const outStart = durationInFrames * outStartRatio;
  const outEnd = durationInFrames * outEndRatio;
  const outFade = durationInFrames * 0.024;
  const outStagger =
    totalChars > 1 ? (outEnd - outStart - outFade) / (totalChars - 1) : 0;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${posX}%`,
          top: `${posY}%`,
          transform: `translate(-50%, -50%) scaleX(${condense})`,
          whiteSpace: "pre",
          fontFamily,
          fontWeight,
          fontSize,
          letterSpacing: `${letterSpacing}em`,
          wordSpacing: `${wordSpacing}em`,
          lineHeight: 1,
        }}
      >
        {cells.map((cell, i) => {
          if (cell.charIndex < 0) {
            return <span key={i}>{cell.char}</span>;
          }

          const inStart = cell.charIndex * introStagger;
          const appear = interpolate(
            frame,
            [inStart, inStart + introFade],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          const fillRank = wordCount - 1 - cell.wordIndex; // 右の単語から
          const wordFillStart = fillStart + fillRank * fillStagger;
          const fill = interpolate(
            frame,
            [wordFillStart, wordFillStart + fillFade],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          const charOutStart = outStart + cell.charIndex * outStagger;
          const vanish = interpolate(
            frame,
            [charOutStart, charOutStart + outFade],
            [1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          return (
            <span
              key={i}
              style={{
                position: "relative",
                display: "inline-block",
                opacity: appear * vanish,
              }}
            >
              <span
                style={{
                  color: "transparent",
                  WebkitTextStroke: `${outlineWidth}px ${color}`,
                }}
              >
                {cell.char}
              </span>
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  color,
                  opacity: fill,
                }}
              >
                {cell.char}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
};
