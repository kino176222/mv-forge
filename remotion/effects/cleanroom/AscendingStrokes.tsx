import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * AscendingStrokes（クリーンルーム再実装）
 *
 * 画面下から数本の短い縦気味ストロークが時間差で立ち上る、上昇する火の粉。
 * 暖色の金でグラデーションし、先端に白熱コアが灯る。加算ブルームで上品に発光。
 * 背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) は決定論的な種。色相の回転・本数・角度/位置のジッターを与え、
 * 同じ族の別バリアントが少しずつ違って見えるようにする（Math.random は使わない）。
 */
export interface AscendingStrokesProps {
  durationInFrames?: number;
  variant?: number;
  opacity?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL(度,%,%) → "#rrggbb"。暖色金のグラデを variant で微回転させるため。 */
const hslToHex = (h: number, s: number, l: number): string => {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

export const AscendingStrokes: React.FC<AscendingStrokesProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  const v = clamp01(variant);
  // variant 由来の種オフセット（族内で決定論的に散らす）
  const seed = 1 + v * 97;

  // 暖色金。variant で ±10度ほど色相回転（金→琥珀 / 金→黄金の揺らぎ）。
  const baseHue = 40 + (v - 0.5) * 20;
  const stops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(baseHue - 8, 92, 44) }, // 根元: 深い琥珀
      { offset: 0.5, color: hslToHex(baseHue, 96, 60) }, // 中程: 金
      { offset: 1.0, color: hslToHex(baseHue + 8, 82, 84) }, // 先端: 淡い暖白
    ],
    [baseHue],
  );

  // ストローク定義（本数・位置・上昇量・揺れ・時間差を variant から算出）
  const sparks = useMemo(() => {
    const n = 4 + Math.round(rnd(seed) * 2); // 4..6 本
    const out: { pts: Pt[]; hw: number[]; delay: number; thin: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = seed + i * 13.7;
      // x は中央下に寄せて均等配置 + 微ジッター
      const baseX = 0.3 + (0.4 * (i + 0.5)) / n + (rnd(s + 1) - 0.5) * 0.06;
      const x0 = baseX * width;
      const yBottom = height * (0.86 + (rnd(s + 2) - 0.5) * 0.08);
      const rise = height * (0.3 + rnd(s + 3) * 0.2); // 立ち上る高さ
      const sway = width * (0.02 + rnd(s + 4) * 0.035); // 横揺れ幅
      const swayPhase = rnd(s + 5) * Math.PI * 2;
      const swayWaves = 0.6 + rnd(s + 6) * 0.7;
      const N = 14;
      const pts: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const y = yBottom - rise * u;
        // 上るほど少しだけ横へ流れる（火の粉の揺らぎ）
        const x = x0 + Math.sin(swayPhase + u * Math.PI * swayWaves) * sway * u;
        pts.push([x, y]);
      }
      const w = width * (0.004 + rnd(s + 7) * 0.0025);
      // 根元やや細 → 中程太 → 先端は火の粉らしく細く
      const hw = [w * 0.6, w, w * 0.85, w * 0.5, w * 0.18];
      const delay = rnd(s + 8) * 0.42; // 時間差で立ち上る
      const thin = 0.5 + rnd(s + 9) * 0.5;
      out.push({ pts, hw, delay, thin });
    }
    return out;
  }, [width, height, seed]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {sparks.map((sp, i) => {
          // 各本 delay 後に素早く描き切り、以降ホールド
          const local = clamp01((t - sp.delay) / 0.34);
          const progress = easeOutCubic(local);
          if (progress <= 0) return null;
          // 立ち上がり際のグローを抑えて上品に（弾け始めは控えめ）
          const glow = 0.7 + 0.4 * progress;
          return (
            <GlowStroke
              key={i}
              uid={`ascend-${i}`}
              points={sp.pts}
              halfWidth={sp.hw}
              colorStops={stops}
              progress={progress}
              glow={glow}
              bloomRadius={10}
              leadCore
              leadCoreColor="#fff6df"
              opacity={sp.thin}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
