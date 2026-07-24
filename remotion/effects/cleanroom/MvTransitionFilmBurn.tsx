import React, { useId, useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * MvTransitionFilmBurn — フィルム焼けトランジション家族（クリーンルーム実装）
 *
 * 機能: 半秒前後の短尺で「フィルムが焼ける・溶ける・切り替わる」瞬間を再現する
 *       from→to トランジション。variant で家族内の 6 つの見た目に分岐する。
 *
 * 設計メモ:
 * - 破壊量は折れ線キーフレーム（区分線形）の三角エンベロープで駆動し、
 *   露出が最大になる頂点の陰で from→to を狭いディゾルブ窓で入れ替える。
 * - 穴あき型（mode 0）だけが空間ワイプ。中央から成長する円形マスクで to を露出し、
 *   縁に炎リング(screen)＋焦げリング(normal)を重ね、from ごと変位マップで歪ませる。
 * - 乱数はすべて (seed, frame, index) から決定的に生成。Math.random は使わない。
 * - 色の役割: 発光=暖白→橙(screen) / 焦げ=焦げ茶→黒(normal合成の帯) /
 *   全体調=セピア・琥珀(overlay + CSS sepia)。青系は使わない。
 * - CSS 合成の罠対策: グループ filter の isolation で multiply が破綻するため、
 *   焦げ・ビネットは「透明→焦げ色→透明」の帯を normal 合成で置く。
 * - 解像度非依存: 画面幅 ÷ 1920 の倍率 s を全ピクセル値に掛ける。
 */

export interface MvTransitionFilmBurnProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 方向（発火ラインのスイープ方向にのみ使用。省略時は下→上） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 家族内の見た目分岐（決定論的） */
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

// ---- 家族内の個体定義 -------------------------------------------------------
// 0: 穴あき焼け（円形ワイプ） / 1: 全面乳剤焼け / 2: 溶け落ち /
// 3: 発火フラッシュ / 4: 劣化崩壊 / 5: リール交換
type ModeConfig = {
  /** 破壊エンベロープの折れ線 */
  envX: number[];
  envY: number[];
  /** エンベロープに掛ける冪（1未満=持ち上げ / 1超=急峻化） */
  envPow: number;
  /** ディゾルブ窓の中心（頂点位置） */
  peak: number;
  /** ディゾルブ窓の半幅 */
  dissolveHalf: number;
  /** フラッシュ最大量 0..1 */
  flashMax: number;
  /** 微ズーム最大量 */
  zoom: number;
  /** 手ブレ振幅（画面幅比）と縦横バランス */
  shake: number;
  shakeYRatio: number;
  /** グレードの強さ */
  sepia: number;
  desat: number;
  brighten: number;
  blurPx: number; // 1920px 基準
  /** ダスト個数 */
  dustCount: number;
};

const MODES: ModeConfig[] = [
  // 0: ds-burn 系 — 穴あき。頂点は中央
  {
    envX: [0, 0.12, 0.5, 0.8, 1],
    envY: [0, 0.3, 1, 0.35, 0],
    envPow: 0.85,
    peak: 0.5,
    dissolveHalf: 0.15,
    flashMax: 0.5,
    zoom: 0.03,
    shake: 0.005,
    shakeYRatio: 0.7,
    sepia: 0.45,
    desat: 0.4,
    brighten: 0.35,
    blurPx: 3,
    dustCount: 10,
  },
  // 1: 全面乳剤焼け — 頂点は中央、ホットスポットが漂う
  {
    envX: [0, 0.14, 0.5, 0.82, 1],
    envY: [0, 0.4, 1, 0.4, 0],
    envPow: 0.9,
    peak: 0.5,
    dissolveHalf: 0.15,
    flashMax: 0.6,
    zoom: 0.04,
    shake: 0.006,
    shakeYRatio: 0.7,
    sepia: 0.55,
    desat: 0.5,
    brighten: 0.5,
    blurPx: 4,
    dustCount: 14,
  },
  // 2: 溶け落ち — 頂点は中央よりやや後。全面は焼き切らない
  {
    envX: [0, 0.2, 0.62, 0.85, 1],
    envY: [0, 0.3, 1, 0.45, 0],
    envPow: 1,
    peak: 0.62,
    dissolveHalf: 0.14,
    flashMax: 0.45,
    zoom: 0.05,
    shake: 0.005,
    shakeYRatio: 1.1,
    sepia: 0.5,
    desat: 0.45,
    brighten: 0.4,
    blurPx: 3.5,
    dustCount: 9,
  },
  // 3: 発火 — 頂点やや手前(4割強)。最も明るく単純
  {
    envX: [0, 0.18, 0.42, 0.7, 1],
    envY: [0, 0.3, 1, 0.25, 0],
    envPow: 1.3,
    peak: 0.42,
    dissolveHalf: 0.13,
    flashMax: 0.95,
    zoom: 0.06,
    shake: 0.007,
    shakeYRatio: 0.6,
    sepia: 0.25,
    desat: 0.3,
    brighten: 3.0,
    blurPx: 26,
    dustCount: 6,
  },
  // 4: 劣化崩壊 — 頂点が後ろ寄り。長いビルドアップ→短い解放
  {
    envX: [0, 0.45, 0.85, 0.94, 1],
    envY: [0, 0.18, 1, 0.5, 0],
    envPow: 1.8,
    peak: 0.85,
    dissolveHalf: 0.11,
    flashMax: 0.75,
    zoom: 0.1,
    shake: 0.006,
    shakeYRatio: 0.8,
    sepia: 0.4,
    desat: 0.65,
    brighten: 0.9,
    blurPx: 10,
    dustCount: 26,
  },
  // 5: リール交換 — 台形（プラトー付き）パルス。縦揺れ強め
  {
    envX: [0, 0.28, 0.4, 0.6, 0.72, 1],
    envY: [0, 0, 1, 1, 0, 0],
    envPow: 1,
    peak: 0.5,
    dissolveHalf: 0.09,
    flashMax: 0.6,
    zoom: 0.03,
    shake: 0.004,
    shakeYRatio: 2.2,
    sepia: 0.45,
    desat: 0.4,
    brighten: 0.45,
    blurPx: 3,
    dustCount: 12,
  },
];

export const MvTransitionFilmBurn: React.FC<MvTransitionFilmBurnProps> = ({
  from,
  to,
  durationInFrames,
  direction,
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const v = clamp01(variant);
  const mode = Math.min(5, Math.floor(v * 6));
  const cfg = MODES[mode];
  const seed = 11 + Math.floor(v * 97);
  const s = width / 1920; // 解像度倍率

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // ---- エンベロープ --------------------------------------------------------
  const envRaw = keyframes(p, cfg.envX, cfg.envY);
  const env = Math.pow(clamp01(envRaw), cfg.envPow);

  // ディゾルブ（頂点を挟む狭い窓での不透明度クロス）
  const toOpacity =
    mode === 0
      ? 1 // 穴あき型は空間ワイプで露出するため常時下に敷く
      : keyframes(p, [cfg.peak - cfg.dissolveHalf, cfg.peak + cfg.dissolveHalf], [0, 1]);

  // フラッシュ（頂点付近の狭い三角パルス。入替の隠れ蓑）
  const flash =
    cfg.flashMax *
    keyframes(p, [cfg.peak - 0.08, cfg.peak, cfg.peak + 0.14], [0, 1, 0]);

  // ---- 手ブレ（映像ステージのみに掛ける） -----------------------------------
  const shakeAmp = width * cfg.shake * env;
  const shakeX = (rand(seed, frame, 21) - 0.5) * 2 * shakeAmp;
  const shakeY = (rand(seed, frame, 22) - 0.5) * 2 * shakeAmp * cfg.shakeYRatio;
  const shakeRot = (rand(seed, frame, 23) - 0.5) * 0.4 * env;

  // ---- モード固有の動き ------------------------------------------------------
  // 溶け落ち（mode2）: 一度マイナスに沈んでから跳ね上がる
  const meltV =
    mode === 2
      ? keyframes(p, [0, 0.22, 0.45, 0.62, 0.82, 1], [0, -0.16, -0.04, 1, 0.3, 0])
      : 0;
  const meltShiftY = meltV * height * 0.045;
  const meltStretch = 1 + Math.max(0, meltV) * 0.05;

  // 発火（mode3）: 横方向の軽い押し出しドリフト
  const driftSign = direction === "right" ? 1 : -1;
  const igniteDrift =
    mode === 3 ? keyframes(p, [0, 1], [-1, 1]) * width * 0.015 * driftSign : 0;

  // ---- グレード（フィルム劣化） ---------------------------------------------
  // 明滅（乳剤焼けで顕著、他は控えめ）
  const flickerAmp = mode === 1 ? 0.35 : mode === 4 ? 0.2 : 0.08;
  const flicker = (rand(seed, frame, 31) - 0.5) * flickerAmp * env;
  const grade = [
    `sepia(${(cfg.sepia * env).toFixed(3)})`,
    `saturate(${(1 - cfg.desat * env).toFixed(3)})`,
    `contrast(${(1 + 0.22 * env).toFixed(3)})`,
    `brightness(${Math.max(0.1, 1 + cfg.brighten * env + flicker).toFixed(3)})`,
    `blur(${(cfg.blurPx * env * s).toFixed(2)}px)`,
  ].join(" ");

  const stageScale = (1 + cfg.zoom * env) * (mode === 2 ? meltStretch : 1);
  const stageTransform = [
    `translate(${(shakeX + igniteDrift).toFixed(1)}px, ${(shakeY + meltShiftY).toFixed(1)}px)`,
    `rotate(${shakeRot.toFixed(3)}deg)`,
    mode === 2
      ? `scale(${(1 + cfg.zoom * env).toFixed(4)}, ${stageScale.toFixed(4)})`
      : `scale(${stageScale.toFixed(4)})`,
  ].join(" ");

  // ---- 穴あき型（mode0）の円形マスクとリング --------------------------------
  const holeR = keyframes(p, [0.1, 0.88], [0, 105]); // %（グラデ箱基準）
  const holeFeather = 8;
  const holeOn = mode === 0 && p > 0.1;
  const dispScale = mode === 0 ? (14 + 46 * env) * s : 0;
  // to は最初ややボケ拡大 → 焼けるほどシャープに
  const toRevealBlur = mode === 0 ? keyframes(p, [0.1, 0.75], [9, 0]) * s : 0;
  const toRevealScale = mode === 0 ? keyframes(p, [0.1, 0.8], [1.06, 1]) : 1;

  // ---- ホットスポット位置 ----------------------------------------------------
  // 乳剤焼け: 正弦波で漂う / 溶け落ち: やや左上寄りに固定 / 穴あき: 中央
  const hotX =
    mode === 1 ? 42 + Math.sin(p * Math.PI * 2.2) * 13 : mode === 2 ? 38 : 50;
  const hotY =
    mode === 1 ? 44 + Math.sin(p * Math.PI * 1.7 + 1.3) * 10 : mode === 2 ? 34 : 50;
  const glowSize = mode === 2 ? 12 + 46 * env : 22 + 40 * env; // %
  const glowOpacity =
    (mode === 3 ? 0.9 : mode === 4 ? 0.35 : mode === 5 ? 0.3 : 0.85) * env;

  // ---- 焦げブロブ（乳剤焼け）。効果中3回ほど配置差し替え ----------------------
  const blobEpoch = Math.floor(p * 3);
  const blobs =
    mode === 1
      ? Array.from({ length: 4 }, (_, i) => ({
          x: 8 + rand(seed, blobEpoch, 40 + i) * 84,
          y: 6 + rand(seed, blobEpoch, 50 + i) * 88,
          r: 9 + rand(seed, blobEpoch, 60 + i) * 15, // %
          i,
        }))
      : [];

  // ---- ダスト・ヘア -----------------------------------------------------------
  // 乳剤焼けは3区間で再抽選、他は2フレームごとに瞬く
  const dustEpoch = mode === 1 ? blobEpoch : Math.floor(frame / 2);
  const dustVisibility = mode === 4 ? Math.pow(clamp01(p), 2) : env;
  const dusts = Array.from({ length: cfg.dustCount }, (_, i) => {
    const light = rand(seed + 1, dustEpoch, 70 + i) > 0.45;
    return {
      x: rand(seed, dustEpoch, 80 + i) * 98,
      y: rand(seed, dustEpoch, 90 + i) * 98,
      size: (1.5 + rand(seed, dustEpoch, 100 + i) * 4.5) * s,
      light,
      op: 0.25 + rand(seed + 2, dustEpoch, 110 + i) * 0.6,
      i,
    };
  });
  const hairOn = mode !== 3 && env > 0.18;
  const hairs = hairOn
    ? Array.from({ length: 3 }, (_, i) => ({
        x: rand(seed, dustEpoch, 130 + i) * 90 + 4,
        y: rand(seed, dustEpoch, 140 + i) * 80 + 5,
        len: 7 + rand(seed, dustEpoch, 150 + i) * 11, // %（高さ基準）
        rot: rand(seed, dustEpoch, 160 + i) * 180 - 90,
        bend: rand(seed, dustEpoch, 170 + i) > 0.5,
        i,
      }))
    : [];

  // ---- ライトリークのボケ玉（劣化崩壊） ---------------------------------------
  const bokehs =
    mode === 4
      ? Array.from({ length: 5 }, (_, i) => ({
          x: rand(seed, 3, 180 + i) * 86 + 4,
          y: rand(seed, 3, 190 + i) * 78 + 6,
          d: (10 + rand(seed, 3, 200 + i) * 16) / 100, // 画面幅比
          drift: (rand(seed, 3, 210 + i) - 0.5) * 8, // %
          i,
        }))
      : [];

  // ---- 発火ラインの横帯スイープ（mode3） -------------------------------------
  const sweepDown = direction === "down";
  const sweepTop = sweepDown
    ? keyframes(p, [0.06, 0.55], [-30, 100])
    : keyframes(p, [0.06, 0.55], [100, -30]);
  const sweepOpacity = mode === 3 ? keyframes(p, [0.05, 0.2, 0.55, 0.7], [0, 1, 1, 0]) : 0;

  // ---- キューマーク（リール交換） ---------------------------------------------
  const cueOpacity = mode === 5 ? keyframes(p, [0.3, 0.4, 0.6, 0.68], [0, 1, 1, 0]) : 0;
  const cueD = width * 0.075;

  // ---- 焦げビネット（multiply の代わりに normal 合成の帯） ---------------------
  const vignetteStrength =
    (mode === 3 ? 0 : mode === 4 ? 0.4 : mode === 5 ? 0.5 : 1) * env;

  const grainOpacity = (0.08 + 0.3 * env) * (mode === 3 ? 0.5 : 1);

  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      {/* フィルタ定義（変位マップ＋グレイン） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          {mode === 0 && (
            <filter
              id={`${uid}-disp`}
              x="-15%"
              y="-15%"
              width="130%"
              height="130%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.013 0.02"
                numOctaves={2}
                seed={frame * 3 + seed}
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={dispScale.toFixed(1)}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          )}
          <filter id={`${uid}-grain`} colorInterpolationFilters="sRGB">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={frame * 7 + seed}
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
      </svg>

      {/* 本編ステージ（グレード＋手ブレ＋微ズーム） */}
      <AbsoluteFill style={{ filter: grade, transform: stageTransform }}>
        {mode === 0 ? (
          <>
            {/* to: 下敷き。最初ややボケ拡大 → シャープに */}
            <AbsoluteFill
              style={{
                filter: toRevealBlur > 0.2 ? `blur(${toRevealBlur.toFixed(1)}px)` : undefined,
                transform: `scale(${toRevealScale.toFixed(4)})`,
              }}
            >
              {to}
            </AbsoluteFill>
            {/* from: 中央から成長する円形穴のマスク＋タービュランス変位 */}
            <AbsoluteFill
              style={{
                filter: `url(#${uid}-disp)`,
                WebkitMaskImage: holeOn
                  ? `radial-gradient(circle at 50% 50%, transparent ${holeR.toFixed(1)}%, #000 ${(holeR + holeFeather).toFixed(1)}%)`
                  : undefined,
                maskImage: holeOn
                  ? `radial-gradient(circle at 50% 50%, transparent ${holeR.toFixed(1)}%, #000 ${(holeR + holeFeather).toFixed(1)}%)`
                  : undefined,
              }}
            >
              {from}
            </AbsoluteFill>
          </>
        ) : (
          <>
            <AbsoluteFill>{from}</AbsoluteFill>
            {toOpacity > 0.001 && (
              <AbsoluteFill style={{ opacity: clamp01(toOpacity) }}>{to}</AbsoluteFill>
            )}
          </>
        )}
      </AbsoluteFill>

      {/* 焦げ黒ブロブ（乳剤焼け） */}
      {blobs.map((b) => (
        <div
          key={b.i}
          style={{
            position: "absolute",
            left: `${(b.x - b.r).toFixed(1)}%`,
            top: `${(b.y - b.r * 1.4).toFixed(1)}%`,
            width: `${(b.r * 2).toFixed(1)}%`,
            height: `${(b.r * 2.8).toFixed(1)}%`,
            background:
              "radial-gradient(ellipse at center, rgba(10,5,2,0.9) 0%, rgba(38,18,6,0.6) 45%, transparent 72%)",
            opacity: clamp01(env * 0.75),
          }}
        />
      ))}

      {/* 焦げビネット（縁を焦がす。normal 合成の放射帯） */}
      {vignetteStrength > 0.02 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, transparent 48%, rgba(64,30,10,${(0.5 * vignetteStrength).toFixed(3)}) 76%, rgba(10,4,2,${(0.92 * vignetteStrength).toFixed(3)}) 100%)`,
          }}
        />
      )}

      {/* 暖色発光のホットスポット（screen） */}
      {glowOpacity > 0.02 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${hotX.toFixed(1)}% ${hotY.toFixed(1)}%, rgba(255,242,216,0.95) 0%, rgba(255,158,66,0.75) ${(glowSize * 0.4).toFixed(1)}%, rgba(150,52,16,0.4) ${(glowSize * 0.75).toFixed(1)}%, transparent ${glowSize.toFixed(1)}%)`,
            mixBlendMode: "screen",
            opacity: clamp01(glowOpacity),
          }}
        />
      )}

      {/* 溶け落ちの白熱コア＋同心の焦げリング */}
      {mode === 2 && env > 0.03 && (
        <>
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at ${hotX}% ${hotY}%, rgba(255,250,238,1) 0%, rgba(255,214,150,0.9) ${(4 + 16 * env).toFixed(1)}%, transparent ${(9 + 26 * env).toFixed(1)}%)`,
              mixBlendMode: "screen",
              opacity: clamp01(env * 1.1),
            }}
          />
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at ${hotX}% ${hotY}%, transparent ${(7 + 22 * env).toFixed(1)}%, rgba(46,20,7,${(0.7 * env).toFixed(3)}) ${(11 + 27 * env).toFixed(1)}%, transparent ${(17 + 34 * env).toFixed(1)}%)`,
            }}
          />
        </>
      )}

      {/* 穴の縁: 炎リング(screen)＋焦げリング(normal) */}
      {holeOn && holeR < 100 && (
        <>
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at 50% 50%, transparent ${Math.max(0, holeR - 7).toFixed(1)}%, rgba(255,220,160,0.95) ${holeR.toFixed(1)}%, rgba(255,138,52,0.85) ${(holeR + 4).toFixed(1)}%, rgba(122,43,18,0.4) ${(holeR + 9).toFixed(1)}%, transparent ${(holeR + 13).toFixed(1)}%)`,
              mixBlendMode: "screen",
              opacity: clamp01(0.45 + env * 0.55),
            }}
          />
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at 50% 50%, transparent ${(holeR + 1).toFixed(1)}%, rgba(28,11,4,${(0.85 * clamp01(0.3 + env)).toFixed(3)}) ${(holeR + 5).toFixed(1)}%, transparent ${(holeR + 15).toFixed(1)}%)`,
            }}
          />
        </>
      )}

      {/* 発火ラインの横帯スイープ */}
      {sweepOpacity > 0.02 && (
        <div
          style={{
            position: "absolute",
            left: "-5%",
            width: "110%",
            top: `${sweepTop.toFixed(1)}%`,
            height: "26%",
            background:
              "linear-gradient(180deg, transparent 0%, rgba(255,190,110,0.85) 30%, rgba(255,244,226,1) 50%, rgba(255,190,110,0.85) 70%, transparent 100%)",
            mixBlendMode: "screen",
            filter: `blur(${(7 * s).toFixed(1)}px)`,
            opacity: clamp01(sweepOpacity * 0.9),
          }}
        />
      )}

      {/* ライトリークのボケ玉（劣化崩壊） */}
      {bokehs.map((b) => {
        const d = b.d * width;
        return (
          <div
            key={b.i}
            style={{
              position: "absolute",
              left: `calc(${b.x.toFixed(1)}% + ${(b.drift * env).toFixed(1)}%)`,
              top: `${b.y.toFixed(1)}%`,
              width: d,
              height: d,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 42% 40%, rgba(255,226,178,0.9) 0%, rgba(255,166,88,0.5) 45%, transparent 70%)",
              mixBlendMode: "screen",
              filter: `blur(${(5 * s).toFixed(1)}px)`,
              opacity: clamp01(dustVisibility * (0.5 + rand(seed, 5, 220 + b.i) * 0.5)),
            }}
          />
        );
      })}

      {/* キューマーク（リール交換。右上寄りの黒丸＋暖色ハロー） */}
      {cueOpacity > 0.02 && (
        <>
          <div
            style={{
              position: "absolute",
              left: "84%",
              top: "12%",
              width: cueD * 2.1,
              height: cueD * 2.1,
              marginLeft: -cueD * 0.55,
              marginTop: -cueD * 0.55,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,192,120,0.75) 0%, rgba(255,150,70,0.3) 45%, transparent 70%)",
              mixBlendMode: "screen",
              opacity: clamp01(cueOpacity * 0.9),
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "84%",
              top: "12%",
              width: cueD,
              height: cueD,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(12,7,3,0.95) 0%, rgba(12,7,3,0.95) 52%, rgba(34,17,7,0.75) 66%, transparent 80%)",
              opacity: clamp01(cueOpacity),
            }}
          />
        </>
      )}

      {/* 暖色グレード（overlay の琥珀ベタ） */}
      <AbsoluteFill
        style={{
          background: "#d98a3c",
          mixBlendMode: "overlay",
          opacity: clamp01(0.1 + 0.22 * env),
        }}
      />

      {/* グレイン（毎フレーム seed 差し替え） */}
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          mixBlendMode: "overlay",
          opacity: clamp01(grainOpacity),
        }}
        aria-hidden
      >
        <rect width="100%" height="100%" filter={`url(#${uid}-grain)`} />
      </svg>

      {/* ダスト（明色と暗色を混ぜて瞬く） */}
      {dustVisibility > 0.03 &&
        dusts.map((d) => (
          <div
            key={d.i}
            style={{
              position: "absolute",
              left: `${d.x.toFixed(1)}%`,
              top: `${d.y.toFixed(1)}%`,
              width: d.size,
              height: d.size,
              borderRadius: "50%",
              background: d.light ? "#f4e9d6" : "#241408",
              opacity: clamp01(d.op * dustVisibility),
            }}
          />
        ))}

      {/* ヘア（細い毛。数区間ごとに再抽選） */}
      {hairs.map((h) => (
        <div
          key={h.i}
          style={{
            position: "absolute",
            left: `${h.x.toFixed(1)}%`,
            top: `${h.y.toFixed(1)}%`,
            width: 1.6 * s,
            height: `${h.len.toFixed(1)}%`,
            background: "rgba(22,12,5,0.75)",
            borderRadius: h.bend ? "50% 50% 50% 50% / 100% 0% 100% 0%" : 2 * s,
            transform: `rotate(${h.rot.toFixed(1)}deg)`,
            opacity: clamp01(env * 0.8),
          }}
        />
      ))}

      {/* フラッシュ（暖白・screen・最上段。入替の隠れ蓑） */}
      {flash > 0.005 && (
        <AbsoluteFill
          style={{
            background: mode === 3 ? "#fff8ef" : "#ffedd2",
            mixBlendMode: "screen",
            opacity: clamp01(flash),
          }}
        />
      )}
    </AbsoluteFill>
  );
};
