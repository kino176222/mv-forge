/**
 * SubtitleHandwrite05 — 手描き風の文字が揺れて灯る字幕（クリーンルーム再実装）。
 *
 * 機能記述: 手書き風の縦長大文字が画面下部に置かれ、左から順に素早く
 * フェードインして「灯り」、常時コマ打ちの揺らぎ（ボイル）で手描きアニメの
 * 質感を保ち、終端では左から順にフェードアウトする。
 *
 * 既定フォントは Google Fonts の Amatic SC（OFL・配布可能）。
 * レイアウト / 色 / サイズ / タイミングはすべて props で調整できる。
 */
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont as loadAmaticSC } from "@remotion/google-fonts/AmaticSC";

const { fontFamily: AMATIC_SC } = loadAmaticSC("normal", {
  weights: ["700"],
  subsets: ["latin"],
});

export interface SubtitleHandwrite05Props {
  /** 表示する文言。\n で複数行。 */
  text?: string;
  /** 演出の全体尺（フレーム）。省略時はコンポジションの尺。 */
  durationInFrames?: number;
  /** 書体。既定は Amatic SC（Google Fonts・配布可）。 */
  fontFamily?: string;
  /** フォントサイズ(px)。 */
  fontSize?: number;
  /** フォントウェイト。 */
  fontWeight?: number;
  /** 文字色。 */
  color?: string;
  /** 字間(em)。 */
  letterSpacingEm?: number;
  /** 行間（fontSize に対する倍率）。 */
  lineHeight?: number;
  /** テキストブロックの下端位置（画面高さに対する下からの割合 0-1）。 */
  bottomRatio?: number;
  /** 水平揃え。 */
  align?: "left" | "center" | "right";
  /** 左右の安全マージン(px)。align が left/right のときに効く。 */
  sideMargin?: number;
  /** 1文字あたりの入場フェード長（フレーム）。 */
  enterFadeFrames?: number;
  /** 入場の文字送り（フレーム/文字）。 */
  enterStagger?: number;
  /** 1文字あたりの退場フェード長（フレーム）。 */
  exitFadeFrames?: number;
  /** 退場の文字送り（フレーム/文字）。 */
  exitStagger?: number;
  /** ボイル（コマ打ち揺らぎ）の打ち替え頻度（回/秒）。 */
  boilRate?: number;
  /** ボイルの平行移動量(px)。 */
  boilShift?: number;
  /** ボイルの回転量(deg)。 */
  boilRotate?: number;
  /** ボイルの縦伸縮量（scaleY の振れ幅、0-1）。 */
  boilStretch?: number;
  /** 灯りのにじみ色。 */
  glowColor?: string;
  /** 灯りのにじみ半径(px)。0 で無効。 */
  glowRadius?: number;
  /** 灯りの明滅の強さ（0-1）。 */
  glowFlicker?: number;
  /** 乱数の種。同じ種なら毎回同じ揺らぎ。 */
  seed?: string;
}

/** 決定論的な -1..1 の乱数（remotion の random を利用）。 */
const jitter = (key: string): number => random(key) * 2 - 1;

export const SubtitleHandwrite05: React.FC<SubtitleHandwrite05Props> = ({
  text = "Way up in the violet sky",
  durationInFrames,
  fontFamily = AMATIC_SC,
  fontSize = 150,
  fontWeight = 700,
  color = "#ffffff",
  letterSpacingEm = 0.05,
  lineHeight = 1.12,
  bottomRatio = 0.18,
  align = "center",
  sideMargin = 120,
  enterFadeFrames = 2.5,
  enterStagger = 0.22,
  exitFadeFrames = 2.5,
  exitStagger = 0.25,
  boilRate = 8,
  boilShift = 2.2,
  boilRotate = 2.4,
  boilStretch = 0.055,
  glowColor = "rgba(255, 244, 214, 0.35)",
  glowRadius = 7,
  glowFlicker = 0.3,
  seed = "handwrite05",
}) => {
  const frame = useCurrentFrame();
  const { fps, height, durationInFrames: compDuration } = useVideoConfig();
  const total = durationInFrames ?? compDuration;

  // ボイルはコマ打ち：boilRate 回/秒で乱数を打ち替える
  const boilStep = Math.floor((frame * boilRate) / fps);

  const lines = useMemo(() => text.split("\n"), [text]);
  const charCount = useMemo(
    () => lines.reduce((n, line) => n + line.length, 0),
    [lines],
  );

  // 退場は「最後の文字が尺の終端でちょうど消える」よう終端から逆算
  const exitStart =
    total - exitFadeFrames - Math.max(charCount - 1, 0) * exitStagger;

  const alignItems =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  let charIndex = -1;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems,
        paddingBottom: bottomRatio * height,
        paddingLeft: sideMargin,
        paddingRight: sideMargin,
        pointerEvents: "none",
      }}
    >
      {lines.map((line, lineIdx) => (
        <div
          key={lineIdx}
          style={{
            display: "flex",
            flexDirection: "row",
            whiteSpace: "pre",
            lineHeight,
          }}
        >
          {Array.from(line).map((ch, i) => {
            charIndex += 1;
            const c = charIndex;

            // 入場：左から順に素早くフェードイン
            const enterOpacity = interpolate(
              frame,
              [c * enterStagger, c * enterStagger + enterFadeFrames],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );

            // 退場：左から順にフェードアウト（終端で全消灯）
            const exitOpacity = interpolate(
              frame,
              [exitStart + c * exitStagger, exitStart + c * exitStagger + exitFadeFrames],
              [1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );

            const opacity = enterOpacity * exitOpacity;

            // ボイル：文字ごと×コマ打ちステップごとに位置・回転・縦伸縮を揺らす
            const k = `${seed}:${c}:${boilStep}`;
            const dx = jitter(`${k}:x`) * boilShift;
            const dy = jitter(`${k}:y`) * boilShift;
            const rot = jitter(`${k}:r`) * boilRotate;
            const sy = 1 + jitter(`${k}:s`) * boilStretch;

            // 灯り：にじみがコマ打ちでゆっくり明滅する
            const glowScale =
              1 + glowFlicker * jitter(`${seed}:glow:${boilStep}:${c % 5}`);
            const textShadow =
              glowRadius > 0
                ? `0 0 ${glowRadius * glowScale}px ${glowColor}, 0 0 ${
                    glowRadius * 2.2 * glowScale
                  }px ${glowColor}`
                : undefined;

            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  fontFamily,
                  fontSize,
                  fontWeight,
                  color,
                  letterSpacing: `${letterSpacingEm}em`,
                  opacity,
                  textShadow,
                  transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scaleY(${sy})`,
                  transformOrigin: "50% 80%",
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
      ))}
    </AbsoluteFill>
  );
};
