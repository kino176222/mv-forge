import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * CentricRaysStrokes（クリーンルーム再実装）
 *
 * 中心の収束点（白熱コア＋マゼンタのハロー）から、ネオンの光条が
 * 扇状に放射するタイトル装飾素材。扇はクリップ全体で1回転し、
 * 扇を横切ってマゼンタ→紫→サーモン→黄のグラデーションが走る。
 * 背景は透明。約1秒（24f/24fps）想定だが durationInFrames に追従する。
 *
 * すべての見た目は props のつまみで調整可能。既定値だけで完成形になる。
 */

export type CentricRaysStrokesProps = {
  /** クリップ長（省略時はコンポジションの尺に追従） */
  durationInFrames?: number;
  /** 収束点の位置（キャンバスに対する 0..1 の比率） */
  centerX?: number;
  centerY?: number;
  /** 扇の開き角（度） */
  spreadDeg?: number;
  /** 開始時の扇の中心方向（度、0=右 / 90=下の画面座標） */
  startAngleDeg?: number;
  /** クリップ全体で回る角度（度。負で反時計回り） */
  rotationDeg?: number;
  /** 光条（ストライプ）の本数 */
  rayCount?: number;
  /** 光条の長さ（px）。画面外まで届く長さが既定 */
  rayLength?: number;
  /**
   * 扇を横切るグラデーション。offset 0 = 開き角の大きい側の縁（黄）、
   * offset 1 = 反対側の縁（マゼンタ）。
   */
  colorStops?: { offset: number; color: string }[];
  /** 光条ストライプ（明るい筋）の色と濃さ */
  strokeColor?: string;
  strokeOpacity?: number;
  /** コアの色とサイズ倍率 */
  coreColor?: string;
  haloColor?: string;
  coreScale?: number;
  /** 扇のにじみ（ぼかし半径 px）と外周グローの強さ */
  softness?: number;
  glowStrength?: number;
  /** 粒状ノイズの濃さ（0で無効） */
  grainOpacity?: number;
  /** 全体の不透明度 */
  opacity?: number;
};

/** #rrggbb → [r,g,b] */
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** カラーストップ列を u∈[0,1] でサンプリング */
const sampleStops = (
  stops: { offset: number; color: string }[],
  u: number,
): [number, number, number] => {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (u <= sorted[0].offset) return hexToRgb(sorted[0].color);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (u <= b.offset) {
      const t = (u - a.offset) / Math.max(1e-6, b.offset - a.offset);
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * t),
        Math.round(ca[1] + (cb[1] - ca[1]) * t),
        Math.round(ca[2] + (cb[2] - ca[2]) * t),
      ];
    }
  }
  return hexToRgb(sorted[sorted.length - 1].color);
};

const rgbCss = ([r, g, b]: [number, number, number], scale = 1) =>
  `rgb(${Math.min(255, Math.round(r * scale))}, ${Math.min(
    255,
    Math.round(g * scale),
  )}, ${Math.min(255, Math.round(b * scale))})`;

/** 回転の緩急: 序盤ゆっくり→終盤にかけて加速（緩いべき乗イーズイン） */
const rotationEase = (t: number) => Math.pow(clamp01(t), 1.3);

const DEFAULT_STOPS: { offset: number; color: string }[] = [
  { offset: 0.0, color: "#ffe14f" },
  { offset: 0.24, color: "#ffd05e" },
  { offset: 0.4, color: "#fda07f" },
  { offset: 0.5, color: "#cd78f2" },
  { offset: 0.57, color: "#8a49f0" },
  { offset: 0.66, color: "#d02be0" },
  { offset: 0.84, color: "#ff37d9" },
  { offset: 1.0, color: "#ff55e0" },
];

export const CentricRaysStrokes: React.FC<CentricRaysStrokesProps> = ({
  durationInFrames,
  centerX = 0.5,
  centerY = 0.49,
  spreadDeg = 105,
  startAngleDeg = 146,
  rotationDeg = -326,
  rayCount = 44,
  rayLength = 1700,
  colorStops = DEFAULT_STOPS,
  strokeColor = "#ffffff",
  strokeOpacity = 0.3,
  coreColor = "#fffef2",
  haloColor = "#cf2ec9",
  coreScale = 1,
  softness = 5,
  glowStrength = 1,
  grainOpacity = 0.06,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const cx = centerX * width;
  const cy = centerY * height;

  const t = clamp01(dur <= 1 ? 0 : frame / (dur - 1));
  const bisector = startAngleDeg + rotationDeg * rotationEase(t);

  // 扇のセクター（隣接三角形）と境界の光条ラインを組み立てる
  const { sectors, strokes } = useMemo(() => {
    const secs: { points: string; fill: string }[] = [];
    const lines: { x2: number; y2: number }[] = [];
    const n = Math.max(4, Math.floor(rayCount));
    const a0 = bisector - spreadDeg / 2; // マゼンタ側の縁
    const step = spreadDeg / n;
    const pt = (deg: number, r: number): [number, number] => {
      const rad = (deg * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    for (let i = 0; i < n; i++) {
      const angA = a0 + i * step;
      const angB = a0 + (i + 1) * step;
      const [xa, ya] = pt(angA, rayLength);
      const [xb, yb] = pt(angB, rayLength);
      // u: 0 = 開き角の大きい側（黄） / 1 = 小さい側（マゼンタ）
      const u = 1 - (i + 0.5) / n;
      const base = sampleStops(colorStops, u);
      // 1本おきに僅かに明暗を振って光条の畝（うね）を出す
      const ridge = i % 2 === 0 ? 0.94 : 1.05;
      secs.push({
        points: `${cx},${cy} ${xa},${ya} ${xb},${yb}`,
        fill: rgbCss(base, ridge),
      });
    }
    for (let i = 0; i <= n; i++) {
      const [x2, y2] = pt(a0 + i * step, rayLength);
      lines.push({ x2, y2 });
    }
    return { sectors: secs, strokes: lines };
  }, [bisector, spreadDeg, rayCount, rayLength, colorStops, cx, cy]);

  // コアの明滅（終盤にかけて僅かに落ち着く）
  const corePulse = 0.85 + 0.15 * Math.cos(2 * Math.PI * t);
  const coreR = 16 * coreScale * (0.9 + 0.2 * corePulse);

  const uid = "crs";

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <filter
            id={`${uid}-soft`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation={softness} />
          </filter>
          <filter
            id={`${uid}-bloom`}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
          >
            <feGaussianBlur stdDeviation={22 * glowStrength} />
          </filter>
          <filter
            id={`${uid}-grain`}
            x="-5%"
            y="-5%"
            width="110%"
            height="110%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves="2"
              seed="7"
              result="noise"
            />
            <feColorMatrix
              in="noise"
              type="matrix"
              values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 ${grainOpacity} 0`}
              result="grain"
            />
            <feComposite in="grain" in2="SourceGraphic" operator="in" result="grainIn" />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="grainIn" />
            </feMerge>
          </filter>
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0%" stopColor={haloColor} stopOpacity="0.9" />
            <stop offset="55%" stopColor={haloColor} stopOpacity="0.55" />
            <stop offset="100%" stopColor={haloColor} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-coreGlow`}>
            <stop offset="0%" stopColor={coreColor} stopOpacity="1" />
            <stop offset="45%" stopColor={coreColor} stopOpacity="0.75" />
            <stop offset="100%" stopColor={coreColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 外周のにじみ（ブルーム）: 扇のぼかしコピーを下に敷く */}
        <g filter={`url(#${uid}-bloom)`} opacity={0.65 * glowStrength}>
          {sectors.map((s, i) => (
            <polygon key={`b${i}`} points={s.points} fill={s.fill} />
          ))}
        </g>

        {/* 扇本体（粒状ノイズ→ソフトぼかしの順で重ねる） */}
        <g filter={`url(#${uid}-grain)`}>
          <g filter={`url(#${uid}-soft)`}>
            {sectors.map((s, i) => (
              <polygon key={i} points={s.points} fill={s.fill} />
            ))}
            {/* 光条ストライプ（セクター境界の明るい筋） */}
            {strokes.map((l, i) => (
              <line
                key={`l${i}`}
                x1={cx}
                y1={cy}
                x2={l.x2}
                y2={l.y2}
                stroke={strokeColor}
                strokeOpacity={strokeOpacity}
                strokeWidth={2.4}
              />
            ))}
          </g>
        </g>

        {/* 収束点: マゼンタのハロー → 白グロー → 白熱コア */}
        <circle
          cx={cx}
          cy={cy}
          r={coreR * 4.6}
          fill={`url(#${uid}-halo)`}
          opacity={0.9 * corePulse}
        />
        <circle
          cx={cx}
          cy={cy}
          r={coreR * 2.6}
          fill={`url(#${uid}-coreGlow)`}
          opacity={0.95 * corePulse}
        />
        <circle
          cx={cx}
          cy={cy}
          r={coreR}
          fill={coreColor}
          opacity={corePulse}
          filter={`url(#${uid}-soft)`}
        />
      </svg>
    </AbsoluteFill>
  );
};
