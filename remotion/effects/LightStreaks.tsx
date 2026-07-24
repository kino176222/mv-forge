import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { hashRand } from "./rand";

/**
 * 流れる光影: 光の帯と影の帯が画面を流れる。
 * ネオン・高架下・夜のドライブの疾走感。作風の主役級。
 * 磨き: 等速往復→速度フラッター、blur一発→芯＋光輪の2層、
 *       手前1層の大ボケ帯＋光の粒で前後差（奥行き）を作る。
 */
const BAR_COUNT = 7;
const SPECK_COUNT = 5;
const TWO_PI = Math.PI * 2;

export const LightStreaks: React.FC<{
  speed: number;
  intensity: number;
  angle: number;
}> = ({ speed, intensity, angle }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = (frame / fps) * speed;

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const w = 8 + hashRand(i, 1) * 22; // 帯の幅(%)
    const cycle = 2.2 + hashRand(i, 2) * 3.5; // 1往復の秒数
    const phase = hashRand(i, 3);
    const progress = ((t / cycle + phase) % 1 + 1) % 1;
    // 速度フラッター: 等速ではなく、進行に応じて波打つ（p=0/1で連続な形）
    const flutter = 0.03 * Math.sin(TWO_PI * (progress * 2 + hashRand(i, 6)));
    const x = -40 + (progress + flutter) * 180; // -40% → 140%
    const isShadow = i % 3 === 2;
    const isNear = i === 4; // 手前の1本: 大きくボケて速く感じる近景
    // 明滅の揺らぎ（光が呼吸する）
    const shimmer = 0.85 + 0.15 * Math.sin(TWO_PI * (t / (cycle * 0.6) + hashRand(i, 7)));
    const alpha =
      (isShadow ? 0.5 : 0.85) * intensity * (0.5 + hashRand(i, 4) * 0.5) * shimmer;
    const color = isShadow
      ? `rgba(0,0,10,${alpha})`
      : `rgba(255,245,220,${alpha})`;
    const halo = isShadow ? 30 : 45 + hashRand(i, 5) * 40;
    return { w, x, color, alpha, isShadow, isNear, halo };
  });

  // 光の粒: 帯と同じ向きに流れる数個のグロー粒。帯より速い/遅いで前後差を出す
  const specks = Array.from({ length: SPECK_COUNT }, (_, i) => {
    const cycle = 1.6 + hashRand(i, 11) * 2.6;
    const phase = hashRand(i, 12);
    const progress = ((t / cycle + phase) % 1 + 1) % 1;
    const flutter = 0.04 * Math.sin(TWO_PI * (progress * 3 + hashRand(i, 13)));
    const x = -10 + (progress + flutter) * 120; // %
    const y = 12 + hashRand(i, 14) * 76; // %
    const near = hashRand(i, 15) > 0.6; // 手前の粒は大きくボケる
    const size = near ? 14 + hashRand(i, 16) * 10 : 4 + hashRand(i, 16) * 5;
    const twinkle = 0.7 + 0.3 * Math.sin(TWO_PI * (t / 0.9 + hashRand(i, 17)));
    const alpha = (near ? 0.28 : 0.55) * intensity * twinkle;
    return { x, y, size, near, alpha };
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: `-${width * 0.2}px`,
          transform: `rotate(${angle}deg)`,
        }}
      >
        {bars.map((b, i) => {
          if (b.isShadow) {
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${b.x}%`,
                  width: `${b.w}%`,
                  background: `linear-gradient(90deg, transparent, ${b.color}, transparent)`,
                  filter: `blur(${b.halo}px)`,
                  mixBlendMode: "multiply",
                }}
              />
            );
          }
          // 光の帯: 大ボケの光輪（halo）＋シャープ寄りの芯（core）の2層加算
          const nearScale = b.isNear ? 1.9 : 1;
          const coreAlpha = Math.min(1, b.alpha * (b.isNear ? 0.5 : 1.15));
          return (
            <React.Fragment key={i}>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${b.x - (b.w * (nearScale - 1)) / 2}%`,
                  width: `${b.w * nearScale}%`,
                  background: `linear-gradient(90deg, transparent, ${b.color}, transparent)`,
                  filter: `blur(${b.halo * nearScale}px)`,
                  mixBlendMode: "screen",
                  opacity: b.isNear ? 0.75 : 1,
                }}
              />
              {!b.isNear && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${b.x + b.w * 0.36}%`,
                    width: `${b.w * 0.28}%`,
                    background: `linear-gradient(90deg, transparent, rgba(255,252,240,${coreAlpha}), transparent)`,
                    filter: "blur(9px)",
                    mixBlendMode: "screen",
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
        {specks.map((s, i) => (
          <div
            key={`sp${i}`}
            style={{
              position: "absolute",
              top: `${s.y}%`,
              left: `${s.x}%`,
              width: s.size,
              height: s.size,
              borderRadius: "50%",
              background: `rgba(255,248,228,${s.alpha})`,
              boxShadow: `0 0 ${s.size * 1.6}px ${s.size * 0.5}px rgba(255,240,210,${s.alpha * 0.6})`,
              filter: s.near ? `blur(${s.size * 0.45}px)` : "blur(1px)",
              mixBlendMode: "screen",
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
