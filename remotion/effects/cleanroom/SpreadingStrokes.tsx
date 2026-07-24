import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * SpreadingStrokes（クリーンルーム再実装）
 *
 * 一つの基点から扇状に外へ広がる複数の発光ストローク（孔雀の羽 / スピード扇）。
 * 各条は軽く弓なりに反りながら外へ伸び、根元の紫から先端の桃へグラデーション。
 * 序盤で一気に描き切り以降ホールドする「弾けて残る」動き。加算ブルームで発光。
 * 背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant（0..1）を種に、色相の回転・扇の開き角・本数・位置ジッターを決定論的に
 * 変える（Math.random は使わない）。同族の別バリアントが少しずつ違って見える。
 */
export interface SpreadingStrokesProps {
  durationInFrames?: number;
  /** 0..1 の種。色相・角度・本数・ジッターを決める */
  variant?: number;
  opacity?: number;
}

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL → #rrggbb（sampleStops へ渡すため hex 化） */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g] = [c, x];
  else if (hh < 120) [r, g] = [x, c];
  else if (hh < 180) [g, b] = [c, x];
  else if (hh < 240) [g, b] = [x, c];
  else if (hh < 300) [r, b] = [x, c];
  else [r, b] = [c, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

export const SpreadingStrokes: React.FC<SpreadingStrokesProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  const v = Math.min(1, Math.max(0, variant));

  // variant で色相を回す（紫→桃を保ちつつ族内で差を出す）
  const hueShift = (v - 0.5) * 50; // ±25deg
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(268 + hueShift, 80, 52) }, // 深い紫（根元）
      { offset: 0.5, color: hslToHex(300 + hueShift, 88, 62) }, // 菫〜赤紫
      { offset: 1.0, color: hslToHex(332 + hueShift, 92, 70) }, // 桃（先端）
    ],
    [hueShift],
  );
  const haloColor = useMemo(() => hslToHex(285 + hueShift, 85, 58), [hueShift]);

  // 扇の基点（下寄り中央）。variant で僅かに横へずらす
  const cx = width * (0.5 + (v - 0.5) * 0.08);
  const cy = height * 0.66;

  const strokes = useMemo(() => {
    const n = 7 + Math.round(v * 5); // 7..12 本
    const centerDeg = -90 + (v - 0.5) * 18; // 概ね真上、僅かに傾ける
    const fanDeg = 82 + v * 40; // 開き角 82..122
    const baseLen = width * 0.3;
    const out: { pts: Pt[]; hw: number[]; delay: number }[] = [];
    for (let i = 0; i < n; i++) {
      const offN = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // -1..1
      const jitDeg = (rnd(i + 1 + v * 57.3) - 0.5) * (fanDeg / n) * 0.6;
      const deg = centerDeg + offN * (fanDeg / 2) + jitDeg;
      const rad = (deg * Math.PI) / 180;
      const perp: Pt = [-Math.sin(rad), Math.cos(rad)];
      const len = baseLen * (0.8 + rnd(i + 9 + v * 13.7) * 0.45);
      const bow = len * 0.16 * offN; // 外側ほど外へ反る（羽の反り）
      const r0 = width * 0.015; // 基点から少し離して開始
      const N = 14;
      const pts: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const r = r0 + (len - r0) * u;
        const sway = bow * Math.sin(u * Math.PI); // 中ほどで最も反る
        pts.push([
          cx + Math.cos(rad) * r + perp[0] * sway,
          cy + Math.sin(rad) * r + perp[1] * sway,
        ]);
      }
      const w = width * 0.006 * (0.75 + rnd(i + 5 + v * 3.1) * 0.6);
      const hw = [w * 0.85, w, w * 0.55, w * 0.28, w * 0.08]; // 根元やや太→先端細
      const delay = rnd(i + 11 + v * 21.9) * 0.2;
      out.push({ pts, hw, delay });
    }
    return out;
  }, [width, height, cx, cy, v]);

  // 弾ける速いイーズ。~0.7 で描き切り以降ホールド
  const appear = easeOutCubic(Math.min(1, t / 0.45));
  const rootR = width * 0.02;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="spread-strk-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={18} />
          </filter>
          <radialGradient id="spread-strk-halo">
            <stop offset="0%" stopColor={haloColor} stopOpacity="0.85" />
            <stop offset="55%" stopColor={haloColor} stopOpacity="0.4" />
            <stop offset="100%" stopColor={haloColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 基点のハロー（扇の付け根を光で接地させる） */}
        <circle
          cx={cx}
          cy={cy}
          r={rootR * 3.2}
          fill="url(#spread-strk-halo)"
          opacity={0.75 * appear}
          filter="url(#spread-strk-bloom)"
        />

        {/* 扇の各条 */}
        {strokes.map((s, i) => {
          const local = Math.min(1, Math.max(0, (t - s.delay) / 0.42));
          const progress = easeOutCubic(local);
          if (progress <= 0) return null;
          return (
            <GlowStroke
              key={i}
              uid={`spread-strk-${i}`}
              points={s.pts}
              halfWidth={s.hw}
              colorStops={colorStops}
              progress={progress}
              glow={1}
              bloomRadius={11}
            />
          );
        })}

        {/* 付け根の白熱コア */}
        <g style={{ mixBlendMode: "screen" }}>
          <circle
            cx={cx}
            cy={cy}
            r={rootR * 1.3}
            fill={sampleStops(colorStops, 0.15)}
            opacity={0.55 * appear}
            filter="url(#spread-strk-bloom)"
          />
          <circle cx={cx} cy={cy} r={rootR * 0.5} fill="#fdf0ff" opacity={0.9 * appear} />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
