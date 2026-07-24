import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { hashRand } from "./rand";

/**
 * フィルムグレイン: 小さなノイズタイルを8枚だけ事前生成し、
 * フレームごとに切り替えて敷き詰める（全画素を毎フレーム描くと重いため）。
 */
const TILE = 256;
const TILE_COUNT = 8;

function makeTiles(size: number): string[] {
  if (typeof document === "undefined") return [];
  const tiles: string[] = [];
  for (let n = 0; n < TILE_COUNT; n++) {
    const canvas = document.createElement("canvas");
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    const img = ctx.createImageData(TILE, TILE);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(hashRand(n * 7919, i) * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tiles.push(canvas.toDataURL());
  }
  void size;
  return tiles;
}

export const FilmGrain: React.FC<{
  intensity: number;
  size: number;
}> = ({ intensity, size }) => {
  const frame = useCurrentFrame();
  const tiles = useMemo(() => makeTiles(size), [size]);
  if (tiles.length === 0) return null;
  const tile = tiles[frame % tiles.length];
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${tile})`,
        backgroundRepeat: "repeat",
        backgroundSize: `${TILE * size}px ${TILE * size}px`,
        opacity: intensity,
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    />
  );
};
