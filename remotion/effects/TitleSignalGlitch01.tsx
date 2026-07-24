import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { hashRand } from "./rand";

const BURSTS: Array<{ start: number; end: number; prism: number }> = [
  { start: 0.0, end: 0.42, prism: 8 },
  { start: 1.25, end: 1.5, prism: 13 },
  { start: 1.96, end: 2.13, prism: 10 },
  { start: 4.17, end: 4.58, prism: 13 },
  { start: 4.88, end: 5.04, prism: 10 },
];

const IN_DURATION = 0.625; // s
const OUT_DURATION = 1.4; // s
const IN_OFFSET = 1172; // px (1920px基準)
const OUT_OFFSET = -460; // px

const SLICES = 8;

const WARM = "rgba(255, 207, 163, 0.85)";
const CYAN = "rgba(0, 255, 255, 0.85)";

export const TitleSignalGlitch01: React.FC<{
  text: string;
  durationInFrames: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}> = ({
  text,
  durationInFrames,
  fontSize = 64,
  fontFamily = "'Helvetica Neue', 'Noto Sans JP', sans-serif",
  color = "#fff",
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const tEnd = durationInFrames / fps;

  // ---- Offset (横スライド + 画面端で折り返し) ----
  const scale = width / 1920;
  const inOffset = interpolate(
    t,
    [0, 0.375, IN_DURATION],
    [IN_OFFSET * scale, 758 * scale, 0],
    { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) },
  );
  const outOffset = interpolate(
    t,
    [tEnd - OUT_DURATION, tEnd - OUT_DURATION + 0.25, tEnd - 0.4],
    [0, -250 * scale, OUT_OFFSET * scale],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) },
  );
  const offset = inOffset + outOffset;

  // ---- 発作の強度 (0→1→0 の三角エンベロープ) ----
  const inOut =
    t < IN_DURATION || t > tEnd - OUT_DURATION
      ? { start: t < IN_DURATION ? 0 : tEnd - OUT_DURATION, end: t < IN_DURATION ? 0.42 : tEnd - 0.4, prism: 13 }
      : null;
  const active = inOut ?? BURSTS.find((b) => t >= b.start && t <= b.end) ?? null;
  let intensity = 0;
  let prismPx = 0;
  if (active) {
    const mid = (active.start + active.end) / 2;
    intensity = interpolate(t, [active.start, mid, active.end], [0, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    prismPx = active.prism * intensity * scale;
  }

  // ---- Glowパルス (元kf: 1.0s/2.0s/4.9s/アウト時) ----
  const glowTimes = [1.04, 2.04, 4.96, tEnd - OUT_DURATION + 0.2];
  const glow = glowTimes.reduce((acc, gt) => {
    const g = interpolate(t, [gt - 0.08, gt, gt + 0.12], [0, 1.7, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return Math.max(acc, g);
  }, 0);

  // ---- スライスずれ (Scrape相当。発作中のみ) ----
  const seed = Math.floor(t * fps);
  const slices = Array.from({ length: SLICES }, (_, i) => {
    const gate = hashRand(seed, i, 7) > 0.55; // 全行ではなく一部の行だけ飛ぶ
    const dx = gate ? (hashRand(seed, i) - 0.5) * 2 * 90 * intensity * scale : 0;
    return { top: (i / SLICES) * 100, height: 100 / SLICES, dx };
  });

  const textStyle: React.CSSProperties = {
    fontFamily,
    fontSize,
    fontWeight: 500,
    letterSpacing: "0.32em",
    color,
    whiteSpace: "nowrap",
    textShadow: glow > 0 ? `0 0 ${glow * 14}px rgba(255,255,255,${Math.min(1, glow * 0.55)})` : undefined,
  };

  const wrapped = (extra?: React.CSSProperties, textColor?: string) => (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {[-1, 0, 1].map((k) => (
        <AbsoluteFill
          key={k}
          style={{
            justifyContent: "center",
            alignItems: "center",
            transform: `translateX(${offset + k * width}px)`,
            ...extra,
          }}
        >
          <div style={textColor ? { ...textStyle, color: textColor } : textStyle}>{text}</div>
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill>
      {/* Prism: RGB分離クローン (発作中のみ) */}
      {prismPx > 0.3 && (
        <>
          <AbsoluteFill
            style={{
              transform: `translateX(${-prismPx}px)`,
              mixBlendMode: "screen",
              filter: `blur(${intensity * 1.2}px)`,
            }}
          >
            {wrapped({ opacity: 0.7 }, WARM)}
          </AbsoluteFill>
          <AbsoluteFill
            style={{
              transform: `translateX(${prismPx}px)`,
              mixBlendMode: "screen",
              filter: `blur(${intensity * 1.2}px)`,
            }}
          >
            {wrapped({ opacity: 0.7 }, CYAN)}
          </AbsoluteFill>
        </>
      )}

      {/* 本体: 発作中はスライスごとに横飛び、平常時はそのまま */}
      {intensity > 0.05 ? (
        slices.map((s, i) => (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${s.top}% 0 ${100 - s.top - s.height}% 0)`,
              transform: `translateX(${s.dx}px)`,
            }}
          >
            {wrapped()}
          </AbsoluteFill>
        ))
      ) : (
        wrapped()
      )}

      {intensity > 0.3 &&
        Array.from({ length: 3 }, (_, i) => {
          const fx = (hashRand(seed, i, 31) - 0.5) * 0.5 * width;
          const fy = (hashRand(seed, i, 47) - 0.5) * 220 * scale;
          const fw = 30 + hashRand(seed, i, 63) * 120;
          return (
            <AbsoluteFill
              key={`f${i}`}
              style={{
                justifyContent: "center",
                alignItems: "center",
                transform: `translate(${fx}px, ${fy}px)`,
                clipPath: `inset(46% ${50 - fw / 20}% 46% ${30 + hashRand(seed, i, 77) * 20}%)`,
                opacity: 0.9 * intensity,
              }}
            >
              <div style={textStyle}>{text}</div>
            </AbsoluteFill>
          );
        })}
    </AbsoluteFill>
  );
};
