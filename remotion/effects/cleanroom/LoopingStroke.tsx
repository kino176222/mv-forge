import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * LoopingStroke（クリーンルーム再実装）
 *
 * 横に走る一筆の発光ラインの途中に、2〜3個のループ（宙返り）が入る。
 * シアン→アズール→バイオレット→マゼンタへ長さ方向にグラデーションし、
 * 序盤で一気に描き切って以降ホールド。ループの頂点で小さく弾ける。
 * 加算ブルームで発光。背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) は「同じ族の別バリアント」の種。色相の回転・ループ本数/位置・
 * 全体の傾き・振幅を決定論的に微ジッターさせる（Math.random は使わない）。
 */
export interface LoopingStrokeProps {
  durationInFrames?: number;
  /** 0..1 のバリアント種。色相回転・角度/本数/位置の微ジッターに使う。 */
  variant?: number;
  opacity?: number;
}

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** 端で速度ゼロの5次スムーサー（ループ出入りのカクつきを消す） */
const smoother = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** HSL(deg,0..1,0..1) → #rrggbb（sampleStops は hex を要求するため） */
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

export const LoopingStroke: React.FC<LoopingStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.68 までに描き切り、以降ホールド（描かれて残る）
  const progress = easeOutCubic(Math.min(1, t / 0.68));

  // バリアント種（0..1）からブレない乱数キーを引く
  const seed = 11.3 + variant * 97.0;

  // 長さ方向グラデ: シアン→アズール→バイオレット→マゼンタ（variant で色相回転）
  const colorStops = useMemo<ColorStop[]>(() => {
    const shift = (variant - 0.5) * 44; // ±22deg
    const S = 0.92;
    const L = 0.62;
    return [
      { offset: 0.0, color: hslToHex(188 + shift, S, L) },
      { offset: 0.36, color: hslToHex(206 + shift, S, L) },
      { offset: 0.66, color: hslToHex(276 + shift, S, L) },
      { offset: 1.0, color: hslToHex(320 + shift, S, L) },
    ];
  }, [variant]);

  // ループ定義（本数・位置・半径・向きを variant で決定論ジッター）
  const loops = useMemo(() => {
    const n = 2 + Math.round(rnd(seed + 1)); // 2 or 3
    const orient = rnd(seed + 7) < 0.5 ? 1 : -1; // 族全体のループ向き
    const out: { sc: number; sw: number; R: number; dir: number }[] = [];
    for (let i = 0; i < n; i++) {
      const base = n > 1 ? 0.3 + 0.4 * (i / (n - 1)) : 0.5;
      const sc = base + (rnd(seed + i + 2) - 0.5) * 0.05;
      const R = height * 0.055 * (0.85 + rnd(seed + i + 5) * 0.4);
      const dir = (i % 2 === 0 ? 1 : -1) * orient; // 交互に上/下へ宙返り
      out.push({ sc, sw: 0.055, R, dir });
    }
    return out;
  }, [seed, height]);

  // 全体の傾き（variant で微回転）
  const tilt = (variant - 0.5) * 0.14 + (rnd(seed + 3) - 0.5) * 0.05;

  // s(0..1) → 画面上の点。横進行＋ゆるい波＋ループ offset を合成し、中心回りに tilt 回転。
  const { points, apexes } = useMemo(() => {
    const x0 = width * 0.12;
    const x1 = width * 0.88;
    const yMid = height * 0.54;
    const baseAmp = height * 0.03 * (0.8 + rnd(seed + 9) * 0.5);
    const baseWaves = 1.15 + rnd(seed + 11) * 0.5;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);

    const evalPoint = (s: number): Pt => {
      let x = x0 + (x1 - x0) * s;
      let y = yMid + Math.sin(s * Math.PI * baseWaves) * baseAmp;
      for (const lp of loops) {
        const d = (s - (lp.sc - lp.sw)) / (2 * lp.sw);
        if (d > 0 && d < 1) {
          const phi = smoother(d) * Math.PI * 2;
          x += lp.R * Math.sin(phi);
          y += -lp.dir * lp.R * (1 - Math.cos(phi));
        }
      }
      // 中心回りに tilt 回転
      const rx = cx + (x - cx) * cosT - (y - cy) * sinT;
      const ry = cy + (x - cx) * sinT + (y - cy) * cosT;
      return [rx, ry];
    };

    const N = 200;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) pts.push(evalPoint(i / N));
    // 各ループ頂点（弾け accent 用）
    const ap = loops.map((lp) => ({ s: lp.sc, pt: evalPoint(lp.sc) }));
    return { points: pts, apexes: ap };
  }, [width, height, loops, tilt, seed]);

  // 先細り: 始点やや細 → 中盤太 → 終点細
  const thickness = 6.5;
  const halfWidth = useMemo(
    () => [thickness * 0.5, thickness, thickness * 0.9, thickness * 0.6, thickness * 0.32],
    [],
  );

  const sparkColor = sampleStops(colorStops, 0.5);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="looping-spark" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation={height * 0.02} />
          </filter>
        </defs>

        <GlowStroke
          uid="looping-main"
          points={points}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={1}
          bloomRadius={13}
          leadCore={progress < 0.999}
          leadCoreColor="#eafcff"
        />

        {/* ループ頂点の弾け accent: 描き込みが通過した瞬間に小さく光る */}
        {apexes.map((a, i) => {
          const local = (progress - a.s) / 0.12;
          if (local <= 0 || local >= 1.6) return null;
          // 立ち上がり速く → ゆるく減衰する pop
          const pop = local < 1 ? easeOutCubic(local) : Math.max(0, 1 - (local - 1) / 0.6);
          const r = height * 0.016 * (0.7 + 0.6 * pop);
          return (
            <g key={i} style={{ mixBlendMode: "screen" }}>
              <circle
                cx={a.pt[0]}
                cy={a.pt[1]}
                r={r * 2.6}
                fill={sparkColor}
                opacity={0.45 * pop}
                filter="url(#looping-spark)"
              />
              <circle cx={a.pt[0]} cy={a.pt[1]} r={r} fill="#f2feff" opacity={0.85 * pop} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
