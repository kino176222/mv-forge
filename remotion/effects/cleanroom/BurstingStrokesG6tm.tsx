import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * BurstingStrokesG6tm（クリーンルーム再実装）
 *
 * 中央の発光リングから、色とりどりの短いカプセル状ストロークが外へ弾ける。
 * 各カプセルは開始半径から外へ飛び出しつつ描かれ、加算ブルームで発光。
 * 背景は透明。
 */
export interface BurstingStrokesG6tmProps {
  durationInFrames?: number;
  centerX?: number;
  centerY?: number;
  /** 弾けるカプセルの本数 */
  count?: number;
  /** リング半径（画面幅比） */
  ringRadius?: number;
  /** カプセルの飛距離（画面幅比） */
  spread?: number;
  glow?: number;
  opacity?: number;
}

const TONES = ["#f6a0ff", "#ff5ce0", "#ff8f6b"]; // ラベンダー / マゼンタ / サーモン

const RING_STOPS: ColorStop[] = [
  { offset: 0.0, color: "#f7dcff" },
  { offset: 0.4, color: "#ef62e4" },
  { offset: 0.7, color: "#c92fd2" },
  { offset: 1.0, color: "#8a17ab" },
];

const rnd = (seed: number) => {
  const x = Math.sin(seed * 91.3 + 47.1) * 43758.5453;
  return x - Math.floor(x);
};

export const BurstingStrokesG6tm: React.FC<BurstingStrokesG6tmProps> = ({
  durationInFrames,
  centerX = 0.49,
  centerY = 0.5,
  count = 14,
  ringRadius = 0.05,
  spread = 0.16,
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
  const ringR = ringRadius * width;

  const burst = easeOutCubic(Math.min(1, t / 0.62));

  const dashes = useMemo(() => {
    const n = Math.max(4, Math.floor(count));
    return Array.from({ length: n }, (_, i) => {
      const jitter = (rnd(i + 1) - 0.5) * (360 / n) * 0.6;
      const deg = (360 / n) * i + jitter - 90;
      const rad = (deg * Math.PI) / 180;
      const reach = spread * width * (0.6 + rnd(i + 7) * 0.9);
      const len = width * (0.018 + rnd(i + 3) * 0.03);
      const w = width * (0.004 + rnd(i + 5) * 0.004);
      const tone = TONES[i % TONES.length];
      const delay = rnd(i + 11) * 0.22;
      return { rad, reach, len, w, tone, delay };
    });
  }, [width, count, spread]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="burst-g6tm-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={20 * glow} />
          </filter>
        </defs>

        {/* 発光リング（ドーナツ）: グロー下敷き + 本体 */}
        {[true, false].map((isGlow, gi) => (
          <circle
            key={gi}
            cx={cx}
            cy={cy}
            r={ringR * (0.9 + 0.25 * burst)}
            fill="none"
            stroke="#ef62e4"
            strokeWidth={ringR * 0.5}
            opacity={(isGlow ? 0.7 : 1) * (0.4 + 0.6 * burst)}
            filter={isGlow ? "url(#burst-g6tm-bloom)" : undefined}
            style={isGlow ? { mixBlendMode: "screen" } : undefined}
          />
        ))}
        {/* リング内の白熱コア */}
        <circle cx={cx} cy={cy} r={ringR * 0.42} fill="#fff2fb" opacity={0.85 * burst} style={{ mixBlendMode: "screen" }} />

        {dashes.map((d, i) => {
          const local = Math.min(1, Math.max(0, (burst - d.delay) / (1 - d.delay || 1)));
          if (local <= 0) return null;
          const rIn = ringR + (d.reach - d.len) * local;
          const rOut = rIn + d.len;
          const p0: Pt = [cx + Math.cos(d.rad) * rIn, cy + Math.sin(d.rad) * rIn];
          const p1: Pt = [cx + Math.cos(d.rad) * rOut, cy + Math.sin(d.rad) * rOut];
          const fade = Math.min(1, local * 2);
          return (
            <GlowStroke
              key={i}
              uid={`burst-g6tm-${i}`}
              points={[p0, p1]}
              halfWidth={d.w}
              colorStops={[
                { offset: 0, color: d.tone },
                { offset: 1, color: d.tone },
              ]}
              progress={1}
              glow={glow}
              bloomRadius={9}
              opacity={fade}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
