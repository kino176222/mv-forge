import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionDoubleExposure — 多重露光トランジション（クリーンルーム実装）
 *
 * 機能: 旧カット→新カットを「フィルム二重露光」で切り替える。中央で両クリップが
 *       screen 合成のまま重なり、その瞬間だけ脱色・高コントラスト・露出オーバーになり、
 *       暖色ライトリークと白フラッシュが焼き付く。両端は素のクリップ。
 *
 * 設計メモ:
 * - 背骨は「端は無加工、中央が処理ピーク」の三角エンベロープ（イージングなしの直線山）。
 *   脱色量・コントラスト・リーク不透明度・露出スパイクはすべてこれに比例。
 * - 重ね焼き = 両クリップ間 / リーク / フラッシュの全部を screen 合成で積む。
 * - クロスフェードは中央ピボット周りの4割強の窓。旧の消え始めより新の出現を
 *   1割弱遅らせた非対称で、機械的な切り替わりを避ける。
 * - ライトリークは暖色の放射グラデ2つ＋横に間延びした低周波フラクタルノイズを
 *   暖色化した膜。層ごと毎フレーム横スライド（フレーム駆動・決定論的）。
 *   層は画面より2割はみ出させ、スライドで端が見切れない。
 * - 手ブレは進行の中間帯だけ台形で立ち上げる微振動。ハッシュ乱数で決定論的。
 * - ブラーは使わない。柔らかさはグラデとノイズのみ。乱数に Math.random は不使用。
 * - 解像度非依存: 振幅・流速は画面幅 ÷ 1920 の倍率でスケール。
 */

export interface MvTransitionDoubleExposureProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** リークが流れる向き（left/backward=左流し、それ以外=右流し。省略時は左） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 見た目の揺らぎ（リーク位置・流速・振動シードを決定論的に分岐） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数を返す */
const rand = (a: number, b: number, c: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
  return s - Math.floor(s);
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** interpolate の入力レンジを厳密単調増加に矯正する保険 */
const monotonic = (points: number[]): number[] => {
  const out = points.slice();
  for (let i = 1; i < out.length; i++) {
    out[i] = Math.max(out[i], out[i - 1] + 1e-5);
  }
  return out;
};

/** 折れ線キーフレーム（クランプ付き） */
const keyframes = (p: number, xs: number[], ys: number[]): number =>
  interpolate(p, monotonic(xs), ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const MvTransitionDoubleExposure: React.FC<MvTransitionDoubleExposureProps> = ({
  from,
  to,
  durationInFrames,
  direction,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const seed = 13 + Math.floor(v * 89);
  const s = width / 1920; // 解像度倍率

  // 尺1フレームのガード: ゼロ除算を避けつつ最終状態（to）で確定させる
  const p = durationInFrames <= 1 ? 1 : clamp01(frame / (durationInFrames - 1));

  // ---- 効果エンベロープ（直線の三角波: 0 → 頂点1(p=0.5) → 0） -----------------
  const env = keyframes(p, [0, 0.5, 1], [0, 1, 0]);

  // ---- クロスフェード（中央ピボット・幅4割強・非対称ずらし1割弱） -------------
  const fromOpacity = keyframes(p, [0.3, 0.66], [1, 0]);
  const toOpacity = keyframes(p, [0.38, 0.74], [0, 1]);

  // ---- 露出スパイク（中央で明度約1.5倍。同じ値を白フラッシュにも流用） ---------
  const spike = env;
  const flashOpacity = clamp01(0.7 * spike);

  // ---- グレード（脱色・高コントラスト・露出。銀塩フィルムの質感） -------------
  const grade = [
    `saturate(${(1 - 0.87 * env).toFixed(3)})`,
    `contrast(${(1 + 0.6 * env).toFixed(3)})`,
    `brightness(${(1 + 0.5 * spike).toFixed(3)})`,
  ].join(" ");

  // ---- 手ブレ（中間帯のみ・台形立ち上げ・数px級の微振動） ---------------------
  const shakeBand = keyframes(p, [0.32, 0.42, 0.58, 0.68], [0, 1, 1, 0]);
  const shakeAmp = 3.5 * s * shakeBand;
  const shakeX = (rand(seed, frame, 41) - 0.5) * 2 * shakeAmp;
  const shakeY = (rand(seed, frame, 42) - 0.5) * 2 * shakeAmp;

  // ---- ライトリークの流れ（フレーム駆動の横スライド） -------------------------
  const dirSign = direction === "right" || direction === "forward" ? 1 : -1;
  const slideSpeed = 0.04 + v * 0.03; // 全尺で画面幅の4〜7%を流れる
  const leakShift = (p - 0.5) * width * slideSpeed * dirSign;
  const leakOpacity = clamp01(0.55 * env);

  // リーク楕円の配置（variant で決定論的に揺らす）
  const jx = (rand(seed, 1, 7) - 0.5) * 12;
  const jy = (rand(seed, 2, 7) - 0.5) * 10;
  const warmX = 30 + jx; // 左寄り・大きめのアプリコット
  const warmY = 46 + jy;
  const creamX = 74 - jx * 0.6; // 右寄り・やや小さいクリーム
  const creamY = 36 - jy * 0.5;

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* ノイズ膜のフィルタ定義（横に間延びした低周波を暖色化。アルファは輝度から） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter id={`${uid}-leaknoise`} colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0045 0.013"
              numOctaves={2}
              seed={seed}
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1  0 0 0 0 0.6  0 0 0 0 0.25  0.45 0.35 0.2 0 0"
            />
          </filter>
        </defs>
      </svg>

      {/* 本編ステージ（手ブレ＋グレード。2クリップをまとめて揺らす） */}
      <AbsoluteFill
        style={{
          filter: grade,
          transform: `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)`,
        }}
      >
        {/* 旧カット: 通常描画 */}
        {fromOpacity > 0.001 && (
          <AbsoluteFill style={{ opacity: clamp01(fromOpacity) }}>{from}</AbsoluteFill>
        )}
        {/* 新カット: screen で上に重ね焼き。明部同士が足し合わさる */}
        {toOpacity > 0.001 && (
          <AbsoluteFill
            style={{
              opacity: clamp01(toOpacity),
              mixBlendMode: fromOpacity > 0.001 ? "screen" : "normal",
            }}
          >
            {to}
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 暖色ライトリーク層（screen・揺れない・画面より2割はみ出し＋横スライド） */}
      {leakOpacity > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: "-10%",
            top: "-10%",
            width: "120%",
            height: "120%",
            mixBlendMode: "screen",
            opacity: leakOpacity,
            transform: `translateX(${leakShift.toFixed(1)}px)`,
          }}
        >
          {/* 左寄りの大きな楕円（明るいアプリコット→透明） */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse 52% 42% at ${warmX.toFixed(1)}% ${warmY.toFixed(1)}%, rgba(255,199,132,0.95) 0%, rgba(255,148,58,0.55) 42%, rgba(206,92,26,0.22) 66%, transparent 82%)`,
            }}
          />
          {/* 右寄りのやや小さい楕円（クリーム→透明） */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse 38% 30% at ${creamX.toFixed(1)}% ${creamY.toFixed(1)}%, rgba(255,241,212,0.9) 0%, rgba(255,214,150,0.45) 48%, transparent 78%)`,
            }}
          />
          {/* 暖色ノイズの膜（光漏れの有機的なムラ） */}
          <svg
            width="100%"
            height="100%"
            style={{ position: "absolute", inset: 0, opacity: 0.35 }}
            aria-hidden
          >
            <rect width="100%" height="100%" filter={`url(#${uid}-leaknoise)`} />
          </svg>
        </div>
      )}

      {/* 白フラッシュ（screen・頂点の一瞬だけ露出が飛ぶ） */}
      {flashOpacity > 0.01 && (
        <AbsoluteFill
          style={{
            background: "#ffffff",
            mixBlendMode: "screen",
            opacity: flashOpacity,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
