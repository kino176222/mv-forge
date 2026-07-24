import React, { useId, useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * MvTransitionBulge — 球面バルジ膨張トランジション（クリーンルーム実装）
 *
 * 機能: 旧カットが中心から膨張しつつ指定方向へ吹き飛び、ブラー・色収差・
 *       光漏れが最大化した目くらましの下で新カットへ差し替わる約1秒のMV用トランジション。
 * 進行: 前半=旧カットのズーム膨張＋方向ドリフト立ち上がり →
 *       中盤=カオスの頂点（ブラー/色収差/光/グレイン/微振動が同時ピーク）で
 *       短いクロスフェード差し替え →
 *       後半=新カットが反対側から拡大＆ブラー状態で入り、等倍シャープへ収束。
 *       全エンベロープは全長の96%でゼロへ戻り、最終フレームはクリーンな to。
 *
 * 設計メモ:
 * - 乱数はすべて (seed, frame, index) の決定的ハッシュ。Math.random 不使用。
 * - 緩急はイージング関数ではなくキーフレーム折れ線（三角波＋頂点プラトーの台形）。
 *   方向ブラーの頂点は差し替え点より少し遅く（全長の6割弱）ずらす。
 * - 色収差: feColorMatrix で R/G/B を単チャンネル抽出し、R と B を運動軸に沿って
 *   逆向きに feOffset → screen 合成で再構成。整列部は元の色に戻る。
 * - バルジは方向ごとに3方式:
 *   (a) left  = 拡大複製＋中心の放射グラデマスク重ね
 *   (b) right/up/forward/backward = 中心原点のスケールサージ
 *   (c) down  = feImage(データURIの勾配マップ) + feDisplacementMap の本物の変位
 * - from/to でフィルタを2本別々に持ち、「去る側は差し替えへ向けボケ増、
 *   来る側は差し替え後に晴れる」を独立制御する。
 * - グレインは feTurbulence(fractalNoise) を彩度ゼロ化して overlay。
 *   seed を毎フレーム更新してざらつきを動かす。
 * - テキスト・フォント・外部素材は一切使わない。
 */

export interface MvTransitionBulgeProps {
  /** 旧カット */
  from: React.ReactNode;
  /** 新カット */
  to: React.ReactNode;
  /** トランジション全体の長さ（フレーム） */
  durationInFrames: number;
  /** 吹き飛ぶ方向（forward/backward はドリフトなしの純バルジ） */
  direction?: "left" | "right" | "up" | "down" | "forward" | "backward";
  /** 0..1 同家族内の見た目分岐（決定論的） */
  variant?: number;
}

/** (a,b,c) から 0..1 の決定的な擬似乱数（GLSL の定番ハッシュ） */
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

/** キーフレーム折れ線の直線補間（両端 clamp） */
const poly = (p: number, xs: number[], ys: number[]): number =>
  interpolate(p, monotonic(xs), ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

type DirKey = NonNullable<MvTransitionBulgeProps["direction"]>;

type DirCfg = {
  /** from がドリフトする方向（画面比の単位ベクトル） */
  vec: [number, number];
  /** 方向ブラーの優勢軸。iso は等方（forward/backward） */
  blurAxis: "x" | "y" | "iso";
  /** 色収差のずらし軸 */
  rgbAxis: "x" | "y";
  /** from のズーム頂点（backward のみ 1 未満で引き） */
  fromPeak: number;
  /** to の入り時スケール */
  toStart: number;
  /** 等方ブラーの脈動（left/right） */
  pulse: boolean;
  /** 拡大複製＋放射マスクのバルジ（left） */
  maskBulge: boolean;
  /** feDisplacementMap の球面変位（down） */
  displace: boolean;
  /** 縦スメア = scaleY の追加伸ばし（up） */
  smearY: boolean;
  /** 恒常の薄い横ブラー（left, 1920px 基準 px） */
  baseBlurX: number;
  /** クロスフェード幅（全長比。right が家族内最広） */
  crossW: number;
  /** 中盤の露光: 正=持ち上げ(left) / 負=沈め(up) */
  exposure: number;
  /** マゼンタ全面キャスト＋スキャンライン（down） */
  cast: boolean;
  /** 光ものパレット */
  lights: string;
};

const DIR_CONFIG: Record<DirKey, DirCfg> = {
  left: {
    vec: [-1, 0],
    blurAxis: "x",
    rgbAxis: "x",
    fromPeak: 1.34,
    toStart: 1.28,
    pulse: true,
    maskBulge: true,
    displace: false,
    smearY: false,
    baseBlurX: 3,
    crossW: 0.14,
    exposure: 0.12,
    cast: false,
    // 緑〜シアンの光条＋左下の暖色フィルム焼け
    lights: [
      "radial-gradient(ellipse 55% 16% at 62% 46%, rgba(140,255,210,0.55), rgba(140,255,210,0) 72%)",
      "radial-gradient(ellipse 70% 10% at 32% 60%, rgba(90,230,255,0.42), rgba(90,230,255,0) 72%)",
      "radial-gradient(ellipse 45% 55% at 4% 82%, rgba(255,150,70,0.5), rgba(255,150,70,0) 72%)",
    ].join(", "),
  },
  right: {
    vec: [1, 0],
    blurAxis: "x",
    rgbAxis: "x",
    fromPeak: 1.4,
    toStart: 1.3,
    pulse: true,
    maskBulge: false,
    displace: false,
    smearY: false,
    baseBlurX: 0,
    crossW: 0.2,
    exposure: 0,
    cast: false,
    // ピンクの光漏れ＋白グロー
    lights: [
      "radial-gradient(ellipse 60% 45% at 78% 40%, rgba(255,120,190,0.58), rgba(255,120,190,0) 72%)",
      "radial-gradient(ellipse 40% 30% at 58% 56%, rgba(255,255,255,0.5), rgba(255,255,255,0) 70%)",
      "radial-gradient(ellipse 50% 35% at 88% 80%, rgba(150,160,255,0.32), rgba(150,160,255,0) 72%)",
    ].join(", "),
  },
  up: {
    vec: [0, -1],
    blurAxis: "y",
    rgbAxis: "y", // 唯一 RGB ズレが運動軸（縦）方向
    fromPeak: 1.46,
    toStart: 1.3,
    pulse: false,
    maskBulge: false,
    displace: false,
    smearY: true,
    baseBlurX: 0,
    crossW: 0.14,
    exposure: -0.1,
    cast: false,
    // 青白い縦の光条のみ（ピンクなし）
    lights: [
      "radial-gradient(ellipse 9% 75% at 68% 45%, rgba(190,215,255,0.55), rgba(190,215,255,0) 72%)",
      "radial-gradient(ellipse 6% 60% at 30% 50%, rgba(232,240,255,0.42), rgba(232,240,255,0) 72%)",
      "radial-gradient(ellipse 12% 85% at 87% 55%, rgba(160,255,225,0.3), rgba(160,255,225,0) 72%)",
    ].join(", "),
  },
  down: {
    vec: [0, 1],
    blurAxis: "y",
    rgbAxis: "x", // 縦運動なのに水平ずらし
    fromPeak: 1.62, // 家族中最大の膨張
    toStart: 1.32,
    pulse: false,
    maskBulge: false,
    displace: true,
    smearY: false,
    baseBlurX: 0,
    crossW: 0.15,
    exposure: 0,
    cast: true,
    // ピンク光漏れ最強
    lights: [
      "radial-gradient(ellipse 80% 60% at 55% 45%, rgba(255,80,170,0.62), rgba(255,80,170,0) 76%)",
      "radial-gradient(ellipse 45% 35% at 42% 30%, rgba(255,255,255,0.42), rgba(255,255,255,0) 70%)",
      "radial-gradient(ellipse 60% 45% at 15% 70%, rgba(200,80,255,0.38), rgba(200,80,255,0) 74%)",
    ].join(", "),
  },
  forward: {
    vec: [0, 0],
    blurAxis: "iso",
    rgbAxis: "x",
    fromPeak: 1.7, // 手前へ突っ込む純バルジ
    toStart: 1.26,
    pulse: false,
    maskBulge: false,
    displace: false,
    smearY: false,
    baseBlurX: 0,
    crossW: 0.14,
    exposure: 0.08,
    cast: false,
    lights: [
      "radial-gradient(ellipse 50% 40% at 50% 46%, rgba(255,255,255,0.5), rgba(255,255,255,0) 70%)",
      "radial-gradient(ellipse 75% 60% at 50% 56%, rgba(255,200,160,0.26), rgba(255,200,160,0) 74%)",
    ].join(", "),
  },
  backward: {
    vec: [0, 0],
    blurAxis: "iso",
    rgbAxis: "x",
    fromPeak: 0.82, // 奥へ引く
    toStart: 1.36,
    pulse: false,
    maskBulge: false,
    displace: false,
    smearY: false,
    baseBlurX: 0,
    crossW: 0.14,
    exposure: -0.06,
    cast: false,
    lights: [
      "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(220,230,255,0.45), rgba(220,230,255,0) 70%)",
      "radial-gradient(ellipse 80% 65% at 50% 50%, rgba(160,190,255,0.22), rgba(160,190,255,0) 76%)",
    ].join(", "),
  },
};

const DIR_INDEX: Record<DirKey, number> = {
  left: 1,
  right: 2,
  up: 3,
  down: 4,
  forward: 5,
  backward: 6,
};

/** 単チャンネル抽出の feColorMatrix 値 */
const CH_R = "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0";
const CH_G = "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0";
const CH_B = "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0";

/**
 * 色収差＋異方性ブラー（＋任意で変位マップ）を1本にまとめた SVG フィルタ。
 * R/B を運動軸沿いに逆向きへずらし screen で再構成 → ガウス → （down のみ）変位。
 */
const AberrationBlurFilter: React.FC<{
  id: string;
  dx: number;
  dy: number;
  stdX: number;
  stdY: number;
  dispUri?: string;
  dispScale?: number;
  width?: number;
  height?: number;
}> = ({ id, dx, dy, stdX, stdY, dispUri, dispScale = 0, width = 0, height = 0 }) => {
  const useDisp = Boolean(dispUri) && dispScale > 0.5;
  return (
    <filter
      id={id}
      x="-30%"
      y="-30%"
      width="160%"
      height="160%"
      colorInterpolationFilters="sRGB"
    >
      <feColorMatrix in="SourceGraphic" type="matrix" values={CH_R} result="r" />
      <feOffset in="r" dx={dx.toFixed(2)} dy={dy.toFixed(2)} result="ro" />
      <feColorMatrix in="SourceGraphic" type="matrix" values={CH_G} result="g" />
      <feColorMatrix in="SourceGraphic" type="matrix" values={CH_B} result="b" />
      <feOffset in="b" dx={(-dx).toFixed(2)} dy={(-dy).toFixed(2)} result="bo" />
      <feBlend in="ro" in2="g" mode="screen" result="rg" />
      <feBlend in="rg" in2="bo" mode="screen" result="rgb" />
      <feGaussianBlur
        in="rgb"
        stdDeviation={`${Math.max(0, stdX).toFixed(2)} ${Math.max(0, stdY).toFixed(2)}`}
        result="blurred"
      />
      {useDisp ? (
        <>
          <feImage
            href={dispUri}
            x={0}
            y={0}
            width={width}
            height={height}
            result="map"
          />
          <feDisplacementMap
            in="blurred"
            in2="map"
            scale={dispScale.toFixed(1)}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </>
      ) : null}
    </filter>
  );
};

export const MvTransitionBulge: React.FC<MvTransitionBulgeProps> = ({
  from,
  to,
  durationInFrames,
  direction = "left",
  variant = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const rawId = useId();
  const uid = useMemo(() => rawId.replace(/[^a-zA-Z0-9_-]/g, ""), [rawId]);

  const cfg = DIR_CONFIG[direction] ?? DIR_CONFIG.left;
  const v = clamp01(variant);
  const seed = Math.floor(v * 997) + DIR_INDEX[direction] * 131 + 7;

  // 解像度非依存: 横幅 1920px 基準の係数
  const u = width / 1920;

  const last = Math.max(1, durationInFrames - 1);
  const p = clamp01(frame / last);

  // variant 由来の決定的な個体差
  const blurGain = 0.85 + 0.3 * rand(seed, 1, 2);
  const lightGain = 0.85 + 0.3 * rand(seed, 3, 4);
  const sAt = 0.47 + 0.06 * rand(seed, 5, 6); // 差し替え中心（中点付近で微妙に揺らす）

  // ---- エンベロープ（三角波／頂点プラトーの台形。96% でゼロへ） -------------
  // バルジ・カオス総量: 台形（頂点で1割ほど滞留）
  const burst = poly(p, [0, 0.3, 0.45, 0.56, 0.8, 0.96], [0, 0.55, 1, 1, 0.3, 0]);
  // 方向ブラー: 頂点を中点より遅く（全長の6割弱）
  const dirBlurEnv = poly(p, [0, 0.22, 0.58, 0.82, 0.96], [0, 0.35, 1, 0.25, 0]);
  // 光もの: 中盤ピークの包絡
  const lightEnv =
    lightGain * poly(p, [0.06, 0.34, 0.5, 0.72, 0.96], [0, 0.55, 1, 0.4, 0]);
  // 等方ブラーの脈動（前半〜中盤に 1↔0.5 を3往復）
  const pulse = cfg.pulse
    ? poly(
        p,
        [0, 0.1, 0.18, 0.26, 0.34, 0.42, 0.5, 0.6],
        [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.7]
      )
    : 0;

  // ---- 差し替え（ほぼハードカットの短いクロスフェード） ---------------------
  const half = cfg.crossW / 2;
  const toOpacity = poly(p, [sAt - half, sAt + half], [0, 1]);
  const showFrom = toOpacity < 0.999;
  const showTo = toOpacity > 0.001;

  // ---- 変形 -----------------------------------------------------------------
  // from: 中心から膨張 → 指定方向へ加速ドリフト
  const fromScale =
    1 + (cfg.fromPeak - 1) * poly(p, [0, 0.5, 0.64], [0, 0.9, 1]);
  const drift = poly(p, [0.12, 0.4, 0.64], [0, 0.35, 1]); // 折れ線での加速
  const driftPct = 22 * drift;
  const fromX = cfg.vec[0] * driftPct;
  const fromY = cfg.vec[1] * driftPct;
  const smear = cfg.smearY ? 1 + 0.14 * dirBlurEnv : 1; // up の縦スメア

  // to: 反対側から拡大＆ブラー状態で入り、等倍へ収束（終盤ほど減速する折れ線）
  const toProgress = poly(
    p,
    [sAt - 0.1, 0.68, 0.85, 0.96],
    [0, 0.72, 0.96, 1]
  );
  const toScale = cfg.toStart + (1 - cfg.toStart) * toProgress;
  const toDist = 18 * (1 - toProgress);
  const toX = -cfg.vec[0] * toDist;
  const toY = -cfg.vec[1] * toDist;

  // ---- 微振動（フレームハッシュの決定論乱数。片軸を7割に） -------------------
  const shakeAmp = 13 * u * burst;
  const sx = (rand(seed, frame, 21) - 0.5) * 2 * shakeAmp;
  const sy = (rand(seed, frame, 22) - 0.5) * 2 * shakeAmp;
  const vertical = cfg.blurAxis === "y";
  const shakeX = vertical ? sx * 0.7 : sx;
  const shakeY = vertical ? sy : sy * 0.7;

  // ---- ブラー量（運動軸優勢。最大は画面幅の約2.75%、直交軸は1/10以下） -------
  const axisMax = 52 * u * blurGain;
  const iso = cfg.pulse ? 6 * u * pulse * dirBlurEnv : 0;
  let fromStdX: number;
  let fromStdY: number;
  if (cfg.blurAxis === "x") {
    fromStdX = axisMax * dirBlurEnv + cfg.baseBlurX * u + iso;
    fromStdY = axisMax * 0.08 * dirBlurEnv + iso;
  } else if (cfg.blurAxis === "y") {
    fromStdX = axisMax * 0.08 * dirBlurEnv;
    fromStdY = axisMax * dirBlurEnv;
  } else {
    fromStdX = axisMax * 0.55 * dirBlurEnv;
    fromStdY = axisMax * 0.55 * dirBlurEnv;
  }
  // to 側は差し替え時に最大 → 晴れて着地
  const toBlurEnv = poly(p, [0, sAt, 0.78, 0.93], [1, 1, 0.25, 0]);
  const toStdX =
    cfg.blurAxis === "y" ? axisMax * 0.08 * toBlurEnv : axisMax * 0.7 * toBlurEnv;
  const toStdY =
    cfg.blurAxis === "x" ? axisMax * 0.08 * toBlurEnv : axisMax * 0.7 * toBlurEnv;

  // ---- 色収差（最大 = 画面幅の約1%） -----------------------------------------
  const rgbMax = 19 * u;
  const fromShift = rgbMax * burst;
  const toShiftAmt = rgbMax * 0.5 * toBlurEnv;
  const fromDx = cfg.rgbAxis === "x" ? fromShift : 0;
  const fromDy = cfg.rgbAxis === "y" ? fromShift : 0;
  const toDx = cfg.rgbAxis === "x" ? toShiftAmt : 0;
  const toDy = cfg.rgbAxis === "y" ? toShiftAmt : 0;

  // ---- 変位マップ（down）: R=横勾配 / G=縦勾配、中央がグレーの手続き生成 SVG --
  const dispUri = useMemo(() => {
    if (!cfg.displace) return undefined;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<defs>` +
      `<linearGradient id="gx" x1="0" y1="0" x2="1" y2="0">` +
      `<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/>` +
      `</linearGradient>` +
      `<linearGradient id="gy" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#0f0"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="100%" height="100%" fill="url(#gx)"/>` +
      `<rect width="100%" height="100%" fill="url(#gy)" style="mix-blend-mode:screen"/>` +
      `</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [cfg.displace, width, height]);
  const dispScale = cfg.displace ? 0.1 * width * burst : 0; // 最大変位 = 幅の1割

  // ---- ステージのグレード -----------------------------------------------------
  const gradeEnv = poly(p, [0, 0.12, 0.85, 0.96], [0, 1, 1, 0]);
  const sat = 1 - 0.45 * burst; // 中盤で彩度を4〜5割落とす
  const extraSat = cfg.exposure !== 0 ? 1 - 0.12 * gradeEnv : 1; // left/up は常時薄く
  const contrast = 1 + 0.1 * gradeEnv;
  const brightness = 1 + cfg.exposure * lightEnv;
  const stageFilter = [
    `saturate(${(sat * extraSat).toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `brightness(${brightness.toFixed(3)})`,
  ].join(" ");

  // ---- グレイン（seed 毎フレーム更新） ----------------------------------------
  const grainSeed = ((seed * 97 + frame * 13) % 9973) + 1;
  const grainOp = 0.11 * burst;

  // left の拡大複製バルジ（中心26%不透明→60%で透明の放射マスク）
  const bulgeOp = cfg.maskBulge ? 0.85 * burst : 0;
  const bulgeContent = toOpacity > 0.5 ? to : from;

  const maskStyle: React.CSSProperties = {
    WebkitMaskImage:
      "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 26%, rgba(0,0,0,0) 60%)",
    maskImage:
      "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 26%, rgba(0,0,0,0) 60%)",
  };

  return (
    <AbsoluteFill
      style={{ background: "#000", overflow: "hidden", filter: stageFilter }}
    >
      {/* フィルタ定義（0x0 svg の defs に置き id 参照） */}
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
        <defs>
          <AberrationBlurFilter
            id={`${uid}-fx-from`}
            dx={fromDx}
            dy={fromDy}
            stdX={fromStdX}
            stdY={fromStdY}
            dispUri={dispUri}
            dispScale={dispScale}
            width={width}
            height={height}
          />
          <AberrationBlurFilter
            id={`${uid}-fx-to`}
            dx={toDx}
            dy={toDy}
            stdX={toStdX}
            stdY={toStdY}
          />
        </defs>
      </svg>

      {/* 本体（微振動を共有） */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(1)}px, ${shakeY.toFixed(1)}px)`,
        }}
      >
        {/* 旧カット: 膨張＋ドリフト＋ボケ増で去る */}
        {showFrom && (
          <AbsoluteFill
            style={{
              filter: `url(#${uid}-fx-from)`,
              transform: `translate(${fromX.toFixed(2)}%, ${fromY.toFixed(
                2
              )}%) scale(${fromScale.toFixed(4)}, ${(fromScale * smear).toFixed(
                4
              )})`,
              transformOrigin: "50% 50%",
            }}
          >
            {from}
          </AbsoluteFill>
        )}

        {/* 新カット: 反対側から拡大＆ブラーで入り、晴れて着地 */}
        {showTo && (
          <AbsoluteFill
            style={{
              filter: `url(#${uid}-fx-to)`,
              transform: `translate(${toX.toFixed(2)}%, ${toY.toFixed(
                2
              )}%) scale(${toScale.toFixed(4)})`,
              transformOrigin: "50% 50%",
              opacity: clamp01(toOpacity),
            }}
          >
            {to}
          </AbsoluteFill>
        )}

        {/* left のみ: 拡大複製＋中心の放射マスクによるバルジ重ね */}
        {bulgeOp > 0.02 && (
          <AbsoluteFill
            style={{
              transform: `translate(${fromX.toFixed(2)}%, ${fromY.toFixed(
                2
              )}%) scale(${(fromScale * 1.4).toFixed(4)})`,
              transformOrigin: "50% 50%",
              opacity: bulgeOp,
              filter: `url(#${uid}-fx-from)`,
              ...maskStyle,
            }}
          >
            {bulgeContent}
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      {/* 光もの: 光漏れ／光条／グローを screen で全面に */}
      <AbsoluteFill
        style={{
          background: cfg.lights,
          mixBlendMode: "screen",
          opacity: clamp01(lightEnv),
          pointerEvents: "none",
        }}
      />

      {/* down のみ: マゼンタ全面キャスト(soft-light)＋薄いスキャンライン(multiply) */}
      {cfg.cast && (
        <>
          <AbsoluteFill
            style={{
              background:
                "radial-gradient(ellipse 120% 100% at 50% 50%, rgba(255,60,160,0.9), rgba(160,20,110,0.7))",
              mixBlendMode: "soft-light",
              opacity: clamp01(lightEnv * 0.8),
              pointerEvents: "none",
            }}
          />
          <AbsoluteFill
            style={{
              background:
                "repeating-linear-gradient(180deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, rgba(255,255,255,0) 1px, rgba(255,255,255,0) 3px)",
              mixBlendMode: "multiply",
              opacity: clamp01(0.35 * burst),
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* フィルムグレイン: fractalNoise を彩度ゼロ化して overlay */}
      {grainOp > 0.005 && (
        <AbsoluteFill
          style={{
            mixBlendMode: "overlay",
            opacity: clamp01(grainOp),
            pointerEvents: "none",
          }}
        >
          <svg
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            aria-hidden
          >
            <filter id={`${uid}-grain`} x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves={2}
                seed={grainSeed}
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect
              width="100%"
              height="100%"
              filter={`url(#${uid}-grain)`}
            />
          </svg>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
