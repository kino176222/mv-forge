import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { hashRand } from "./rand";

/**
 * 光漏れ／フレア: 大きな光の玉がゆっくり漂いながら明滅する。
 * エモ・幻想・回想向き。
 */
const BLOB_COUNT = 3;

export const LightLeakFx: React.FC<{
  intensity: number;
  hue: number;
  drift: number;
}> = ({ intensity, hue, drift }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * drift;

  const blobs = Array.from({ length: BLOB_COUNT }, (_, i) => {
    const baseX = 15 + hashRand(i, 11) * 70;
    const baseY = 10 + hashRand(i, 12) * 60;
    const x = baseX + Math.sin(t * (0.3 + hashRand(i, 13) * 0.4) + i * 2.1) * 12;
    const y = baseY + Math.cos(t * (0.25 + hashRand(i, 14) * 0.3) + i * 1.7) * 10;
    const size = 45 + hashRand(i, 15) * 45; // vmin相当(%)
    const pulse = 0.75 + Math.sin(t * 0.8 + i * 2.6) * 0.25;
    const h = (hue + i * 18) % 360;
    const alpha = intensity * pulse * (i === 0 ? 0.9 : 0.55);
    return { x, y, size, color: `hsla(${h}, 90%, 65%, ${alpha})` };
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", mixBlendMode: "screen" }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: `${b.size}%`,
            aspectRatio: "1",
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, ${b.color} 0%, transparent 65%)`,
            filter: "blur(20px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
