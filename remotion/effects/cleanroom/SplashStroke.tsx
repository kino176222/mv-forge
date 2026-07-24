import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * SplashStroke（クリーンルーム再実装）
 *
 * 中央の短いにじみ（ソフトなブリード）から、数本の雫ストロークが外へ弾ける
 * インクの飛沫。マゼンタ〜サーモンのネオンで、加算ブルームで上品に発光する。
 * 各雫は序盤で速く飛び出し（弾ける）以降ホールド。背景は透明。
 * 約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) は種。色相の回転・雫の本数/角度/距離のジッターを決定論的に
 * 与え、同じ族の別バリアントが少しずつ違って見えるようにする。
 */
export interface SplashStrokeProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転と配置ジッターを決める（Math.random は使わない） */
  variant?: number;
  opacity?: number;
}

/** 決定論的な擬似乱数（seed から 0..1） */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL → "#rrggbb"（色相回転を効かせるため色は HSL で組み立てる） */
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

/** 雫の長さ方向グラデ: 尾の白熱ピンク → マゼンタ → 頭のサーモン */
const dropletStops = (rot: number): ColorStop[] => [
  { offset: 0.0, color: hslToHex(340 + rot, 100, 90) },
  { offset: 0.45, color: hslToHex(322 + rot, 92, 63) },
  { offset: 1.0, color: hslToHex(6 + rot, 90, 66) },
];

export const SplashStroke: React.FC<SplashStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 色相回転: ±18度でマゼンタ/サーモンの族内に収める
  const rot = (variant - 0.5) * 36;
  // 一意プレフィックス（複数バリアントの svg filter 衝突回避）
  const vid = Math.round(variant * 997);

  // 中央のにじみ・飛沫の基点（variant で僅かにずらす）
  const cx = width * (0.5 + (rnd(variant * 13.1 + 1) - 0.5) * 0.05);
  const cy = height * (0.5 + (rnd(variant * 21.7 + 2) - 0.5) * 0.05);
  const ringR = width * 0.028;

  // にじみは速く描き切ってホールド / 飛沫は速いイーズで弾けてホールド
  const smearP = easeOutCubic(Math.min(1, t / 0.32));
  const burst = easeOutCubic(Math.min(1, t / 0.5));

  // 中央の短いにじみ（緩い弧を描く短ストローク）
  const smear = useMemo(() => {
    const ang = rnd(variant * 7.3 + 4) * Math.PI * 2;
    const len = width * 0.055;
    const bow = width * 0.014; // 弧のふくらみ
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const nx = -dy;
    const ny = dx;
    const N = 5;
    const pts: Pt[] = [];
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      const s = (u - 0.5) * len; // 中心対称に配置
      const bend = Math.sin(u * Math.PI) * bow;
      pts.push([cx + dx * s + nx * bend, cy + dy * s + ny * bend]);
    }
    const w = width * 0.02;
    const hw = [w * 0.4, w * 0.85, w, w * 0.8, w * 0.35];
    return { pts, hw };
  }, [width, cx, cy, variant]);

  // 飛沫（雫）の静的パラメータ
  const drops = useMemo(() => {
    const n = 5 + Math.floor(rnd(variant * 5.9 + 3) * 4); // 5..8 本
    return Array.from({ length: n }, (_, i) => {
      const seed = i + 1 + variant * 100;
      const jitter = (rnd(seed) - 0.5) * (360 / n) * 0.7;
      const deg = (360 / n) * i + jitter - 90;
      const rad = (deg * Math.PI) / 180;
      const reach = width * (0.09 + rnd(seed + 0.3) * 0.13); // 飛距離
      const baseLen = width * (0.03 + rnd(seed + 0.6) * 0.04); // 雫の基準長
      const w = width * (0.004 + rnd(seed + 0.9) * 0.006); // 頭の半幅
      const hueShift = (rnd(seed + 1.2) - 0.5) * 18; // 個体ごとの微色相差
      const delay = rnd(seed + 1.5) * 0.18; // 弾け出しの遅延
      return { rad, reach, baseLen, w, hueShift, delay };
    });
  }, [width, variant]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`splash-${vid}-bloom`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={22} />
          </filter>
          <radialGradient id={`splash-${vid}-bleed`}>
            <stop offset="0%" stopColor={hslToHex(330 + rot, 100, 82)} stopOpacity="0.85" />
            <stop offset="55%" stopColor={hslToHex(322 + rot, 90, 60)} stopOpacity="0.4" />
            <stop offset="100%" stopColor={hslToHex(322 + rot, 90, 60)} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 中央のソフトなにじみ（ブリード） */}
        <circle
          cx={cx}
          cy={cy}
          r={ringR * 3.4 * (0.7 + 0.3 * smearP)}
          fill={`url(#splash-${vid}-bleed)`}
          opacity={0.9 * smearP}
          filter={`url(#splash-${vid}-bloom)`}
        />

        {/* にじみの短ストローク本体 */}
        <GlowStroke
          uid={`splash-${vid}-smear`}
          points={smear.pts}
          halfWidth={smear.hw}
          colorStops={dropletStops(rot)}
          progress={smearP}
          glow={1}
          bloomRadius={16}
        />

        {/* 外へ弾ける雫ストローク */}
        {drops.map((d, i) => {
          const local = Math.min(1, Math.max(0, (burst - d.delay) / (1 - d.delay || 1)));
          if (local <= 0) return null;
          // 頭は外へ飛び、尾は後ろに残る（序盤ほど長い＝モーションブラー感）
          const streak = d.baseLen * (0.45 + 0.55 * (1 - local));
          const rHead = ringR + d.reach * local;
          const rTail = Math.max(ringR * 0.6, rHead - streak);
          const N = 6;
          const pts: Pt[] = [];
          for (let k = 0; k <= N; k++) {
            const u = k / N;
            const r = rTail + (rHead - rTail) * u;
            pts.push([cx + Math.cos(d.rad) * r, cy + Math.sin(d.rad) * r]);
          }
          // 尾は細く、頭に向けて太る雫形
          const hw = [d.w * 0.14, d.w * 0.28, d.w * 0.5, d.w * 0.75, d.w * 0.95, d.w];
          const fade = Math.min(1, local * 2.4);
          return (
            <GlowStroke
              key={i}
              uid={`splash-${vid}-drop-${i}`}
              points={pts}
              halfWidth={hw}
              colorStops={dropletStops(rot + d.hueShift)}
              progress={1}
              glow={1}
              bloomRadius={10}
              leadCore
              leadCoreColor={hslToHex(350 + rot, 100, 92)}
              opacity={fade}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
