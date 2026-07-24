import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { hashRand } from "./rand";
import { beatPulse, type BeatClock } from "./beat";
import { shakeOffset } from "./shake-math";

/**
 * 絵そのものを変形させる「ラッパー型」オーバーレイたち。
 * cameraと重ねがけできる（例: パンチズーム＋画面揺れ）。
 */

/** 画面揺れ: 手持ちカメラの微振動〜地震級（shake）／ゆっくり漂う手ブレ（drift） */
export const Shake: React.FC<{
  intensity: number; // px
  speed: number;
  mode?: string; // "shake"（既定）| "drift"
  beatSync?: boolean;
  beatClock?: BeatClock | null;
  children: React.ReactNode;
}> = ({ intensity, speed, mode = "shake", beatSync, beatClock, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // ビート同期時: 拍の瞬間に揺れが跳ねて減衰する（常時揺れ→鼓動に変わる）
  const pulse = beatSync ? beatPulse(beatClock, frame, fps) : 1;
  const { dx, dy, rot, scale } = shakeOffset({ mode, frame, fps, speed, intensity, pulse });
  return (
    <AbsoluteFill
      style={{ transform: `scale(${scale}) translate(${dx}px, ${dy}px) rotate(${rot}deg)` }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** 色収差: 赤と青が常にわずかにズレ続ける */
export const GlitchRGB: React.FC<{
  shift: number; // px
  wobble: number; // 0-1
  children: React.ReactNode;
}> = ({ shift, wobble, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const w = 1 + Math.sin(t * 2.3) * wobble * 0.6 + Math.sin(t * 7.1) * wobble * 0.4;
  const s = shift * w;
  return (
    <AbsoluteFill>
      {children}
      <AbsoluteFill
        style={{
          transform: `translateX(${-s}px)`,
          filter: "saturate(2.5) hue-rotate(-60deg)",
          opacity: 0.35,
          mixBlendMode: "screen",
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `translateX(${s}px)`,
          filter: "saturate(2.5) hue-rotate(140deg)",
          opacity: 0.35,
          mixBlendMode: "screen",
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** VHSノイズ: 走査線＋トラッキング乱れ＋色にじみ
 * 磨き: 帯は等速の点滅ではなく、下へ流れながら非線形に減衰（フラッター付き）。
 * 帯の縁に発光ライン（芯＋光輪）、走査線はピッチ違いの2層でゆっくりロールし奥行きを出す。 */
export const GlitchVHS: React.FC<{
  intensity: number; // 0-1
  jitter: number; // 0-1
  children: React.ReactNode;
}> = ({ intensity, jitter, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  // トラッキング乱れ: たまに数フレーム、横に流れる帯が出る
  const cycle = Math.floor(frame / 45);
  const inCycle = frame % 45;
  const burst = hashRand(cycle, 7) < jitter && inCycle < 6;
  const burstT = inCycle / 6; // 0 → 1
  // 一撃→easeOut減衰＋フレーム揺らぎ。帯は減衰しつつ下へ流れる（テープの引っかかり感）
  const env = burst ? Math.pow(1 - burstT, 0.7) * (0.75 + 0.5 * hashRand(frame, 6)) : 0;
  const bandY = hashRand(cycle, 8) * 74 + 10 + burstT * burstT * 9; // % 加速しながら下へ
  const rowShift = burst ? (hashRand(frame, 9) - 0.5) * 40 * intensity * (0.5 + env) : 0;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill
        style={{
          transform: `translateX(${rowShift * 0.2}px)`,
          filter: `saturate(${1 - intensity * 0.35}) contrast(${1 + intensity * 0.12}) blur(${intensity * 0.6}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
      {/* 色にじみ（下方向に赤ずれ）: にじみ＝光輪としてぼかす。本体が芯を持つ */}
      <AbsoluteFill
        style={{
          transform: `translateY(${1.5 * intensity}px)`,
          filter: "saturate(3) hue-rotate(-40deg) blur(1.4px)",
          opacity: 0.18 * intensity,
          mixBlendMode: "screen",
        }}
      >
        {children}
      </AbsoluteFill>
      {/* トラッキング乱れの帯（減衰に追従して明るさも落ちる） */}
      {burst && (
        <>
          <AbsoluteFill
            style={{
              clipPath: `inset(${bandY}% 0 ${Math.max(0, 100 - bandY - 4)}% 0)`,
              transform: `translateX(${rowShift}px)`,
              filter: `brightness(${1 + 0.35 * env}) saturate(${1 + 0.4 * env})`,
            }}
          >
            {children}
          </AbsoluteFill>
          {/* 帯の縁の発光: ぼけた光輪＋シャープな芯の2層 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${bandY}%`,
              height: 12,
              transform: "translateY(-50%)",
              background: `linear-gradient(180deg, transparent, rgba(220,240,255,${0.35 * env * intensity}), transparent)`,
              filter: "blur(5px)",
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${bandY}%`,
              height: 1.5,
              background: `rgba(235,248,255,${0.7 * env * intensity})`,
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
        </>
      )}
      {/* 走査線（細・静止＝奥の面） */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(0deg, rgba(0,0,0,${0.14 * intensity}) 0 2px, transparent 2px 4px)`,
          pointerEvents: "none",
        }}
      />
      {/* 走査線（粗・ゆっくり非等速ロール＝手前の面。ピッチ差で奥行きが出る） */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(0deg, rgba(0,0,0,${0.05 * intensity}) 0 5px, transparent 5px 11px)`,
          transform: `translateY(${((t * 8 + Math.sin(t * 1.7) * 4) % 11).toFixed(2)}px)`,
          pointerEvents: "none",
        }}
      />
      {/* 上下の暗いビネット（ブラウン管っぽさ） */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${0.25 * intensity}) 0%, transparent 8%, transparent 92%, rgba(0,0,0,${0.25 * intensity}) 100%)`,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
