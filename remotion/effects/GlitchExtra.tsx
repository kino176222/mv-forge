import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { hashRand } from "./rand";

/**
 * グリッチの増種（既存: 発作型glitch / 常時RGBずれ / VHS）。
 * - GlitchBlocks: ブロックノイズ。矩形が周期的にズレて色化けする（デジタル崩壊・MPEG破損風）
 * - GlitchSmear : ピクセルサート風。柱状に像が縦へ溶けて伸びる（記憶の融解・データ漏れ）
 * - GlitchWave  : 走査波。横方向のうねりが上から下へ流れ続ける（電波の乱れ・水中）
 */

/** ブロックノイズ: interval秒ごとに数フレーム、矩形ブロックがズレて色化けする
 * 磨き: ズレは一撃→非線形減衰（フラッター付き）。単色ブロックは芯＋光輪の発光体に、
 * 映像ブロックは一部を手前に浮かせ（拡大＋ボケ）、ズレた縁に発光エッジを引く。 */
export const GlitchBlocks: React.FC<{
  intensity: number; // 0-1
  interval: number; // 発作間隔(s)
  blocks: number; // ブロック数
  children: React.ReactNode;
}> = ({ intensity, interval, blocks, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intervalFrames = Math.max(2, Math.round(interval * fps));
  const cycle = Math.floor(frame / intervalFrames);
  const burstFrames = Math.max(2, Math.round(0.16 * fps));
  const inBurst = frame % intervalFrames < burstFrames;
  // 一撃→easeOut減衰＋フレーム揺らぎ（等強度のON/OFFにしない）
  const burstT = (frame % intervalFrames) / burstFrames;
  const env = inBurst
    ? Math.pow(1 - burstT, 0.7) * (0.8 + 0.4 * hashRand(frame, 70))
    : 0;

  return (
    <AbsoluteFill>
      {children}
      {inBurst &&
        Array.from({ length: blocks }, (_, i) => {
          const x = hashRand(cycle * 31 + i, 71) * 88;
          const y = hashRand(cycle * 31 + i, 72) * 88;
          const w = 4 + hashRand(cycle * 31 + i, 73) * 22;
          const h = 2 + hashRand(cycle * 31 + i, 74) * 9;
          const dx = (hashRand(frame, 75 + i) - 0.5) * 90 * intensity * (0.4 + 0.6 * env);
          const hue = Math.round(hashRand(cycle, 76 + i) * 360);
          const solid = hashRand(cycle, 77 + i) < 0.25; // 一部は単色ブロック（破損感）
          const near = !solid && hashRand(cycle, 78 + i) < 0.35; // 手前に浮くブロック
          if (solid) {
            // 発光ブロック: 明るい芯＋boxShadowの光輪（screenで加算感）
            const a = 0.5 * intensity * (0.5 + 0.5 * env);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `calc(${x}% + ${dx}px)`,
                  top: `${y}%`,
                  width: `${w}%`,
                  height: `${h}%`,
                  background: `linear-gradient(90deg, hsla(${hue}, 90%, 55%, ${a}), hsla(${hue}, 95%, 72%, ${Math.min(1, a * 1.5)}), hsla(${hue}, 90%, 55%, ${a}))`,
                  boxShadow: `0 0 ${10 + 14 * env}px 2px hsla(${hue}, 95%, 65%, ${a * 0.7})`,
                  mixBlendMode: "screen",
                }}
              />
            );
          }
          return (
            <React.Fragment key={i}>
              <AbsoluteFill
                style={{
                  clipPath: `inset(${y}% ${100 - x - w}% ${100 - y - h}% ${x}%)`,
                  transform: near
                    ? `translateX(${dx}px) scale(${1 + 0.025 * env})`
                    : `translateX(${dx}px)`,
                  filter: near
                    ? `hue-rotate(${hue}deg) saturate(2.2) blur(1.2px) brightness(1.1)`
                    : `hue-rotate(${hue}deg) saturate(2.2)`,
                }}
              >
                {children}
              </AbsoluteFill>
              {/* ズレた縁の発光エッジ（芯）: ズレ方向の断面が光る */}
              <div
                style={{
                  position: "absolute",
                  left: `calc(${dx > 0 ? x + w : x}% + ${dx}px)`,
                  top: `${y}%`,
                  width: 1.5,
                  height: `${h}%`,
                  background: `hsla(${hue}, 80%, 80%, ${0.75 * env * intensity})`,
                  boxShadow: `0 0 6px 1px hsla(${hue}, 90%, 70%, ${0.4 * env * intensity})`,
                  mixBlendMode: "screen",
                  pointerEvents: "none",
                }}
              />
            </React.Fragment>
          );
        })}
    </AbsoluteFill>
  );
};

/** ピクセルサート風: 柱状に像が縦へ溶けて伸びる。refresh秒ごとに柱が生え変わる */
export const GlitchSmear: React.FC<{
  amount: number; // 柱の本数
  strength: number; // 伸び倍率
  refresh: number; // 生え変わり間隔(s)
  opacity?: number; // 柱の濃さ
  boost?: number; // 色化け（彩度ブースト）
  children: React.ReactNode;
}> = ({ amount, strength, refresh, opacity = 0.75, boost = 1.6, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cycleFrames = Math.max(2, Math.round(refresh * fps));
  const cycle = Math.floor(frame / cycleFrames);
  // 生え変わりの立ち上がり: サイクル頭の数フレームで柱がスッと伸びる（パッと切替の硬さを消す）
  const local = (frame - cycle * cycleFrames) / cycleFrames;
  const ease = 1 - Math.pow(1 - Math.min(1, local * 4), 3); // 先頭25%でeaseOutCubic

  return (
    <AbsoluteFill>
      {children}
      {Array.from({ length: amount }, (_, i) => {
        const x = hashRand(cycle * 17 + i, 81) * 92;
        const w = 1.2 + hashRand(cycle * 17 + i, 82) * 5;
        const anchor = hashRand(cycle * 17 + i, 83) * 55; // 溶け始めのY(%)
        const growMax = 1 + (strength - 1) * (0.4 + hashRand(cycle, 84 + i) * 0.6);
        const grow = 1 + (growMax - 1) * ease;
        return (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${anchor}% ${100 - x - w}% 0 ${x}%)`,
              transform: `scaleY(${grow})`,
              transformOrigin: `50% ${anchor}%`,
              opacity: opacity * (0.6 + 0.4 * ease),
              filter: `saturate(${boost}) brightness(${1 + 0.08 * boost})`,
            }}
          >
            {children}
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

/** 走査波: 横方向のうねりが上から下へ流れ続ける
 * 磨き: 等速の正弦流→速度フラッター＋振幅の呼吸。下の行ほど振幅を強く（手前＝近い水面）、
 * 手前の行はわずかにボケる。波头を追う発光バンド（芯＋光輪）で光の面を作る。 */
export const GlitchWave: React.FC<{
  amplitude: number; // px
  speed: number; // x
  wavelength: number; // 画面内の波の数
  children: React.ReactNode;
}> = ({ amplitude, speed, wavelength, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame / fps) * speed;
  // 速度フラッター（進みが揺れる）＋振幅の呼吸（強弱の波）
  const tWarp = t + 0.18 * Math.sin(t * 0.9) + 0.06 * Math.sin(t * 2.7);
  const breathe = 0.82 + 0.18 * Math.sin(t * 0.7 + 1.3);
  const rows = 18;

  // 波を追う発光バンド: 非等速で下へ流れ、波の腹で明るく、節で消える
  const glowY = (((t * 0.22 + 0.1 * Math.sin(t * 1.1)) % 1) + 1) % 1;
  const glowArg = glowY * wavelength * Math.PI * 2 - tWarp * 3.2;
  const glowA =
    Math.abs(Math.sin(glowArg)) * Math.min(1, amplitude / 28) * 0.3;

  return (
    <AbsoluteFill>
      {Array.from({ length: rows }, (_, i) => {
        const top = (i / rows) * 100;
        // 前後差: 下の行ほど手前＝振幅が大きい。位相もわずかに揺らす
        const depth = i / (rows - 1); // 0=奥(上) → 1=手前(下)
        const phaseJitter = (hashRand(i, 85) - 0.5) * 0.3;
        const dx =
          Math.sin((i / rows) * wavelength * Math.PI * 2 - tWarp * 3.2 + phaseJitter) *
          amplitude *
          breathe *
          (0.78 + 0.44 * depth);
        return (
          <AbsoluteFill
            key={i}
            style={{
              clipPath: `inset(${top}% 0 ${100 - top - 100 / rows}% 0)`,
              transform: `translateX(${dx}px)`,
              filter: depth > 0.82 ? "blur(0.7px)" : undefined,
            }}
          >
            {children}
          </AbsoluteFill>
        );
      })}
      {/* 発光バンド: ぼけた光輪＋シャープな芯 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${glowY * 100}%`,
          height: 18,
          transform: "translateY(-50%)",
          background: `linear-gradient(180deg, transparent, rgba(210,235,255,${glowA}), transparent)`,
          filter: "blur(7px)",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${glowY * 100}%`,
          height: 1.5,
          background: `rgba(230,245,255,${glowA * 1.6})`,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
