import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowStroke, easeOutCubic, type Pt, type ColorStop } from "./lib/GlowStroke";

/**
 * CurvedStroke37il（クリーンルーム再実装）
 *
 * 一筆で描かれるネオンの弧（ほぼ一周するループ）。黄→サーモン→桃→紫の
 * グラデーションが弧に沿って流れ、加算ブルームで太く発光する。背景は透明。
 */
export interface CurvedStroke37ilProps {
  durationInFrames?: number;
  /** 弧の中心（0..1比） */
  centerX?: number;
  centerY?: number;
  /** 楕円の半径（画面幅・高に対する比） */
  radiusX?: number;
  radiusY?: number;
  /** 描く弧の角度（度）。約340で「ほぼ一周」 */
  sweepDeg?: number;
  /** 開始角（度、0=右 / 90=下） */
  startDeg?: number;
  thickness?: number;
  colorStops?: ColorStop[];
  glow?: number;
  opacity?: number;
}

const DEFAULT_STOPS: ColorStop[] = [
  { offset: 0.0, color: "#ffd24a" },
  { offset: 0.3, color: "#ff9d6b" },
  { offset: 0.55, color: "#ff6bd0" },
  { offset: 0.8, color: "#c86bff" },
  { offset: 1.0, color: "#7d5bff" },
];

export const CurvedStroke37il: React.FC<CurvedStroke37ilProps> = ({
  durationInFrames,
  centerX = 0.5,
  centerY = 0.5,
  radiusX = 0.135,
  radiusY = 0.215,
  sweepDeg = 350,
  startDeg = -74,
  thickness = 17,
  colorStops = DEFAULT_STOPS,
  glow = 1,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const cfg = useVideoConfig();
  const dur = durationInFrames ?? cfg.durationInFrames;
  const { width, height } = cfg;

  const t = dur <= 1 ? 1 : frame / (dur - 1);
  // 0.62 までに描き切り、以降ホールド（f3=0.85 で完全に一周した太い輪に）
  const progress = easeOutCubic(Math.min(1, t / 0.62));

  const points = useMemo<Pt[]>(() => {
    const N = 72;
    const cx = centerX * width;
    const cy = centerY * height;
    const rx = radiusX * width;
    const ry = radiusY * height;
    const pts: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const deg = startDeg + sweepDeg * u;
      const rad = (deg * Math.PI) / 180;
      pts.push([cx + rx * Math.cos(rad), cy + ry * Math.sin(rad)]);
    }
    return pts;
  }, [width, height, centerX, centerY, radiusX, radiusY, sweepDeg, startDeg]);

  const halfWidth = useMemo(
    () => [thickness * 0.7, thickness, thickness, thickness, thickness * 0.8],
    [thickness],
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <GlowStroke
          uid="curved-37il"
          points={points}
          halfWidth={halfWidth}
          colorStops={colorStops}
          progress={progress}
          glow={glow}
          bloomRadius={16}
          leadCore
          leadCoreColor="#fff4d8"
        />
      </svg>
    </AbsoluteFill>
  );
};
