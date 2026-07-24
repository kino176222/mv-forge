import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * WindingStroke1pr3（クリーンルーム再実装）
 *
 * 画面を横切って一筆で描かれる、うねる発光ライン。始点の緑から終点の
 * 紫へグラデーションし、先端に白熱コアが走る。加算ブルームで発光。
 * 背景は透明。約24f/24fps 想定だが durationInFrames に追従。
 */
export interface WindingStroke1pr3Props {
  durationInFrames?: number;
  /** うねりの本数（山の数） */
  waves?: number;
  /** うねりの振幅（画面高に対する比） */
  amplitude?: number;
  /** 線の太さ（px, 半幅） */
  thickness?: number;
  colorStops?: ColorStop[];
  glow?: number;
  opacity?: number;
}

const DEFAULT_STOPS: ColorStop[] = [
  { offset: 0.0, color: "#39f6a6" },
  { offset: 0.45, color: "#3ad2f0" },
  { offset: 0.75, color: "#7a8bff" },
  { offset: 1.0, color: "#b06bff" },
];

export const WindingStroke1pr3: React.FC<WindingStroke1pr3Props> = ({
  durationInFrames,
  waves = 1.7,
  amplitude = 0.11,
  thickness = 7,
  colorStops = DEFAULT_STOPS,
  glow = 1,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.72 までに描き切り、以降ホールド
  const progress = easeOutCubic(Math.min(1, t / 0.72));

  const points = useMemo<Pt[]>(() => {
    const N = 60;
    const x0 = width * 0.14;
    const x1 = width * 0.86;
    const yMid = height * 0.56;
    const amp = height * amplitude;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x = x0 + (x1 - x0) * u;
      // 進むほど上へ持ち上げつつ正弦でうねる
      const rise = -u * height * 0.14;
      const y = yMid + rise + Math.sin(u * Math.PI * waves) * amp * (0.5 + 0.5 * u);
      pts.push([x, y]);
    }
    return pts;
  }, [width, height, waves, amplitude]);

  // 先細り: 始点やや細 → 中盤太 → 終点細
  const halfWidth = useMemo(
    () => [thickness * 0.5, thickness, thickness * 1.05, thickness * 0.7, thickness * 0.35],
    [thickness],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <GlowStroke
          uid="winding-1pr3"
          points={points}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={glow}
          bloomRadius={13}
          leadCore
          leadCoreColor="#eafff5"
        />
      </svg>
    </AbsoluteFill>
  );
};
