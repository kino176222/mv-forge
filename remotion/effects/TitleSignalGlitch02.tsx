import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { sampleCurve, type CurvePoints } from "./xp/curve";
import { hashRand } from "./rand";

const R_X: CurvePoints = [
  [0.625, -30], [0.7083, 30], [0.7917, 0],
  [1.0, 0], [1.0833, -5], [1.1667, 5], [1.25, 0],
  [2.9583, 0], [3.0417, -7], [3.125, 3], [3.2083, 0],
  [5.375, 0], [5.4583, 7], [5.5417, -3], [5.625, 0],
  [6.8333, 0], [6.9167, -30], [7.0, 30], [7.0833, 0],
];
const B_X: CurvePoints = [
  [0.6667, 30], [0.75, -30], [0.8333, 0],
  [1.0, 0], [1.0833, -15], [1.1667, 10], [1.25, 0],
  [2.9583, 0], [3.0417, 5], [3.125, -2], [3.2083, 0],
  [5.375, 0], [5.4583, -5], [5.5417, 2], [5.625, 0],
  [6.875, 0], [6.9583, 30], [7.0417, -30], [7.125, 0],
];
const G_X: CurvePoints = [
  [0.6667, 0], [0.75, -35], [0.8333, 35], [0.9167, 0],
  [6.9167, 0], [7.0, 12], [7.0833, 0],
];

const SEQ_DUR = 0.7917; // Sequence In/Out の長さ(s)
const OUT_START = 6.7083;

const CHANNELS = [
  { color: "#19e0ff", curve: R_X, blend: "screen" as const },
  { color: "#2545ff", curve: B_X, blend: "screen" as const },
  { color: "#ffffff", curve: G_X, blend: "normal" as const },
] as const;

const DASHES = [
  { dx: -0.36, dy: -0.55, w: 26 },
  { dx: 0.33, dy: -0.42, w: 26 },
  { dx: -0.31, dy: 0.52, w: 26 },
  { dx: 0.36, dy: 0.42, w: 26 },
] as const;

export const TitleSignalGlitch02: React.FC<{
  text: string;
  durationInFrames: number;
  fontSize?: number;
  fontFamily?: string;
}> = ({
  text,
  durationInFrames,
  fontSize = 72,
  fontFamily = "'Helvetica Neue', 'Noto Sans JP', sans-serif",
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const tEnd = durationInFrames / fps;
  const scale = width / 1920;
  const chars = [...text];

  // 文字ごとの出現量 (Sequence In/Out。順方向で入り、逆方向で消える)
  const charVis = (i: number): number => {
    const inP = interpolate(
      t,
      [(i / chars.length) * SEQ_DUR, (i / chars.length) * SEQ_DUR + 0.18],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    const oi = chars.length - 1 - i;
    const outAt = tEnd - (SEQ_DUR + 0.5) + (oi / chars.length) * SEQ_DUR;
    const outP = interpolate(t, [outAt, outAt + 0.18], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return Math.min(inP, outP);
  };

  const tCurve = t > OUT_START && tEnd !== 8 ? t - (tEnd - 8) : t;
  const glitchAmount =
    Math.abs(sampleCurve(R_X, tCurve)) + Math.abs(sampleCurve(B_X, tCurve));
  const seed = Math.floor(t * 24);

  const renderText = (color: string, dx: number, blend: "screen" | "normal") => (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        transform: `translateX(${dx * scale}px)`,
        mixBlendMode: blend,
      }}
    >
      <div
        style={{
          fontFamily,
          fontSize,
          fontWeight: 300,
          letterSpacing: "0.45em",
          color,
          whiteSpace: "nowrap",
        }}
      >
        {chars.map((c, i) => (
          <span key={i} style={{ opacity: charVis(i) }}>
            {c}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill>
      {/* ゴーストクローン(シアン/青) + 白本体。整列時はクローンが本体に隠れる */}
      {CHANNELS.map(({ color, curve, blend }) =>
        renderText(color, sampleCurve(curve, tCurve), blend),
      )}

      {/* 色付きスライス破片 (発作中のみ、文字帯の一部を切って下にずらす) */}
      {glitchAmount > 4 &&
        [0, 1].map((i) => {
          const dy = (8 + hashRand(seed, i, 11) * 14) * scale;
          const from = 20 + hashRand(seed, i, 23) * 40;
          return (
            <AbsoluteFill
              key={`s${i}`}
              style={{
                justifyContent: "center",
                alignItems: "center",
                transform: `translate(${(hashRand(seed, i) - 0.5) * 30 * scale}px, ${dy}px)`,
                clipPath: `inset(48% ${95 - from - 25}% 44% ${from}%)`,
                opacity: 0.85,
              }}
            >
              <div
                style={{
                  fontFamily,
                  fontSize,
                  fontWeight: 300,
                  letterSpacing: "0.45em",
                  color: i === 0 ? "#19e0ff" : "#2545ff",
                  whiteSpace: "nowrap",
                }}
              >
                {text}
              </div>
            </AbsoluteFill>
          );
        })}

      {/* アクセント線: 0.5sで引かれ、発作中は明滅、アウトで消える */}
      {DASHES.map((d, i) => {
        const drawn = interpolate(t, [0.4 + i * 0.06, 0.65 + i * 0.06], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const gone = interpolate(t, [OUT_START + (tEnd - 8), OUT_START + (tEnd - 8) + 0.3], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const blink = glitchAmount > 4 && hashRand(seed, i, 41) > 0.5 ? 0 : 1;
        return (
          <AbsoluteFill
            key={`d${i}`}
            style={{ justifyContent: "center", alignItems: "center" }}
          >
            <div
              style={{
                transform: `translate(${d.dx * fontSize * chars.length * 0.42}px, ${d.dy * fontSize * 1.6}px)`,
                width: d.w * drawn * scale,
                height: 2 * scale,
                background: i % 3 === 0 ? "#fff" : i % 3 === 1 ? "#19e0ff" : "#2545ff",
                opacity: drawn * gone * blink,
              }}
            />
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
