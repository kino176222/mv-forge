import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * Swoosh4le6（クリーンルーム再実装）
 *
 * 斜めに走る筆致のスウッシュ（速度線）2本。中央が太く両端が細る筆の
 * テーパーで、白熱の芯にわずかな青みの発光縁。素早く描かれて残る。
 * 背景は透明。
 */
export interface Swoosh4le6Props {
  durationInFrames?: number;
  /** 線の本数 */
  count?: number;
  /** 傾き（度）。負で右上がり */
  angleDeg?: number;
  /** 筆の最大太さ（px, 半幅） */
  thickness?: number;
  /** 芯色→縁色のグラデ（長さ方向ではなく発光の色味） */
  colorStops?: ColorStop[];
  glow?: number;
  opacity?: number;
}

const DEFAULT_STOPS: ColorStop[] = [
  { offset: 0.0, color: "#cfe6ff" },
  { offset: 0.5, color: "#ffffff" },
  { offset: 1.0, color: "#d8ecff" },
];

export const Swoosh4le6: React.FC<Swoosh4le6Props> = ({
  durationInFrames,
  count = 2,
  angleDeg = -19,
  thickness = 12,
  colorStops = DEFAULT_STOPS,
  glow = 1.1,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);

  // 各線: 中心・長さ・太さ倍率・開始位相をずらす
  const strokes = useMemo(() => {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const nx = -dy;
    const ny = dx;
    const specs = [
      { cxr: 0.52, cyr: 0.46, lenR: 0.62, wMul: 1.0, delay: 0.0, bow: 0.05 },
      { cxr: 0.6, cyr: 0.62, lenR: 0.42, wMul: 0.7, delay: 0.12, bow: 0.06 },
      { cxr: 0.44, cyr: 0.36, lenR: 0.34, wMul: 0.5, delay: 0.2, bow: 0.04 },
    ].slice(0, Math.max(1, count));
    return specs.map((s) => {
      const cx = s.cxr * width;
      const cy = s.cyr * height;
      const half = (s.lenR * width) / 2;
      const N = 28;
      const pts: Pt[] = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N; // 0..1 along
        const along = (u - 0.5) * 2 * half; // -half..half
        // ゆるい弓なり（bow）を法線方向に足す
        const bowOff = Math.sin(u * Math.PI) * s.bow * width;
        pts.push([cx + dx * along + nx * bowOff, cy + dy * along + ny * bowOff]);
      }
      return { pts, wMul: s.wMul, delay: s.delay };
    });
  }, [width, height, angleDeg, count]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {strokes.map((s, i) => {
          const local = Math.min(1, Math.max(0, (t - s.delay) / 0.4));
          const progress = easeOutCubic(local);
          if (progress <= 0) return null;
          const w = thickness * s.wMul;
          // 筆のテーパー: 端0 → 中央太 → 端0
          const hw = [w * 0.06, w * 0.55, w, w * 0.9, w * 0.4, w * 0.05];
          return (
            <GlowStroke
              key={i}
              uid={`swoosh-4le6-${i}`}
              points={s.pts}
              halfWidth={hw}
              colorStops={colorStops}
              progress={progress}
              glow={glow}
              bloomRadius={12}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
