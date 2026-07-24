import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, sampleStops, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * ConvergingStrokes（クリーンルーム再実装）
 *
 * 画面端から中心のやや上寄りの一点へ、5〜8本の直線ストロークが内向きに
 * 走って収束する。各条は白熱コア（先端）を先頭に少しずつ時間差で描かれ、
 * 到達すると中心が白く閃く。色はマゼンタ→紫の加算グロー。背景は透明。
 * 約24f/24fps 想定だが durationInFrames に追従。
 */
export interface ConvergingStrokesProps {
  durationInFrames?: number;
  /** 0..1 の種。色相回転・角度/本数/位置の微ジッターに使う（決定論的）。 */
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

export const ConvergingStrokes: React.FC<ConvergingStrokesProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  const v = ((variant % 1) + 1) % 1; // 0..1 に正規化

  // マゼンタ→紫。variant で色相を ±15° ほど回す（上品な範囲に留める）
  const colorStops = useMemo<ColorStop[]>(() => {
    const shift = (v - 0.5) * 30;
    return [
      { offset: 0.0, color: hslToHex(318 + shift, 92, 62) },
      { offset: 0.55, color: hslToHex(300 + shift, 88, 60) },
      { offset: 1.0, color: hslToHex(278 + shift, 80, 56) },
    ];
  }, [v]);

  // 収束先: 中心のやや上寄り（variant で微ジッター）
  const cx = width * (0.5 + (rnd(v * 91.3 + 2) - 0.5) * 0.05);
  const cy = height * (0.42 + (rnd(v * 57.7 + 5) - 0.5) * 0.05);

  const strokes = useMemo(() => {
    const count = 5 + Math.round(rnd(v * 41.7 + 1) * 3); // 5..8
    const baseDeg = v * 360; // ファン全体を variant で回す
    const rInner = width * 0.02; // 中心の少し手前で止める
    const w0 = width * 0.006;
    const out: { pts: Pt[]; hw: number[]; delay: number }[] = [];
    for (let i = 0; i < count; i++) {
      const s = i + 1 + v * 100;
      const jitter = (rnd(s + 3) - 0.5) * (360 / count) * 0.55;
      const deg = baseDeg + (360 / count) * i + jitter;
      const rad = (deg * Math.PI) / 180;
      // 画面端側から入る（開始半径をばらつかせる）
      const rOuter = width * (0.56 + rnd(s + 7) * 0.16);
      // 収束先を数pxだけ散らして重なりを有機的に
      const tx = cx + (rnd(s + 11) - 0.5) * width * 0.012;
      const ty = cy + (rnd(s + 13) - 0.5) * width * 0.012;
      const N = 8;
      const pts: Pt[] = [];
      for (let k = 0; k <= N; k++) {
        const u = k / N;
        const r = rOuter + (rInner - rOuter) * u; // 外→内
        pts.push([tx + Math.cos(rad) * r, ty + Math.sin(rad) * r]);
      }
      // 尾は細く先頭（中心側）は太い彗星テーパー
      const w = w0 * (0.75 + rnd(s + 17) * 0.6);
      const hw = [w * 0.18, w * 0.4, w * 0.7, w, w * 1.15];
      const delay = rnd(s + 19) * 0.22;
      out.push({ pts, hw, delay });
    }
    return out;
  }, [width, cx, cy, v]);

  // 描き切りウィンドウ（以降ホールド）と、到達時の白い閃光（ガウス山）
  const drawWindow = 0.52;
  const flash = Math.exp(-Math.pow((t - 0.72) / 0.12, 2));
  const haloColor = sampleStops(colorStops, 1);
  const haloR = width * 0.03;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="converging-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={22} />
          </filter>
          <radialGradient id="converging-halo">
            <stop offset="0%" stopColor="#fff2fb" stopOpacity="0.95" />
            <stop offset="40%" stopColor={haloColor} stopOpacity="0.55" />
            <stop offset="100%" stopColor={haloColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 収束していくストローク（先端に白熱コア） */}
        {strokes.map((st, i) => {
          const local = Math.min(1, Math.max(0, (t - st.delay) / drawWindow));
          const progress = easeOutCubic(local);
          if (progress <= 0) return null;
          return (
            <GlowStroke
              key={i}
              uid={`converging-${i}`}
              points={st.pts}
              halfWidth={st.hw}
              colorStops={colorStops}
              progress={progress}
              glow={1}
              bloomRadius={12}
              leadCore
              leadCoreColor="#fff3fb"
            />
          );
        })}

        {/* 到達時の中心の閃光: ハロー + 白熱コア */}
        <g style={{ mixBlendMode: "screen" }}>
          <circle
            cx={cx}
            cy={cy}
            r={haloR * (2.6 + 1.6 * flash)}
            fill="url(#converging-halo)"
            opacity={0.85 * flash}
            filter="url(#converging-bloom)"
          />
          <circle
            cx={cx}
            cy={cy}
            r={haloR * (0.5 + 0.5 * flash)}
            fill="#fff6fc"
            opacity={0.9 * flash}
          />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
