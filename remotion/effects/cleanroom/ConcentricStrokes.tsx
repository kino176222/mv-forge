import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * ConcentricStrokes（クリーンルーム再実装）
 *
 * 画面中心から 3〜5 本の同心円弧が外へ広がる波紋。各弧は素早く一筆で
 * 掃くように描かれ、外へ広がりながら細く・薄くフェードする。シアン/白の
 * 上品なネオン。加算ブルームで発光。背景は透明。約24f/24fps 想定だが
 * durationInFrames に追従する。
 *
 * variant（0..1 の種）で色相の回転・開始角・本数・中心の微ジッターを
 * 決定論的に与え、同族の別バリアントが少しずつ違って見えるようにする。
 */
export interface ConcentricStrokesProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転・角度/本数/位置の微ジッターに使う。 */
  variant?: number;
  opacity?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 決定論的な擬似乱数（seed から）。Math.random は使わない。 */
const rnd = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL(h:0-360, s/l:0-1) → "#rrggbb"。色相回転をシアン域で行うため。 */
const hslToHex = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
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
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

/** 波紋1本ぶんの静的パラメータ */
interface Ring {
  delay: number;
  a0: number;
  sweep: number; // 符号で描画方向
  r0: number;
  r1: number;
  thick: number;
  cxJit: number;
  cyJit: number;
  hueShift: number;
}

export const ConcentricStrokes: React.FC<ConcentricStrokesProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  const minDim = Math.min(width, height);

  // 色相はシアン域（168..204）で variant により回転。ケバさを抑える。
  const baseHue = 186 + (variant - 0.5) * 36;

  // 各波紋の静的パラメータ（幾何の時間変化は毎フレーム算出するのでここには含めない）
  const rings = useMemo<Ring[]>(() => {
    const n = 3 + Math.floor(rnd(variant * 7.3 + 1) * 3); // 3..5
    const a0Base = variant * Math.PI * 2;
    const out: Ring[] = [];
    for (let i = 0; i < n; i++) {
      const s = variant * 100 + i;
      const dir = rnd(s + 5) > 0.5 ? 1 : -1;
      out.push({
        delay: i * 0.11 + rnd(s + 2) * 0.05,
        a0: a0Base + rnd(s + 3) * Math.PI * 2 + i * 0.7,
        sweep: Math.PI * (1.5 + rnd(s + 4) * 0.4) * dir, // 1.5π..1.9π
        r0: minDim * (0.02 + rnd(s + 6) * 0.02),
        r1: minDim * (0.16 + i * 0.06 + rnd(s + 7) * 0.05),
        thick: minDim * (0.006 + rnd(s + 8) * 0.004),
        cxJit: (rnd(s + 9) - 0.5) * 0.03,
        cyJit: (rnd(s + 10) - 0.5) * 0.03,
        hueShift: (rnd(s + 11) - 0.5) * 14,
      });
    }
    return out;
  }, [minDim, variant]);

  const LIFE = 0.72; // 各波紋の寿命（t 尺度）
  const N = 56; // 弧のサンプル点数

  // 中心の淡いフラッシュ（波紋の発生源）: 序盤で立ち上がり素早く消える
  const flash = 1 - easeOutCubic(Math.min(1, t / 0.4));
  const coreR = minDim * 0.06;
  const coreColor = hslToHex(baseHue, 0.6, 0.9);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="conc-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={22} />
          </filter>
          <radialGradient id="conc-core">
            <stop offset="0%" stopColor={coreColor} stopOpacity="0.9" />
            <stop offset="55%" stopColor={coreColor} stopOpacity="0.4" />
            <stop offset="100%" stopColor={coreColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 中心フラッシュ */}
        {flash > 0.001 && (
          <circle
            cx={width * 0.5}
            cy={height * 0.5}
            r={coreR}
            fill="url(#conc-core)"
            opacity={0.55 * flash}
            filter="url(#conc-bloom)"
            style={{ mixBlendMode: "screen" }}
          />
        )}

        {rings.map((ring, i) => {
          if (t < ring.delay) return null;
          const l = clamp01((t - ring.delay) / LIFE);
          const drawProg = easeOutCubic(Math.min(1, l / 0.4)); // 前半で掃き切る
          const grow = easeOutCubic(l); // 外へ広がる
          const appear = Math.min(1, l / 0.1);
          const ringOpacity = appear * Math.pow(1 - l, 1.3); // 広がりながら消える
          if (ringOpacity <= 0.001 || drawProg <= 0) return null;

          const cx = (0.5 + ring.cxJit) * width;
          const cy = (0.5 + ring.cyJit) * height;
          const r = ring.r0 + (ring.r1 - ring.r0) * grow;

          const pts: Pt[] = [];
          for (let k = 0; k <= N; k++) {
            const u = k / N;
            const ang = ring.a0 + ring.sweep * u;
            pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
          }

          // 広がるほど細く。両端を細める柔らかいリング状テーパー。
          const tw = ring.thick * (1 - 0.45 * l);
          const hw = [tw * 0.5, tw * 0.9, tw, tw * 0.9, tw * 0.55];

          const hue = baseHue + ring.hueShift;
          const stops: ColorStop[] = [
            { offset: 0.0, color: hslToHex(hue + 10, 0.85, 0.52) }, // ティール寄りの尾
            { offset: 0.55, color: hslToHex(hue, 1.0, 0.72) }, // シアン
            { offset: 1.0, color: hslToHex(hue, 0.55, 0.96) }, // 白熱した掃き先頭
          ];

          return (
            <GlowStroke
              key={i}
              uid={`conc-${i}`}
              points={pts}
              halfWidth={hw}
              colorStops={stops}
              progress={drawProg}
              glow={1}
              bloomRadius={11}
              leadCore={drawProg < 0.99}
              leadCoreColor={hslToHex(hue, 0.4, 0.97)}
              opacity={ringOpacity}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
