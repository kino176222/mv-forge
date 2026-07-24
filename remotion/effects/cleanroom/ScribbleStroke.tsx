import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * ScribbleStroke（クリーンルーム再実装）
 *
 * 手描きの落書き（重なるループ）を一筆でサッと描き込む、遊び心のある演出。
 * トロコイド（advance より大きいループ半径）で連続する輪を作り、桃〜オレンジの
 * ネオングラデを長さ方向に走らせる。先端に白熱コア、描き終わりに小さな火花が
 * 弾ける。加算ブルームで上品に発光。背景は透明。約24f/24fps 想定だが
 * durationInFrames に追従。
 *
 * variant(0..1) から色相・ループ本数・傾き・位置・半径を決定論的にジッターさせ、
 * 同じ族でも一枚ごとに少し違う落書きに見えるようにする（Math.random は不使用）。
 */
export interface ScribbleStrokeProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転・角度/本数/位置の微ジッターを与える。 */
  variant?: number;
  opacity?: number;
}

/** HSL(deg, 0..1, 0..1) → "#rrggbb"。ネオン桃/オレンジをコードで転がすため。 */
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

export const ScribbleStroke: React.FC<ScribbleStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.7 までに一気に描き切り、以降ホールド（描かれて残る）
  const progress = easeOutCubic(Math.min(1, t / 0.7));

  // variant 由来の決定論的ジッター
  const vr = (i: number) => {
    const x = Math.sin((variant + 1.0) * (i * 127.1 + 311.7)) * 43758.5453;
    return x - Math.floor(x);
  };

  const loops = 2.4 + vr(4) * 1.0; // 2.4..3.4 本のループ
  const hueBase = 30 + (vr(6) - 0.5) * 22; // 桃/オレンジ帯（19..41°）を外さない

  // 桃 → オレンジ → コーラルのネオングラデ（明るめ・彩度高めでケバさは抑える）
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(hueBase + 10, 0.95, 0.82) },
      { offset: 0.4, color: hslToHex(hueBase, 0.92, 0.66) },
      { offset: 0.75, color: hslToHex(hueBase - 10, 0.9, 0.63) },
      { offset: 1.0, color: hslToHex(hueBase - 18, 0.88, 0.64) },
    ],
    [hueBase],
  );

  // 重なるループの点列（トロコイド）＋全体を微回転
  const points = useMemo<Pt[]>(() => {
    const N = 140;
    const cx = width * (0.5 + (vr(2) - 0.5) * 0.06);
    const cy = height * (0.5 + (vr(3) - 0.5) * 0.06);
    const spanX = width * 0.4;
    const advance = spanX / loops;
    const loopR = advance * (0.66 + vr(5) * 0.16); // advance より大きく → 輪が重なる
    const rot = (vr(1) - 0.5) * 0.4; // ±0.2rad ≒ ±11° の遊びの傾き
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const x0 = cx - spanX * 0.5;
    const total = loops * Math.PI * 2;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const th = u * total;
      const px = x0 + spanX * u - loopR * Math.sin(th);
      const py = cy - loopR * Math.cos(th) - u * height * 0.045; // 右上へ少し持ち上げる
      const dx = px - cx;
      const dy = py - cy;
      pts.push([cx + dx * cr - dy * sr, cy + dx * sr + dy * cr]);
    }
    return pts;
  }, [width, height, loops]);

  // 先細り: 細 → 太 → 細（手描きの筆圧感）
  const halfWidth = useMemo(() => {
    const th = Math.max(4, height * 0.007);
    return [th * 0.4, th, th * 1.15, th * 0.8, th * 0.35];
  }, [height]);

  // ループの頂点付近で弾ける小さな火花（描き終わりに twinkle）
  const sparks = useMemo(() => {
    const out: { p: Pt; onset: number }[] = [];
    const k = Math.floor(loops);
    for (let j = 1; j <= k; j++) {
      const su = Math.min(0.98, j / loops + (vr(j + 20) - 0.5) * 0.04);
      const idx = Math.round(su * (points.length - 1));
      out.push({ p: points[idx], onset: 0.5 + 0.4 * su });
    }
    return out;
  }, [points, loops]);

  const pre = `scribble-${Math.round(variant * 997)}`;
  const sparkR = Math.max(4, height * 0.007) * 0.9;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`${pre}-spark`} x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation={sparkR * 1.6} />
          </filter>
        </defs>

        {/* 落書き本体（一筆の重なるループ） */}
        <GlowStroke
          uid={pre}
          points={points}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={1}
          bloomRadius={12}
          leadCore
          leadCoreColor="#fff2e6"
        />

        {/* 弾ける火花: 描き終わりにポンと出て消える */}
        {sparks.map((s, i) => {
          const local = Math.min(1, Math.max(0, (t - s.onset) / 0.22));
          if (local <= 0) return null;
          const pop = easeOutCubic(local);
          const fade = 1 - Math.min(1, Math.max(0, (t - s.onset - 0.1) / 0.32));
          if (fade <= 0) return null;
          const r = sparkR * (0.3 + pop);
          return (
            <g key={i} style={{ mixBlendMode: "screen" }}>
              <circle
                cx={s.p[0]}
                cy={s.p[1]}
                r={r * 2.2}
                fill={colorStops[1].color}
                opacity={0.55 * fade}
                filter={`url(#${pre}-spark)`}
              />
              <circle cx={s.p[0]} cy={s.p[1]} r={r} fill="#fff2e6" opacity={0.9 * fade} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
