import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * RadiatingStrokes39sy（クリーンルーム再実装）
 *
 * 中心の白熱コア（マゼンタのハロー）から、太さ・長さの異なる光条が
 * 放射状に伸びる。各条は僅かにずれて描き出され、加算ブルームで発光。
 * 背景は透明。
 */
export interface RadiatingStrokes39syProps {
  durationInFrames?: number;
  centerX?: number;
  centerY?: number;
  /** 光条の本数 */
  rayCount?: number;
  /** 光条の基準長（画面幅比） */
  rayLength?: number;
  thickness?: number;
  colorStops?: ColorStop[];
  coreColor?: string;
  haloColor?: string;
  glow?: number;
  opacity?: number;
}

const DEFAULT_STOPS: ColorStop[] = [
  { offset: 0.0, color: "#ffd6f4" },
  { offset: 0.4, color: "#ff5ce0" },
  { offset: 1.0, color: "#b41fc9" },
];

/** 決定論的な擬似乱数（seed から） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const RadiatingStrokes39sy: React.FC<RadiatingStrokes39syProps> = ({
  durationInFrames,
  centerX = 0.5,
  centerY = 0.52,
  rayCount = 12,
  rayLength = 0.22,
  thickness = 8,
  colorStops = DEFAULT_STOPS,
  coreColor = "#fff2fb",
  haloColor = "#e63cd6",
  glow = 1,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  const cx = centerX * width;
  const cy = centerY * height;

  const rays = useMemo(() => {
    const out: { pts: Pt[]; hw: number[]; delay: number }[] = [];
    const n = Math.max(3, Math.floor(rayCount));
    for (let i = 0; i < n; i++) {
      const jitter = (rnd(i + 1) - 0.5) * (360 / n) * 0.5;
      const deg = (360 / n) * i + jitter - 90;
      const rad = (deg * Math.PI) / 180;
      const lenMul = 0.55 + rnd(i + 9) * 0.75;
      const len = rayLength * width * lenMul;
      const r0 = 0.02 * width; // コアから少し離して開始
      const N = 10;
      const pts: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const r = r0 + (len - r0) * u;
        pts.push([cx + Math.cos(rad) * r, cy + Math.sin(rad) * r]);
      }
      const w = thickness * (0.6 + rnd(i + 3) * 0.8);
      const hw = [w, w * 0.8, w * 0.5, w * 0.28, w * 0.1];
      out.push({ pts, hw, delay: rnd(i + 5) * 0.28 });
    }
    return out;
  }, [width, height, cx, cy, rayCount, rayLength, thickness]);

  const corePulse = 0.85 + 0.15 * Math.sin(Math.PI * Math.min(1, t / 0.5));
  const coreR = 0.02 * width * (0.9 + 0.3 * corePulse);
  const appear = easeOutCubic(Math.min(1, t / 0.35));

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="rad39-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={26 * glow} />
          </filter>
          <radialGradient id="rad39-halo">
            <stop offset="0%" stopColor={haloColor} stopOpacity="0.95" />
            <stop offset="55%" stopColor={haloColor} stopOpacity="0.5" />
            <stop offset="100%" stopColor={haloColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ハロー */}
        <circle
          cx={cx}
          cy={cy}
          r={coreR * 6}
          fill="url(#rad39-halo)"
          opacity={0.9 * appear}
          filter="url(#rad39-bloom)"
        />

        {rays.map((r, i) => {
          const local = Math.min(1, Math.max(0, (t - r.delay) / 0.4));
          const progress = easeOutCubic(local);
          if (progress <= 0) return null;
          return (
            <GlowStroke
              key={i}
              uid={`rad39-${i}`}
              points={r.pts}
              halfWidth={r.hw}
              colorStops={colorStops}
              progress={progress}
              glow={glow}
              bloomRadius={12}
            />
          );
        })}

        {/* コア */}
        <g style={{ mixBlendMode: "screen" }}>
          <circle cx={cx} cy={cy} r={coreR * 2.4} fill={sampleStops(colorStops, 0.2)} opacity={0.6 * appear} filter="url(#rad39-bloom)" />
          <circle cx={cx} cy={cy} r={coreR} fill={coreColor} opacity={appear} />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
