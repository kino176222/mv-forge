import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * CurvedDropsStroke（クリーンルーム再実装）
 *
 * 発光する弧のストロークが一筆で描かれ、その下辺に沿って小さな光る雫が
 * 点在してしたたり落ちる。青〜シアンの上品なネオン。加算ブルームで発光。
 * 背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 *
 * variant(0..1) を種に色相回転・弧の反り・雫の本数/位置を決定論的に振る
 * （Math.random は使わない）。同じ族の別バリアントが少しずつ違って見える。
 */
export interface CurvedDropsStrokeProps {
  durationInFrames?: number;
  variant?: number;
  opacity?: number;
}

/** variant 由来の決定論的擬似乱数 */
const rnd = (seed: number, variant: number) => {
  const x = Math.sin((seed + 1 + variant * 12.9) * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** HSL → #hex（色相回転で青/シアンを崩さず振るため） */
const hslToHex = (h: number, s: number, l: number): string => {
  const hn = ((h % 360) + 360) % 360;
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 60) [r, g, b] = [c, x, 0];
  else if (hn < 120) [r, g, b] = [x, c, 0];
  else if (hn < 180) [r, g, b] = [0, c, x];
  else if (hn < 240) [r, g, b] = [0, x, c];
  else if (hn < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
};

export const CurvedDropsStroke: React.FC<CurvedDropsStrokeProps> = ({
  durationInFrames,
  variant = 0,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const v = Math.min(1, Math.max(0, variant));
  const t = dur <= 1 ? 1 : frame / (dur - 1);

  // 弧は序盤で描き切り、以降ホールド
  const ARC_DRAW = 0.5;
  const progress = easeOutCubic(Math.min(1, t / ARC_DRAW));

  // 色相: シアン(約188)〜青(約212)の帯を variant で回す
  const baseHue = 188 + v * 24;
  const colorStops = useMemo<ColorStop[]>(
    () => [
      { offset: 0.0, color: hslToHex(baseHue - 10, 92, 82) },
      { offset: 0.4, color: hslToHex(baseHue, 96, 62) },
      { offset: 0.75, color: hslToHex(baseHue + 12, 90, 54) },
      { offset: 1.0, color: hslToHex(baseHue + 22, 86, 48) },
    ],
    [baseHue],
  );
  const dropColor = hslToHex(baseHue + 4, 96, 66);
  const dropHead = hslToHex(baseHue - 14, 95, 88);

  // 上に反る弧（アーチ）。反りの向き・量を variant で微ジッター
  const bow = 0.9 + rnd(2, v) * 0.4; // 反りの強さ
  const arc = useMemo(() => {
    const N = 56;
    const x0 = width * (0.15 + (rnd(0, v) - 0.5) * 0.04);
    const x1 = width * (0.85 + (rnd(1, v) - 0.5) * 0.04);
    const yMid = height * 0.5;
    const sag = height * 0.13 * bow;
    // 全体を僅かに傾ける（水平すぎない上品な弧に）
    const tilt = (rnd(3, v) - 0.5) * height * 0.06;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = x0 + (x1 - x0) * u;
      const y = yMid - Math.sin(u * Math.PI) * sag + tilt * (u - 0.5) * 2;
      pts.push([x, y]);
    }
    return pts;
  }, [width, height, v, bow]);

  // 先細り: 中盤太く両端細い上品なテーパー
  const halfWidth = useMemo(() => {
    const th = Math.min(width, height) * 0.008;
    return [th * 0.4, th, th * 1.05, th * 0.8, th * 0.35];
  }, [width, height]);

  // 弧に沿う雫。u 位置に置き、弧が通過したあと下へしたたる
  const drops = useMemo(() => {
    const n = 5 + Math.floor(rnd(7, v) * 4); // 5〜8本
    const N = 56;
    const sag = height * 0.13 * bow;
    const x0 = width * (0.15 + (rnd(0, v) - 0.5) * 0.04);
    const x1 = width * (0.85 + (rnd(1, v) - 0.5) * 0.04);
    const yMid = height * 0.5;
    const tilt = (rnd(3, v) - 0.5) * height * 0.06;
    const pointAt = (u: number): Pt => [
      x0 + (x1 - x0) * u,
      yMid - Math.sin(u * Math.PI) * sag + tilt * (u - 0.5) * 2,
    ];
    return Array.from({ length: n }, (_, i) => {
      // 端を避けて均等配置＋位置ジッター
      const u = 0.12 + (0.76 * (i + 0.5)) / n + (rnd(i + 20, v) - 0.5) * 0.05;
      const anchor = pointAt(Math.min(0.97, Math.max(0.03, u)));
      const fall = height * (0.06 + rnd(i + 30, v) * 0.09); // 落下距離
      const drift = (rnd(i + 40, v) - 0.5) * width * 0.012; // 横ぶれ
      const headR = Math.min(width, height) * (0.006 + rnd(i + 50, v) * 0.004);
      const delay = Math.min(0.7, u * ARC_DRAW + rnd(i + 60, v) * 0.08); // 弧通過後
      return { anchor, fall, drift, headR, delay };
    });
  }, [width, height, v, bow]);

  const bloomR = Math.min(width, height) * 0.012;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="curved-drops-bloom" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation={bloomR * 1.6} />
          </filter>
        </defs>

        {/* 本体の弧 */}
        <GlowStroke
          uid="curved-drops-arc"
          points={arc}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={1}
          bloomRadius={bloomR}
          leadCore
          leadCoreColor={dropHead}
        />

        {/* したたる雫: 弧が通過したあとに下へ伸び、頭部が滴る */}
        {drops.map((d, i) => {
          const local = Math.min(1, Math.max(0, (t - d.delay) / 0.34));
          if (local <= 0) return null;
          const grow = easeOutCubic(local);
          const dy = d.fall * grow;
          const tail: Pt = [d.anchor[0] + d.drift * grow, d.anchor[1] + dy];
          // 尾は細く、頭部は leadCore の白熱ドットで滴らせる
          const thin = d.headR * 0.45;
          const fade = Math.min(1, local * 3) * (1 - 0.25 * Math.max(0, local - 0.7) / 0.3);
          return (
            <GlowStroke
              key={i}
              uid={`curved-drop-${i}`}
              points={[d.anchor, tail]}
              halfWidth={[thin * 0.5, thin, d.headR * 0.9]}
              colorStops={[
                { offset: 0, color: dropColor },
                { offset: 1, color: dropHead },
              ]}
              progress={1}
              glow={1}
              bloomRadius={bloomR * 0.7}
              leadCore
              leadCoreColor={dropHead}
              opacity={fade}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
