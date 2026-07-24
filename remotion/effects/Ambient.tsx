import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { hashRand } from "./rand";
import { beatPulse, type BeatClock } from "./beat";

/**
 * 空気感オーバーレイ: 舞い散るパーティクル・玉ボケ・シネスコープ。
 * すべてシード済み乱数（hashRand）で決定論的＝レンダとプレビューで同じ画になる。
 */

/** パーティクル1粒の不変プロパティ（シードから決定論的に生成） */
function particleSeed(i: number) {
  return {
    x0: hashRand(i, 101) * 100, // 初期x（%）
    phase: hashRand(i, 102) * 100, // 落下フェーズ（%）
    swayPhase: hashRand(i, 103) * Math.PI * 2,
    swayAmp: 1.5 + hashRand(i, 104) * 3.5, // 横揺れ（%）
    scale: 0.55 + hashRand(i, 105) * 0.9,
    rot0: hashRand(i, 106) * 360,
    rotSpeed: (hashRand(i, 107) - 0.5) * 160, // deg/s
    speedMul: 0.7 + hashRand(i, 108) * 0.6,
    hueJitter: (hashRand(i, 109) - 0.5) * 24,
  };
}

/**
 * 舞い散るパーティクル（sakura=花びら / snow=雪 / dust=塵 / light=光の粒）。
 * J-MVの最頻出オーバーレイ。間奏の静止画感対策の一軍。
 */
export const Particles: React.FC<{
  type: string; // sakura | snow | dust | light
  count: number;
  size: number; // px（1080p基準）
  speed: number; // x
  beatSync?: boolean;
  beatClock?: BeatClock | null;
}> = ({ type, count, size, speed, beatSync, beatClock }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const px = (size * height) / 1080; // 解像度に追従
  // ビート同期: 拍で全体がフッと明るく瞬く（light向き）
  const twinkle =
    beatSync && beatClock ? 0.55 + beatPulse(beatClock, frame, fps) * 0.45 : 1;

  const falls = type !== "light"; // lightは浮遊（上昇気味）、他は落下
  const baseFallSec = type === "snow" ? 14 : type === "dust" ? 22 : 10; // 画面1周の秒数

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: count }, (_, i) => {
        const s = particleSeed(i);
        const cycle = (baseFallSec / (speed * s.speedMul)) || 10;
        const progress = ((t / cycle) * 100 + s.phase) % 112; // 0..112%（画面外から画面外へ）
        const y = falls ? progress - 6 : 106 - progress;
        // 桜専用: 奥行き(DOF)と、風で裏返るフラッター
        const isSakura = type === "sakura";
        const depth = hashRand(i, 120); // 0..1（1=カメラ手前 / 0=奥）
        const flPhase = t * (1.25 + s.swayAmp * 0.4) + s.swayPhase * 1.7;
        // 裏返り。真横で線状に潰れないよう最小幅28%をキープ（±で光を拾う）
        const flipRaw = Math.cos(flPhase);
        const flip = Math.sign(flipRaw) * (0.28 + 0.72 * Math.abs(flipRaw));
        const sway =
          Math.sin(t * (0.6 + s.swayAmp * 0.18) + s.swayPhase) * s.swayAmp;
        // 裏返る瞬間に横へスッと流れる（桜のみ）。単調な揺れを消す
        const drift = isSakura ? Math.sin(flPhase) * (0.8 + depth * 2.4) : 0;
        const x = ((s.x0 + sway + drift + 100) % 100);
        const rot = s.rot0 + t * s.rotSpeed;
        // 奥行きでサイズを変える（手前=大 / 奥=小）
        const depthScale = isSakura ? 0.5 + depth * 1.35 : 1;
        const d = px * s.scale * depthScale;

        let node: React.ReactNode;
        if (type === "sakura") {
          // DOF: フォーカス面(depth≈0.45)から離れるほどボケる。手前は玉ボケ的に強く
          const blurNorm =
            depth > 0.62
              ? (depth - 0.62) / 0.38
              : depth < 0.28
                ? ((0.28 - depth) / 0.28) * 0.55
                : 0;
          const blurPx = blurNorm * (0.6 + d * 0.12);
          // 裏返りの瞬間だけ白く艶めく（花びらが光を拾う）
          const lift = (1 - Math.abs(flip)) * 12;
          const hue = 344 + s.hueJitter;
          const gid = `sk${i}`;
          node = (
            <svg
              width={d}
              height={d}
              viewBox="0 0 100 100"
              style={{
                overflow: "visible",
                transform: `scaleX(${flip})`, // 風で裏返る立体感
                filter: `blur(${blurPx}px) drop-shadow(0 1px ${Math.max(1, d * 0.05)}px rgba(255,150,185,0.32))`,
                opacity: depth > 0.72 ? 0.62 : depth < 0.25 ? 0.78 : 0.96,
              }}
            >
              <defs>
                <linearGradient id={gid} x1="50%" y1="100%" x2="50%" y2="0%">
                  <stop offset="0%" stopColor={`hsl(${hue}, 72%, ${70 + lift}%)`} />
                  <stop offset="55%" stopColor={`hsl(${hue + 4}, 82%, ${82 + lift}%)`} />
                  <stop offset="100%" stopColor={`hsl(${hue + 8}, 88%, ${92 + lift * 0.5}%)`} />
                </linearGradient>
              </defs>
              {/* 先端に切れ込みを持つ桜の花びらシルエット */}
              <path
                d="M50 97 C79 88 97 62 90 35 C86 19 71 12 59 21 C54 25 53 25 50 19 C47 25 46 25 41 21 C29 12 14 19 10 35 C3 62 21 88 50 97 Z"
                fill={`url(#${gid})`}
              />
              {/* 中央の細い葉脈で花びららしさを補強 */}
              <path
                d="M50 90 C50 66 50 42 50 24"
                stroke={`hsla(${hue - 6}, 60%, 62%, 0.26)`}
                strokeWidth="1.4"
                fill="none"
              />
            </svg>
          );
        } else if (type === "snow") {
          node = (
            <div
              style={{
                width: d * 0.7,
                height: d * 0.7,
                background: "rgba(255,255,255,0.92)",
                borderRadius: "50%",
                filter: `blur(${Math.max(0.5, d * 0.08)}px)`,
              }}
            />
          );
        } else if (type === "dust") {
          node = (
            <div
              style={{
                width: d * 0.32,
                height: d * 0.32,
                background: "rgba(255,246,224,0.55)",
                borderRadius: "50%",
                filter: `blur(${Math.max(0.6, d * 0.06)}px)`,
              }}
            />
          );
        } else {
          // light: 柔らかく発光する粒。個々の明滅周期も持つ
          const blink =
            0.55 + 0.45 * Math.sin(t * (1.2 + s.swayAmp * 0.35) + s.swayPhase);
          node = (
            <div
              style={{
                width: d * 0.5,
                height: d * 0.5,
                background:
                  "radial-gradient(circle, rgba(255,244,204,0.95) 0%, rgba(255,222,150,0.35) 55%, transparent 75%)",
                borderRadius: "50%",
                opacity: blink * twinkle,
                filter: `blur(${Math.max(0.4, d * 0.04)}px)`,
              }}
            />
          );
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              transform: `rotate(${rot}deg)`,
              opacity: type === "light" ? 1 : twinkle,
            }}
          >
            {node}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** 玉ボケ: 前景をゆっくり漂う大きなソフト円。バラードの定番 */
export const BokehOrbs: React.FC<{
  count: number;
  size: number; // px（1080p基準）
  hue: number;
  intensity: number; // 0-1
}> = ({ count, size, hue, intensity }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const base = (size * height) / 1080;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: count }, (_, i) => {
        const s = particleSeed(i + 500);
        const d = base * (0.5 + s.scale * 0.8);
        const x = s.x0 + Math.sin(t * 0.11 * s.speedMul + s.swayPhase) * 8;
        const y =
          (s.phase % 100) + Math.cos(t * 0.09 * s.speedMul + s.swayPhase * 1.7) * 7;
        const blink = 0.65 + 0.35 * Math.sin(t * 0.5 + s.swayPhase * 2.3);
        const h = hue + s.hueJitter * 1.5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: d,
              height: d,
              marginLeft: -d / 2,
              marginTop: -d / 2,
              borderRadius: "50%",
              background: `radial-gradient(circle, hsla(${h}, 90%, 72%, ${0.5 * intensity}) 0%, hsla(${h}, 85%, 62%, ${0.28 * intensity}) 55%, transparent 72%)`,
              mixBlendMode: "screen",
              opacity: blink,
              filter: `blur(${d * 0.05}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * シネスコープ: 黒帯レターボックス＋ビネット＋ゲートウィーブ（フィルムの微妙な縦揺れ）。
 * ラッパー型: 中身（オーバーレイ含む）ごと帯の内側に収める。
 */
export const Cinescope: React.FC<{
  ratio: number; // 2.35 | 1.85
  vignette: number; // 0-1
  weave: number; // 0-1
  children: React.ReactNode;
}> = ({ ratio, vignette, weave, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const contentH = width / ratio;
  const bar = Math.max(0, (height - contentH) / 2);
  // 帯の入場: 冒頭0.6秒で上下からease-outで閉まる（静止画のべた貼り感を消す）
  const intro = interpolate(frame, [0, Math.round(fps * 0.6)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const barH = bar * intro;
  // 帯の内側エッジ: 数pxの微グラデでカミソリ縁の硬さだけを消す（主張しない）
  const edgeH = Math.max(2, bar * 0.09);
  // ゲートウィーブ: 低周波の縦ゆらぎ＋ごく稀なコマ飛び
  const wy =
    weave > 0
      ? (Math.sin(t * 1.3) * 0.55 + Math.sin(t * 3.7 + 1.4) * 0.45) *
        weave *
        (height / 1080) *
        3
      : 0;

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `translateY(${wy}px)` }}>
        {children}
      </AbsoluteFill>
      {vignette > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,${0.55 * vignette}) 100%)`,
            pointerEvents: "none",
          }}
        />
      )}
      {barH > 0.5 && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: barH,
              background: "#000",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: barH,
              left: 0,
              right: 0,
              height: edgeH,
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: barH,
              background: "#000",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: barH,
              left: 0,
              right: 0,
              height: edgeH,
              background:
                "linear-gradient(to top, rgba(0,0,0,0.5), transparent)",
            }}
          />
        </>
      )}
    </AbsoluteFill>
  );
};
