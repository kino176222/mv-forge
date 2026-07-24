import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * FrayedWindingStroke（クリーンルーム再実装）
 *
 * WindingStroke のようにうねる S 字の発光ラインだが、ふちが「ほつれた」
 * 粗い繊維に分かれ、わずかに二重線が走る。始点の緑から終点の紫へグラデ。
 * 加算ブルームで上品に光る（ケバつかせない）。背景は透明。
 * 約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) を種に色相回転・角度/本数/位置の微ジッターを決定論的に与え、
 * 同族の別バリアントが少しずつ違って見えるようにする（Math.random 不使用）。
 */
export interface FrayedWindingStrokeProps {
  durationInFrames?: number;
  variant?: number;
  opacity?: number;
}

/** HSL → "#rrggbb"（色相回転を効かせるため hex 経由で色を組む） */
const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
  } else if (hh < 120) {
    r = x;
    g = c;
  } else if (hh < 180) {
    g = c;
    b = x;
  } else if (hh < 240) {
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const to = (v: number) => {
    const n = Math.round((v + m) * 255);
    return n.toString(16).padStart(2, "0");
  };
  return `#${to(r)}${to(g)}${to(b)}`;
};

/** 頂点法線（隣接セグメント法線の平均）— 繊維/二重線を法線方向へずらすのに使う */
const normalsOf = (pts: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    let dx = q[0] - p[0];
    let dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out.push([-dy, dx]);
  }
  return out;
};

export const FrayedWindingStroke: React.FC<FrayedWindingStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const seed = variant;
  const vid = Math.round(variant * 997);
  // variant 由来の決定論的擬似乱数
  const rnd = (k: number) => {
    const x = Math.sin((k + seed * 53.17) * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.7 までに描き切り、以降ホールド（描かれて残る）
  const progress = easeOutCubic(Math.min(1, t / 0.7));

  const thickness = height * 0.009;

  // 緑→紫のグラデ。variant で色相を ±14° 回してバリアント差を出す
  const stops = useMemo<ColorStop[]>(() => {
    const shift = (variant - 0.5) * 28;
    const base = [
      { offset: 0.0, h: 150, s: 0.85, l: 0.6 },
      { offset: 0.4, h: 172, s: 0.82, l: 0.62 },
      { offset: 0.72, h: 250, s: 0.8, l: 0.66 },
      { offset: 1.0, h: 286, s: 0.85, l: 0.66 },
    ];
    return base.map((b) => ({ offset: b.offset, color: hslToHex(b.h + shift, b.s, b.l) }));
  }, [variant]);

  // 主線の点列（うねる S 字）— WindingStroke に倣いつつ variant で微ジッター
  const N = 72;
  const geom = useMemo(() => {
    const waves = 1.7 + (rnd(1) - 0.5) * 0.5;
    const amp = height * (0.11 + (rnd(2) - 0.5) * 0.03);
    const yMid = height * (0.54 + (rnd(3) - 0.5) * 0.06);
    const phase = rnd(4) * Math.PI;
    const x0 = width * (0.14 + (rnd(5) - 0.5) * 0.04);
    const x1 = width * (0.86 + (rnd(6) - 0.5) * 0.04);
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = x0 + (x1 - x0) * u;
      const rise = -u * height * 0.14;
      const y = yMid + rise + Math.sin(u * Math.PI * waves + phase) * amp * (0.5 + 0.5 * u);
      pts.push([x, y]);
    }
    return { pts, norm: normalsOf(pts) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, variant]);

  // ほつれ繊維: 主線のふち近くに、位置ジッター付きの短い糸を多数並べる
  const fibers = useMemo(() => {
    const count = 12 + Math.floor(rnd(7) * 5); // 12..16 本
    const out: {
      pts: Pt[];
      hw: number[];
      cStops: ColorStop[];
      delay: number;
      op: number;
    }[] = [];
    for (let f = 0; f < count; f++) {
      const side = rnd(f + 20) < 0.5 ? 1 : -1;
      const startU = rnd(f + 30) * 0.78;
      const spanU = 0.1 + rnd(f + 40) * 0.34;
      const i0 = Math.round(startU * N);
      const i1 = Math.min(N, Math.max(i0 + 2, Math.round((startU + spanU) * N)));
      const baseOff = thickness * (0.85 + rnd(f + 50) * 1.5); // ふちより外へ
      const wobble = 0.5 + rnd(f + 60); // ざらつきの強さ
      const w = thickness * (0.11 + rnd(f + 70) * 0.16); // 細い糸
      const fpts: Pt[] = [];
      for (let k = i0; k <= i1; k++) {
        // 粗い揺らぎ + 髪状の細かな正弦
        const rough =
          (rnd(f * 131 + k * 17 + 3) - 0.5) * thickness * wobble +
          Math.sin(k * 0.9 + f) * thickness * 0.22 * wobble;
        const off = side * (baseOff + rough);
        fpts.push([
          geom.pts[k][0] + geom.norm[k][0] * off,
          geom.pts[k][1] + geom.norm[k][1] * off,
        ]);
      }
      const uMid0 = i0 / N;
      const uMid1 = i1 / N;
      out.push({
        pts: fpts,
        hw: [w * 0.35, w, w * 0.7, w * 0.2], // 糸端は細く尖る
        cStops: [
          { offset: 0, color: sampleStops(stops, uMid0) },
          { offset: 1, color: sampleStops(stops, uMid1) },
        ],
        delay: rnd(f + 80) * 0.42,
        op: 0.32 + rnd(f + 90) * 0.28,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, variant, geom, stops]);

  // わずかな二重線: 主線を法線方向へ一定量ずらした細いゴースト
  const ghost = useMemo(() => {
    const gside = rnd(11) < 0.5 ? 1 : -1;
    const off = thickness * (1.25 + rnd(12) * 0.4);
    const pts: Pt[] = geom.pts.map((p, i) => [
      p[0] + geom.norm[i][0] * off * gside,
      p[1] + geom.norm[i][1] * off * gside,
    ]);
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, variant]);

  // 主線の先細り: 始点やや細 → 中盤太 → 終点細
  const mainHalf = useMemo(
    () => [thickness * 0.5, thickness, thickness * 1.05, thickness * 0.7, thickness * 0.35],
    [thickness],
  );
  const ghostHalf = useMemo(
    () => [thickness * 0.25, thickness * 0.5, thickness * 0.5, thickness * 0.3, thickness * 0.15],
    [thickness],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* ほつれ繊維（主線の背後）: 少しずつ遅れて弾け出る */}
        {fibers.map((fb, i) => {
          const local = Math.min(1, Math.max(0, (t - fb.delay) / 0.35));
          const fp = easeOutCubic(local);
          if (fp <= 0) return null;
          return (
            <GlowStroke
              key={`f${i}`}
              uid={`frayed-${vid}-f${i}`}
              points={fb.pts}
              halfWidth={fb.hw}
              colorStops={fb.cStops}
              progress={fp}
              glow={0.6}
              bloomRadius={8}
              opacity={fb.op}
            />
          );
        })}

        {/* わずかな二重線 */}
        <GlowStroke
          uid={`frayed-${vid}-ghost`}
          points={ghost}
          halfWidth={ghostHalf}
          colorStops={stops}
          progress={progress}
          glow={0.7}
          bloomRadius={10}
          opacity={0.5}
        />

        {/* 主線（最前面）: 先端に白熱コアが走る */}
        <GlowStroke
          uid={`frayed-${vid}-main`}
          points={geom.pts}
          halfWidth={mainHalf}
          colorStops={stops}
          progress={progress}
          glow={1}
          bloomRadius={13}
          leadCore
          leadCoreColor="#eafff5"
        />
      </svg>
    </AbsoluteFill>
  );
};
