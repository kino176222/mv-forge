import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { hashRand } from "./rand";

/**
 * グリッチ: 一定間隔で数フレームだけ「発作」を起こす。
 * 発作中は横スライスのズレ＋RGB分離。異界・呪い・不穏。
 * 磨き: 発作は一撃→非線形減衰（フラッター付き）。RGB分離はにじむ光輪、
 *       スライスは鋭い芯として残し、最大ズレの断面に発光スキャンラインを引く。
 */
const SLICES = 6;
const BURST_FRAMES = 5;

export const Glitch: React.FC<{
  intensity: number;
  interval: number; // 発作間隔(秒)
  rgbShift: number; // px
  children: React.ReactNode;
}> = ({ intensity, interval, rgbShift, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intervalFrames = Math.max(BURST_FRAMES + 4, Math.round(interval * fps));
  const cycle = Math.floor(frame / intervalFrames);
  const inCycle = frame % intervalFrames;
  // 発作の位置をサイクルごとに少し揺らす
  const burstStart = Math.floor(hashRand(cycle, 99) * (intervalFrames - BURST_FRAMES));
  const bursting = inCycle >= burstStart && inCycle < burstStart + BURST_FRAMES;

  if (!bursting) return <AbsoluteFill>{children}</AbsoluteFill>;

  const seed = cycle * 31 + (inCycle - burstStart);
  // 一撃→非線形減衰＋フレームごとの揺らぎ（等強度の発作にしない）
  const burstT = (inCycle - burstStart) / BURST_FRAMES; // 0 → 1
  const env = Math.pow(1 - burstT, 0.65) * (0.8 + 0.45 * hashRand(seed, 5));
  const slices = Array.from({ length: SLICES }, (_, i) => {
    const top = (i / SLICES) * 100;
    const height = 100 / SLICES;
    const dx = (hashRand(seed, i) - 0.5) * 2 * 60 * intensity * env;
    // 前後差: 一部のスライスは手前に浮く（わずかに拡大＋ボケ）
    const near = hashRand(cycle, 20 + i) < 0.3;
    return { top, height, dx, near };
  });
  // 最大ズレの断面＝発光スキャンラインを引く位置
  const tear = slices.reduce((a, b) => (Math.abs(b.dx) > Math.abs(a.dx) ? b : a));
  const tearAlpha = Math.min(0.85, (Math.abs(tear.dx) / 60) * 1.2) * env;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* RGB分離レイヤー: にじませて「光輪」にする（芯はスライス側が持つ） */}
      <AbsoluteFill
        style={{
          transform: `translate(${-rgbShift * intensity * env}px, ${-1.5 * env}px)`,
          filter: "saturate(3) hue-rotate(-50deg) blur(1.2px)",
          opacity: 0.5,
          mixBlendMode: "screen",
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `translate(${rgbShift * intensity * env}px, ${1.5 * env}px)`,
          filter: "saturate(3) hue-rotate(130deg) blur(1.2px)",
          opacity: 0.5,
          mixBlendMode: "screen",
        }}
      >
        {children}
      </AbsoluteFill>
      {/* スライスずれ本体（シャープな芯）。一部は手前に浮かせて前後差を出す */}
      {slices.map((s, i) => (
        <AbsoluteFill
          key={i}
          style={{
            clipPath: `inset(${s.top}% 0 ${100 - s.top - s.height}% 0)`,
            transform: s.near
              ? `translateX(${s.dx}px) scale(${1 + 0.012 * env})`
              : `translateX(${s.dx}px)`,
            filter: s.near ? "blur(0.8px) brightness(1.05)" : undefined,
          }}
        >
          {children}
        </AbsoluteFill>
      ))}
      {/* 最大断面の発光スキャンライン: シャープな芯＋ぼけた光輪の2層 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${tear.top + tear.height}%`,
          height: 14,
          transform: "translateY(-50%)",
          background: `linear-gradient(180deg, transparent, rgba(200,240,255,${tearAlpha * 0.5}), transparent)`,
          filter: "blur(6px)",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${tear.top + tear.height}%`,
          height: 1.5,
          background: `rgba(235,250,255,${tearAlpha})`,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      {/* 走査線ノイズ（発作の減衰に追従） */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(0deg, rgba(255,255,255,${0.06 * intensity * env}) 0 2px, transparent 2px 5px)`,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
