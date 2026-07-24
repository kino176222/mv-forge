import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * HeartStroke（クリーンルーム再実装）
 *
 * ハートの輪郭を一筆の連続ネオンストロークで描き上げる。上の窪みから右葉→
 * 下の尖り→左葉と滑らかに描かれ、先端に白熱コアが走る。桃→紅のグラデーション。
 * 加算ブルームで上品に発光し、描き切った瞬間にハローがふわっと弾ける。
 * 背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) を種に、色相の回転・傾き・拡縮・位置・きらめきの位置を
 * 決定論的にジッターさせ、同じ族の別バリアントを作り分ける（Math.random 不使用）。
 */
export interface HeartStrokeProps {
  durationInFrames?: number;
  /** 0..1 の種。色相/角度/本数/位置の微ジッターに使う。 */
  variant?: number;
  opacity?: number;
}

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL(deg,%,%) → "#rrggbb" */
const hslToHex = (h: number, s: number, l: number): string => {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const c = L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

export const HeartStroke: React.FC<HeartStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.7 までに描き切り、以降ホールド
  const progress = easeOutCubic(Math.min(1, t / 0.7));

  // variant から決定論的にパラメータを算出
  const v = Math.min(1, Math.max(0, variant));
  const baseHue = 344 + (v - 0.5) * 28; // 桃〜紅の帯を保ちつつ回す
  const rot = (rnd(v * 100 + 1) - 0.5) * 0.16; // 全体の傾き ±約4.6°
  const jx = (rnd(v * 100 + 2) - 0.5) * width * 0.03; // 位置ジッター
  const jy = (rnd(v * 100 + 3) - 0.5) * height * 0.03;

  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(baseHue + 8, 100, 84) },
      { offset: 0.4, color: hslToHex(baseHue, 100, 66) },
      { offset: 0.72, color: hslToHex(baseHue - 10, 96, 56) },
      { offset: 1.0, color: hslToHex(baseHue - 20, 90, 48) },
    ],
    [baseHue],
  );

  // ハートの寸法（数式座標系: x∈[-16,16], y∈[+5,-17], 縦中心 midY=-6）
  const midY = -6;
  const scale = (height * 0.44) / 22;
  const cx = width * 0.5 + jx;
  const cy = height * 0.5 + jy;

  const points = useMemo<Pt[]>(() => {
    const N = 120;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2; // 上の窪み中央(θ=0)から一周
      const xm = 16 * Math.pow(Math.sin(th), 3);
      const ym =
        13 * Math.cos(th) -
        5 * Math.cos(2 * th) -
        2 * Math.cos(3 * th) -
        Math.cos(4 * th);
      // 中心寄せ＋y反転（SVGは下向き正）
      const sx = cx + scale * xm;
      const sy = cy - scale * (ym - midY);
      // 中心まわりに傾ける
      const dx = sx - cx;
      const dy = sy - cy;
      pts.push([
        cx + dx * Math.cos(rot) - dy * Math.sin(rot),
        cy + dx * Math.sin(rot) + dy * Math.cos(rot),
      ]);
    }
    return pts;
  }, [width, height, cx, cy, scale, rot]);

  // 先細り: 窪み(始点/終点)で細く、下の丸みで太い
  const thickness = scale * 0.55;
  const halfWidth = useMemo(
    () => [
      thickness * 0.42,
      thickness * 0.95,
      thickness * 1.08,
      thickness * 0.95,
      thickness * 0.42,
    ],
    [thickness],
  );

  // ハロー: 描き出しで立ち上がり、描き切りでふわっと弾ける
  const appear = easeOutCubic(Math.min(1, t / 0.5));
  const pop = 1 + 0.14 * Math.exp(-Math.pow((t - 0.72) / 0.12, 2));
  const haloColor = hslToHex(baseHue, 100, 62);
  const haloR = scale * 12 * pop;

  // きらめき: variant 由来の位置に小さな光点（描き切り後にふわっと）
  const sparkles = useMemo(() => {
    const n = 3;
    return Array.from({ length: n }, (_, i) => {
      const ang = rnd(v * 100 + 10 + i) * Math.PI * 2;
      const r = scale * (17 + rnd(v * 100 + 20 + i) * 8);
      const phase = rnd(v * 100 + 30 + i) * Math.PI * 2;
      return {
        x: cx + Math.cos(ang) * r,
        y: cy - Math.abs(Math.sin(ang)) * r * 0.5 - scale * 2, // やや上寄り
        phase,
        rad: scale * (0.5 + rnd(v * 100 + 40 + i) * 0.35),
      };
    });
  }, [v, cx, cy, scale]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="heart-stroke-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={scale * 0.9} />
          </filter>
          <radialGradient id="heart-stroke-halo">
            <stop offset="0%" stopColor={haloColor} stopOpacity="0.55" />
            <stop offset="55%" stopColor={haloColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={haloColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 背後のやわらかいハロー */}
        <circle
          cx={cx}
          cy={cy}
          r={haloR}
          fill="url(#heart-stroke-halo)"
          opacity={0.85 * appear}
          filter="url(#heart-stroke-bloom)"
          style={{ mixBlendMode: "screen" }}
        />

        {/* ハート本体（一筆ネオン） */}
        <GlowStroke
          uid="heart-stroke"
          points={points}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={1}
          bloomRadius={scale * 0.75}
          leadCore
          leadCoreColor="#fff2f7"
        />

        {/* きらめき（控えめ） */}
        {sparkles.map((sp, i) => {
          const tw = Math.max(0, Math.sin(t * Math.PI * 3 + sp.phase));
          const glint = appear * (0.35 + 0.65 * tw) * Math.min(1, progress * 1.4);
          if (glint <= 0.02) return null;
          return (
            <g key={i} style={{ mixBlendMode: "screen" }}>
              <circle
                cx={sp.x}
                cy={sp.y}
                r={sp.rad * 2.2}
                fill={sampleStops(colorStops, 0.3)}
                opacity={0.5 * glint}
                filter="url(#heart-stroke-bloom)"
              />
              <circle cx={sp.x} cy={sp.y} r={sp.rad} fill="#fff2f7" opacity={glint} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
