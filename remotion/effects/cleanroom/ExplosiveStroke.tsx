import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * ExplosiveStroke（クリーンルーム再実装）
 *
 * 中心から約16本のギザついた短いストロークが激しく放射爆発する。速いイーズで
 * 一気に描き切り、中心には白い閃光が弾ける。色は灼熱のオレンジ→マゼンタ。
 * 加算ブルームで発光し、背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant（0..1）は決定論的な種。色相の回転・本数/角度/位置の微ジッターに使い、
 * 同じ族の別バリアントが少しずつ違って見えるようにする（Math.random は使わない）。
 */
export interface ExplosiveStrokeProps {
  durationInFrames?: number;
  variant?: number;
  opacity?: number;
}

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL → hex（色相回転を掛けるため） */
const hslToHex = (h: number, s: number, l: number) => {
  const hh = ((h % 360) + 360) % 360;
  const ss = s / 100;
  const ll = l / 100;
  const a = ss * Math.min(ll, 1 - ll);
  const k = (n: number) => (n + hh / 30) % 12;
  const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
};

export const ExplosiveStroke: React.FC<ExplosiveStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // variant 由来の種（Math.random 不使用）
  const v = ((variant % 1) + 1) % 1;
  const seed = 1 + v * 53.2;

  // 中心は僅かに variant で揺らす（画面中央付近）
  const cx = width * (0.5 + (rnd(seed + 2) - 0.5) * 0.04);
  const cy = height * (0.5 + (rnd(seed + 3) - 0.5) * 0.04);

  // 色相回転で族内バリエーション（灼熱オレンジ→マゼンタを ±18° 回す）
  const hueShift = (v - 0.5) * 36;
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(42 + hueShift, 100, 82) }, // 中心: 白熱の橙
      { offset: 0.35, color: hslToHex(26 + hueShift, 100, 58) }, // 灼熱オレンジ
      { offset: 0.72, color: hslToHex(350 + hueShift, 95, 56) }, // 赤マゼンタ
      { offset: 1.0, color: hslToHex(322 + hueShift, 92, 55) }, // マゼンタ先端
    ],
    [hueShift],
  );

  // 約16本、variant で ±1 本ゆらぎ
  const count = 16 + Math.round((rnd(seed + 4) - 0.5) * 2);

  const rays = useMemo(() => {
    const n = Math.max(8, count);
    const base = width * 0.5; // 短辺基準に近い尺度
    const out: { pts: Pt[]; hw: number[]; delay: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = seed + i * 7.31;
      // 等間隔＋角度ジッター
      const jitter = (rnd(s + 1) - 0.5) * (360 / n) * 0.55;
      const deg = (360 / n) * i + jitter - 90;
      const rad = (deg * Math.PI) / 180;
      const nx = Math.cos(rad);
      const ny = Math.sin(rad);
      const px = -ny; // 法線（ジグザグ方向）
      const py = nx;

      // 短いストローク: 開始半径→到達半径
      const r0 = base * 0.045;
      const reach = base * (0.16 + rnd(s + 2) * 0.14);
      const jagAmp = base * (0.018 + rnd(s + 3) * 0.02);
      const zig = 2 + Math.floor(rnd(s + 4) * 3); // ギザの山数
      const phase = rnd(s + 5) * Math.PI * 2;

      const N = 8;
      const pts: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const r = r0 + (reach - r0) * u;
        // 先端ほど収束するようテーパーしたジグザグ
        const off = Math.sin(u * Math.PI * zig + phase) * jagAmp * (1 - u * 0.7);
        pts.push([cx + nx * r + px * off, cy + ny * r + py * off]);
      }

      const w = base * (0.010 + rnd(s + 6) * 0.006);
      const hw = [w, w * 0.7, w * 0.42, w * 0.2, w * 0.06]; // 中心太→先端鋭
      const delay = rnd(s + 7) * 0.12; // ごく僅かに時間差で弾ける
      out.push({ pts, hw, delay });
    }
    return out;
  }, [width, height, cx, cy, count, seed]);

  // 中心の白い閃光: 一気に立ち上がり素早く減衰
  const flash =
    easeOutCubic(Math.min(1, t / 0.06)) * (1 - easeOutCubic(Math.min(1, t / 0.5)));
  const halo = easeOutCubic(Math.min(1, t / 0.3)) * (1 - 0.4 * easeOutCubic(Math.min(1, t / 0.9)));
  const flashR = width * 0.5 * 0.05 * (0.8 + 0.6 * flash);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`expl-${seed.toFixed(3)}-bloom`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={22} />
          </filter>
          <radialGradient id={`expl-${seed.toFixed(3)}-halo`}>
            <stop offset="0%" stopColor={sampleStops(colorStops, 0.4)} stopOpacity="0.9" />
            <stop offset="60%" stopColor={sampleStops(colorStops, 0.85)} stopOpacity="0.35" />
            <stop offset="100%" stopColor={sampleStops(colorStops, 1)} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 爆発のハロー（下地の色味） */}
        <circle
          cx={cx}
          cy={cy}
          r={width * 0.5 * 0.2}
          fill={`url(#expl-${seed.toFixed(3)}-halo)`}
          opacity={0.75 * halo}
          filter={`url(#expl-${seed.toFixed(3)}-bloom)`}
          style={{ mixBlendMode: "screen" }}
        />

        {/* 放射する各ストローク（速いイーズで描き切り以降ホールド） */}
        {rays.map((r, i) => {
          const local = Math.min(1, Math.max(0, (t - r.delay) / 0.32));
          const progress = easeOutCubic(local);
          if (progress <= 0) return null;
          return (
            <GlowStroke
              key={i}
              uid={`expl-${seed.toFixed(3)}-${i}`}
              points={r.pts}
              halfWidth={r.hw}
              colorStops={colorStops}
              progress={progress}
              glow={1}
              bloomRadius={10}
            />
          );
        })}

        {/* 中心の白い閃光 */}
        <g style={{ mixBlendMode: "screen" }}>
          <circle
            cx={cx}
            cy={cy}
            r={flashR * 3}
            fill={sampleStops(colorStops, 0.15)}
            opacity={0.55 * flash}
            filter={`url(#expl-${seed.toFixed(3)}-bloom)`}
          />
          <circle cx={cx} cy={cy} r={flashR} fill="#fff6ec" opacity={0.5 + 0.5 * flash} />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
