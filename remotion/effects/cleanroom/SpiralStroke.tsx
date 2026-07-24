import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * SpiralStroke（クリーンルーム再実装）
 *
 * 中心から外へ巻くアルキメデス螺旋。中心の紫からシアンへグラデーションし、
 * 先端に白熱コアが走る。序盤で一気に描き切り以降ホールド、開始時に軽く
 * 弾ける（スケール settle）。加算ブルームで上品に発光。背景は透明。
 * 約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant（0..1）は決定論的な種。色相の回転・巻き数/位相/太さの微ジッターを
 * 与え、同じ族の別バリアントが少しずつ違って見えるようにする。
 */
export interface SpiralStrokeProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転・巻き数/位相/太さのジッターに使う。 */
  variant?: number;
  opacity?: number;
}

/** HSL(deg,0..1,0..1) → "#rrggbb" */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 74.31 + 19.7) * 43758.5453;
  return x - Math.floor(x);
};

export const SpiralStroke: React.FC<SpiralStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const cx = width * 0.5;
  const cy = height * 0.5;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.68 までに描き切り、以降ホールド
  const progress = easeOutCubic(Math.min(1, t / 0.68));
  // 開始時の軽い「弾け」: 0.94→1.0 のスケール settle
  const pop = easeOutCubic(Math.min(1, t / 0.4));
  const scale = 0.94 + 0.06 * pop;

  // variant 由来の決定論パラメータ
  const hueRot = (variant - 0.5) * 36; // 色相を ±18° 回す
  const turns = 2.5 + rnd(variant * 13.1 + 1) * 0.7; // 巻き数
  const phase = variant * Math.PI * 2 + rnd(variant * 7.7 + 2) * 0.6; // 開始角
  const widthJit = 0.85 + rnd(variant * 5.3 + 3) * 0.35; // 太さ倍率

  // 中心=紫 → 外=シアン（variant で色相回転）
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(280 + hueRot, 0.85, 0.64) },
      { offset: 0.5, color: hslToHex(232 + hueRot, 0.82, 0.62) },
      { offset: 1.0, color: hslToHex(188 + hueRot, 0.85, 0.6) },
    ],
    [hueRot],
  );

  const points = useMemo<Pt[]>(() => {
    const N = 150;
    const thetaMax = turns * Math.PI * 2;
    const rMax = Math.min(width, height) * 0.34;
    const r0 = rMax * 0.03; // 中心の特異点を避けて少し離して開始
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const theta = thetaMax * u;
      const r = r0 + (rMax - r0) * u; // アルキメデス螺旋（等間隔巻き）
      pts.push([cx + Math.cos(theta + phase) * r, cy + Math.sin(theta + phase) * r]);
    }
    return pts;
  }, [width, height, cx, cy, turns, phase]);

  // 先細り: 中心細 → 中盤太 → 先端やや細（コメット状）
  const halfWidth = useMemo(() => {
    const base = Math.min(width, height) * 0.006 * widthJit;
    return [base * 0.35, base * 0.8, base * 1.0, base * 0.75, base * 0.4];
  }, [width, height, widthJit]);

  const centerColor = sampleStops(colorStops, 0.05);
  const coreR = Math.min(width, height) * 0.012;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="spiral-halo">
            <stop offset="0%" stopColor={centerColor} stopOpacity="0.8" />
            <stop offset="60%" stopColor={centerColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={centerColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
          {/* 中心の淡いハロー（螺旋の起点をわずかに灯す） */}
          <circle
            cx={cx}
            cy={cy}
            r={coreR * 5}
            fill="url(#spiral-halo)"
            opacity={0.7 * pop}
            style={{ mixBlendMode: "screen" }}
          />

          {/* 本体の螺旋 */}
          <GlowStroke
            uid="spiral-stroke"
            points={points}
            halfWidth={halfWidth}
            colorStops={colorStops}
            progress={progress}
            glow={1}
            bloomRadius={11}
            leadCore
            leadCoreColor="#f2fbff"
          />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
